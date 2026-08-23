"""Public upload and protected human-review HTTP endpoints."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import delete, select

try:
    from ..attachment_storage import get_attachment_storage
    from ..auth.models import User
    from ..auth.service import require_erp_role
    from ..database import Item, SessionLocal
    from ..incoming_requests import (
        IncomingPurchaseRequest,
        IncomingRequestStatusHistory,
        InternalNotification,
        _check_rate_limit,
        _client_ip,
        _hash_private,
        _now,
        require_internal_access,
    )
except ImportError:  # pragma: no cover
    from attachment_storage import get_attachment_storage
    from auth.models import User
    from auth.service import require_erp_role
    from database import Item, SessionLocal
    from incoming_requests import (
        IncomingPurchaseRequest,
        IncomingRequestStatusHistory,
        InternalNotification,
        _check_rate_limit,
        _client_ip,
        _hash_private,
        _now,
        require_internal_access,
    )

from .config import capability
from .domain import DOCUMENT_TYPES, EXTRACTABLE_DOCUMENT_TYPES
from .models import (
    DocumentFile,
    DocumentProcessingJob,
    ExtractedItem,
    ItemCandidate,
    ItemMasterCreationRequest,
    PurchaseRequestDocument,
    RequestAuditEvent,
)
from .security import validate_document_uploads
from .service import audit, confirm_document, create_document, now_iso


public_document_router = APIRouter(
    prefix="/api/public/purchase-requests", tags=["public-document-capture"]
)
internal_document_router = APIRouter(
    prefix="/api/internal/incoming-purchase-requests",
    tags=["internal-document-review"],
    dependencies=[Depends(require_internal_access)],
)


class PublicDocumentRequestIn(BaseModel):
    requester_name: str = Field(min_length=2, max_length=160)
    company_name: str = Field(default="", max_length=180)
    phone_number: str = Field(min_length=7, max_length=30)
    project_name: str = Field(default="Document request", min_length=2, max_length=200)
    project_location: str = Field(default="Not provided", min_length=2, max_length=500)
    delivery_location: str = Field(default="Not provided", min_length=2, max_length=500)
    required_delivery_date: str = Field(default="")
    priority: str = Field(default="normal")
    notes: str = Field(default="", max_length=4000)
    submission_token: str = Field(min_length=12, max_length=100)
    document_type: str


class ExtractedItemPatch(BaseModel):
    product_name: str | None = Field(default=None, max_length=500)
    brand: str | None = Field(default=None, max_length=250)
    specification: str | None = Field(default=None, max_length=4000)
    size: str | None = Field(default=None, max_length=160)
    quantity: float | None = Field(default=None, gt=0, le=1_000_000_000)
    unit: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)
    selected_item_id: str | None = None
    excluded: bool | None = None
    review_notes: str | None = Field(default=None, max_length=2000)


class ConfirmIn(BaseModel):
    confirmed_by: str = Field(min_length=1, max_length=160)
    confirmation: str


class MasterCreationRequestIn(BaseModel):
    requested_by: str = Field(min_length=1, max_length=160)
    confirmation: str


class ExtractedItemCreate(BaseModel):
    product_name: str = Field(min_length=1, max_length=500)
    brand: str = Field(default="", max_length=250)
    specification: str = Field(default="", max_length=4000)
    size: str = Field(default="", max_length=160)
    quantity: float | None = Field(default=None, gt=0, le=1_000_000_000)
    unit: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=2000)


class SplitItemIn(BaseModel):
    first: ExtractedItemCreate
    second: ExtractedItemCreate


class MergeItemsIn(BaseModel):
    item_ids: list[str] = Field(min_length=2, max_length=20)


@public_document_router.get("/document-extraction-capability")
async def document_extraction_capability(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return capability()


@public_document_router.post("/documents")
async def upload_purchase_request_document(
    request: Request,
    response: Response,
    payload: Annotated[str, Form()],
    documents: Annotated[list[UploadFile], File()],
    website: Annotated[str, Form()] = "",
):
    response.headers["Cache-Control"] = "no-store"
    if website.strip():
        raise HTTPException(422, "Unable to submit this request")
    state = capability()
    if not state["available"]:
        raise HTTPException(
            503, {"code": state["status"], "manual_entry_available": True}
        )
    try:
        body = PublicDocumentRequestIn.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(422, "Please review the required request fields") from exc
    if body.document_type not in DOCUMENT_TYPES:
        raise HTTPException(422, "Unsupported document type")
    if body.priority not in {"low", "normal", "high", "urgent"}:
        raise HTTPException(422, "Invalid priority")
    files = await validate_document_uploads(documents)
    ip_hash = _hash_private(_client_ip(request))
    _check_rate_limit(ip_hash)
    fingerprint = hashlib.sha256(
        (
            body.submission_token
            + ":"
            + ":".join(hashlib.sha256(file.content).hexdigest() for file in files)
        ).encode("utf-8")
    ).hexdigest()
    with SessionLocal() as session:
        duplicate = session.scalars(
            select(IncomingPurchaseRequest).where(
                IncomingPurchaseRequest.submission_token == body.submission_token
            )
        ).first()
        if duplicate:
            document = session.scalars(
                select(PurchaseRequestDocument)
                .where(PurchaseRequestDocument.request_id == duplicate.id)
                .order_by(PurchaseRequestDocument.created_at.desc())
            ).first()
            return {
                "ok": True,
                "duplicate": True,
                "request_number": duplicate.request_number,
                "document_id": document.id if document else None,
            }
        timestamp = _now()
        request_id = str(uuid.uuid4())
        request_number = (
            f"REQ-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:10].upper()}"
        )
        required_date = (
            body.required_delivery_date or datetime.now(timezone.utc).date().isoformat()
        )
        row = IncomingPurchaseRequest(
            id=request_id,
            request_number=request_number,
            requester_name=body.requester_name.strip(),
            company_name=body.company_name.strip(),
            phone_number=body.phone_number.strip(),
            whatsapp_number="",
            email="",
            project_name=body.project_name.strip(),
            project_location=body.project_location.strip(),
            delivery_location=body.delivery_location.strip(),
            required_delivery_date=required_date,
            priority=body.priority,
            notes=body.notes.strip(),
            status="new",
            assigned_employee="",
            submission_token=body.submission_token,
            content_fingerprint=fingerprint,
            requester_ip_hash=ip_hash,
            user_agent_hash=_hash_private(request.headers.get("user-agent", "")),
            created_at=timestamp,
            updated_at=timestamp,
        )
        session.add(row)
        session.add(
            IncomingRequestStatusHistory(
                id=str(uuid.uuid4()),
                request_id=request_id,
                from_status="",
                to_status="new",
                changed_by="public",
                note="Document submitted for human review",
                created_at=timestamp,
            )
        )
        session.add(
            InternalNotification(
                id=str(uuid.uuid4()),
                notification_type="new_purchase_request_document",
                entity_type="incoming_purchase_request",
                entity_id=request_id,
                title=f"New document request {request_number}",
                message=f"From {body.requester_name.strip()}",
                is_read=0,
                created_at=timestamp,
            )
        )
        session.flush()
        document = create_document(
            session,
            request_id,
            body.document_type,
            files,
            queue_processing=body.document_type in EXTRACTABLE_DOCUMENT_TYPES,
        )
        session.commit()
        return {
            "ok": True,
            "duplicate": False,
            "request_number": request_number,
            "document_id": document.id,
            "status": document.status,
        }


def _document_or_404(session, request_id: str, document_id: str):
    document = session.get(PurchaseRequestDocument, document_id)
    if not document or document.request_id != request_id:
        raise HTTPException(404, "Document not found")
    return document


def _document_summary(document):
    return {
        "id": document.id,
        "request_id": document.request_id,
        "document_type": document.document_type,
        "status": document.status,
        "ocr_provider": document.ocr_provider,
        "extraction_provider": document.extraction_provider,
        "ocr_confidence": document.ocr_confidence,
        "page_count": document.page_count,
        "failure_code": document.failure_code,
        "failure_message": document.failure_message,
        "confirmed_by": document.confirmed_by,
        "confirmed_at": document.confirmed_at,
        "retention_expires_at": document.retention_expires_at,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
    }


@internal_document_router.get("/{request_id}/documents")
async def list_documents(request_id: str, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        rows = session.scalars(
            select(PurchaseRequestDocument)
            .where(PurchaseRequestDocument.request_id == request_id)
            .order_by(PurchaseRequestDocument.created_at.desc())
        ).all()
        return [_document_summary(row) for row in rows]


@internal_document_router.get("/{request_id}/documents/{document_id}")
async def document_review(request_id: str, document_id: str, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        document = _document_or_404(session, request_id, document_id)
        rows = session.scalars(
            select(ExtractedItem)
            .where(ExtractedItem.document_id == document_id)
            .order_by(ExtractedItem.position)
        ).all()
        candidate_rows = (
            session.scalars(
                select(ItemCandidate)
                .where(ItemCandidate.extracted_item_id.in_([row.id for row in rows]))
                .order_by(ItemCandidate.extracted_item_id, ItemCandidate.rank)
            ).all()
            if rows
            else []
        )
        item_ids = {candidate.item_id for candidate in candidate_rows}
        item_ids.update(row.selected_item_id for row in rows if row.selected_item_id)
        masters = (
            {
                item.id: item
                for item in session.scalars(
                    select(Item).where(Item.id.in_(item_ids))
                ).all()
            }
            if item_ids
            else {}
        )
        grouped = {}
        for candidate in candidate_rows:
            item = masters.get(candidate.item_id)
            if item:
                grouped.setdefault(candidate.extracted_item_id, []).append(
                    {
                        "item_id": item.id,
                        "code": item.code,
                        "name_ar": item.name_ar or item.product_name or item.name,
                        "name_en": item.name_en,
                        "brand": item.brand,
                        "unit": item.unit,
                        "score": candidate.score,
                        "reasons": candidate.reasons,
                    }
                )
        result = _document_summary(document)
        result["raw_text"] = document.raw_text
        result["files"] = [
            {
                "id": file.id,
                "original_filename": file.original_filename,
                "media_type": file.media_type,
                "size_bytes": file.size_bytes,
            }
            for file in session.scalars(
                select(DocumentFile)
                .where(DocumentFile.document_id == document_id)
                .order_by(DocumentFile.position)
            ).all()
        ]
        normalized_names = [
            " ".join(row.product_name.casefold().split()) for row in rows
        ]
        result["items"] = [
            {
                "id": row.id,
                "position": row.position,
                "raw_line_text": row.raw_line_text,
                "product_name": row.product_name,
                "brand": row.brand,
                "specification": row.specification,
                "size": row.size,
                "quantity": row.quantity,
                "unit": row.unit,
                "notes": row.notes,
                "extraction_confidence": row.extraction_confidence,
                "selected_item_id": row.selected_item_id,
                "match_state": row.match_state,
                "excluded": bool(row.excluded),
                "review_notes": row.review_notes,
                "validation": {
                    "missing_product": not bool(row.product_name.strip()),
                    "missing_quantity": row.quantity is None or row.quantity <= 0,
                    "missing_unit": not bool(row.unit.strip()),
                    "suspected_duplicate": bool(row.product_name.strip())
                    and normalized_names.count(
                        " ".join(row.product_name.casefold().split())
                    )
                    > 1,
                },
                "candidates": grouped.get(row.id, []),
            }
            for row in rows
        ]
        return result


@internal_document_router.post("/{request_id}/documents/{document_id}/items")
async def add_extracted_item(
    request_id: str, document_id: str, body: ExtractedItemCreate,
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        document = _document_or_404(session, request_id, document_id)
        if document.status != "review_required":
            raise HTTPException(409, "Only documents awaiting review can be edited")
        last = session.scalars(
            select(ExtractedItem)
            .where(ExtractedItem.document_id == document_id)
            .order_by(ExtractedItem.position.desc())
        ).first()
        timestamp = now_iso()
        row = ExtractedItem(
            id=str(uuid.uuid4()),
            document_id=document_id,
            position=(last.position + 1) if last else 1,
            raw_line_text="",
            product_name=body.product_name.strip(),
            brand=body.brand.strip(),
            specification=body.specification.strip(),
            size=body.size.strip(),
            quantity=body.quantity,
            unit=body.unit.strip(),
            notes=body.notes.strip(),
            match_state="no_match",
            created_at=timestamp,
            updated_at=timestamp,
        )
        session.add(row)
        audit(
            session,
            request_id,
            "extracted_item_added",
            document_id=document_id,
            actor="internal",
            details={"item_id": row.id},
        )
        session.commit()
        return {"ok": True, "id": row.id}


@internal_document_router.delete(
    "/{request_id}/documents/{document_id}/items/{item_id}"
)
async def delete_extracted_item(
    request_id: str, document_id: str, item_id: str,
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        document = _document_or_404(session, request_id, document_id)
        if document.status != "review_required":
            raise HTTPException(409, "Only documents awaiting review can be edited")
        row = session.get(ExtractedItem, item_id)
        if not row or row.document_id != document_id:
            raise HTTPException(404, "Extracted item not found")
        session.delete(row)
        audit(
            session,
            request_id,
            "extracted_item_deleted",
            document_id=document_id,
            actor="internal",
            details={"item_id": item_id},
        )
        session.commit()
        return {"ok": True}


@internal_document_router.post(
    "/{request_id}/documents/{document_id}/items/{item_id}/split"
)
async def split_extracted_item(
    request_id: str,
    document_id: str,
    item_id: str,
    body: SplitItemIn,
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        document = _document_or_404(session, request_id, document_id)
        if document.status != "review_required":
            raise HTTPException(409, "Only documents awaiting review can be edited")
        row = session.get(ExtractedItem, item_id)
        if not row or row.document_id != document_id:
            raise HTTPException(404, "Extracted item not found")
        last = session.scalars(
            select(ExtractedItem)
            .where(ExtractedItem.document_id == document_id)
            .order_by(ExtractedItem.position.desc())
        ).first()
        timestamp = now_iso()
        for key, value in body.first.model_dump().items():
            setattr(row, key, value.strip() if isinstance(value, str) else value)
        row.selected_item_id = None
        row.match_state = "no_match"
        row.updated_at = timestamp
        second = body.second
        created = ExtractedItem(
            id=str(uuid.uuid4()),
            document_id=document_id,
            position=(last.position + 1),
            raw_line_text=row.raw_line_text,
            product_name=second.product_name.strip(),
            brand=second.brand.strip(),
            specification=second.specification.strip(),
            size=second.size.strip(),
            quantity=second.quantity,
            unit=second.unit.strip(),
            notes=second.notes.strip(),
            match_state="no_match",
            created_at=timestamp,
            updated_at=timestamp,
        )
        session.add(created)
        audit(
            session,
            request_id,
            "extracted_item_split",
            document_id=document_id,
            actor="internal",
            details={"source": item_id, "created": created.id},
        )
        session.commit()
        return {"ok": True, "created_id": created.id}


@internal_document_router.post("/{request_id}/documents/{document_id}/items/merge")
async def merge_extracted_items(
    request_id: str, document_id: str, body: MergeItemsIn,
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        document = _document_or_404(session, request_id, document_id)
        if document.status != "review_required":
            raise HTTPException(409, "Only documents awaiting review can be edited")
        rows = session.scalars(
            select(ExtractedItem)
            .where(
                ExtractedItem.document_id == document_id,
                ExtractedItem.id.in_(body.item_ids),
            )
            .order_by(ExtractedItem.position)
        ).all()
        if len(rows) != len(set(body.item_ids)):
            raise HTTPException(404, "One or more extracted items were not found")
        units = {row.unit.strip().casefold() for row in rows if row.unit.strip()}
        if len(units) > 1:
            raise HTTPException(422, "Rows with different units cannot be merged")
        target = rows[0]
        target.product_name = " / ".join(
            dict.fromkeys(row.product_name for row in rows if row.product_name)
        )
        target.raw_line_text = "\n".join(
            row.raw_line_text for row in rows if row.raw_line_text
        )
        target.specification = "\n".join(
            dict.fromkeys(row.specification for row in rows if row.specification)
        )
        quantities = [row.quantity for row in rows if row.quantity is not None]
        target.quantity = sum(quantities) if quantities else None
        target.selected_item_id = None
        target.match_state = "no_match"
        target.updated_at = now_iso()
        for row in rows[1:]:
            session.delete(row)
        audit(
            session,
            request_id,
            "extracted_items_merged",
            document_id=document_id,
            actor="internal",
            details={"items": body.item_ids, "target": target.id},
        )
        session.commit()
        return {"ok": True, "target_id": target.id}


@internal_document_router.patch("/{request_id}/documents/{document_id}/items/{item_id}")
async def update_extracted_item(
    request_id: str,
    document_id: str,
    item_id: str,
    body: ExtractedItemPatch,
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        document = _document_or_404(session, request_id, document_id)
        if document.status != "review_required":
            raise HTTPException(409, "Only documents awaiting review can be edited")
        row = session.get(ExtractedItem, item_id)
        if not row or row.document_id != document_id:
            raise HTTPException(404, "Extracted item not found")
        values = body.model_dump(exclude_unset=True)
        if "selected_item_id" in values and values["selected_item_id"]:
            if not session.get(Item, values["selected_item_id"]):
                raise HTTPException(422, "Selected master item does not exist")
            row.match_state = "confirmed_match"
        for key, value in values.items():
            setattr(row, key, int(value) if key == "excluded" else value)
        row.updated_at = now_iso()
        audit(
            session,
            request_id,
            "extracted_item_updated",
            document_id=document_id,
            actor="internal",
            details={"item_id": item_id, "fields": sorted(values)},
        )
        session.commit()
        return {"ok": True}


@internal_document_router.post("/{request_id}/documents/{document_id}/confirm")
async def confirm_review(
    request_id: str, document_id: str, body: ConfirmIn,
    current_user: User = Depends(require_erp_role()),
):
    if body.confirmation != "CONFIRM_REVIEWED_ITEMS":
        raise HTTPException(422, "Explicit confirmation is required")
    with SessionLocal() as session:
        document = _document_or_404(session, request_id, document_id)
        try:
            count = confirm_document(session, document, body.confirmed_by.strip())
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        session.commit()
        return {"ok": True, "items_added": count, "status": "confirmed"}


@internal_document_router.post("/{request_id}/documents/{document_id}/retry")
async def retry_document(
    request_id: str, document_id: str, current_user: User = Depends(require_erp_role()),
):
    if not capability()["available"]:
        raise HTTPException(503, "Document extraction is not configured")
    with SessionLocal() as session:
        document = _document_or_404(session, request_id, document_id)
        if document.document_type not in EXTRACTABLE_DOCUMENT_TYPES:
            raise HTTPException(409, "This stored document type is not extractable")
        if document.status not in {"failed", "uploaded", "review_required"}:
            raise HTTPException(409, "This document cannot be retried")
        timestamp = now_iso()
        if document.status == "review_required":
            extracted_ids = select(ExtractedItem.id).where(
                ExtractedItem.document_id == document_id
            )
            session.execute(
                delete(ItemCandidate).where(
                    ItemCandidate.extracted_item_id.in_(extracted_ids)
                )
            )
            session.execute(
                delete(ExtractedItem).where(ExtractedItem.document_id == document_id)
            )
        session.add(
            DocumentProcessingJob(
                id=str(uuid.uuid4()),
                document_id=document_id,
                status="queued",
                attempts=0,
                max_attempts=3,
                available_at=timestamp,
                created_at=timestamp,
                updated_at=timestamp,
            )
        )
        document.status = "uploaded"
        document.failure_code = ""
        document.failure_message = ""
        document.updated_at = timestamp
        audit(
            session,
            request_id,
            "document_retry_queued",
            document_id=document_id,
            actor="internal",
        )
        session.commit()
        return {"ok": True, "status": "uploaded"}


@internal_document_router.post("/{request_id}/documents/{document_id}/cancel")
async def cancel_document(
    request_id: str, document_id: str, current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        document = _document_or_404(session, request_id, document_id)
        if document.status == "confirmed":
            raise HTTPException(409, "A confirmed document cannot be cancelled")
        document.status = "cancelled"
        document.updated_at = now_iso()
        jobs = session.scalars(
            select(DocumentProcessingJob).where(
                DocumentProcessingJob.document_id == document_id,
                DocumentProcessingJob.status.in_(["queued", "processing"]),
            )
        ).all()
        for job in jobs:
            job.status = "cancelled"
            job.updated_at = now_iso()
        audit(
            session,
            request_id,
            "document_cancelled",
            document_id=document_id,
            actor="internal",
        )
        session.commit()
        return {"ok": True, "status": "cancelled"}


@internal_document_router.post(
    "/{request_id}/documents/{document_id}/items/{item_id}/master-creation-request"
)
async def request_master_creation(
    request_id: str,
    document_id: str,
    item_id: str,
    body: MasterCreationRequestIn,
    current_user: User = Depends(require_erp_role()),
):
    if body.confirmation != "REQUEST_MASTER_ITEM_CREATION":
        raise HTTPException(422, "Explicit confirmation is required")
    with SessionLocal() as session:
        _document_or_404(session, request_id, document_id)
        row = session.get(ExtractedItem, item_id)
        if not row or row.document_id != document_id:
            raise HTTPException(404, "Extracted item not found")
        existing = session.scalars(
            select(ItemMasterCreationRequest).where(
                ItemMasterCreationRequest.extracted_item_id == item_id,
                ItemMasterCreationRequest.status == "pending",
            )
        ).first()
        if existing:
            return {"ok": True, "duplicate": True, "id": existing.id}
        timestamp = now_iso()
        creation = ItemMasterCreationRequest(
            id=str(uuid.uuid4()),
            request_id=request_id,
            document_id=document_id,
            extracted_item_id=item_id,
            status="pending",
            proposed_data={
                "name_ar": row.product_name,
                "name_en": "",
                "brand": row.brand,
                "specifications": row.specification,
                "unit": row.unit,
            },
            requested_by=body.requested_by,
            created_at=timestamp,
            updated_at=timestamp,
        )
        session.add(creation)
        audit(
            session,
            request_id,
            "master_item_creation_requested",
            document_id=document_id,
            actor=body.requested_by,
            details={"extracted_item_id": item_id},
        )
        session.commit()
        return {"ok": True, "duplicate": False, "id": creation.id}


@internal_document_router.get("/{request_id}/documents/{document_id}/files/{file_id}")
async def download_document_file(
    request_id: str, document_id: str, file_id: str,
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        _document_or_404(session, request_id, document_id)
        file = session.get(DocumentFile, file_id)
        if not file or file.document_id != document_id:
            raise HTTPException(404, "Document file not found")
        stored = get_attachment_storage().get(file.stored_filename)
        safe_name = file.original_filename.replace('"', "_")
        return StreamingResponse(
            stored.body,
            media_type=file.media_type,
            headers={
                "Content-Disposition": f'inline; filename="{safe_name}"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
