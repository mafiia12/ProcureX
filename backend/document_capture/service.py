"""Application service for secure, human-reviewed document extraction."""

from __future__ import annotations

import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

try:
    from ..attachment_storage import delete_attachments_quietly_async, get_attachment_storage, put_attachment
    from ..database import Item, SessionLocal
    from ..incoming_requests import IncomingPurchaseRequestItem
except ImportError:  # pragma: no cover
    from attachment_storage import delete_attachments_quietly_async, get_attachment_storage, put_attachment
    from database import Item, SessionLocal
    from incoming_requests import IncomingPurchaseRequestItem

from .config import build_providers
from .domain import DocumentFileInput, DocumentProcessingError
from .matching import match_items, match_state
from .models import (
    DocumentFile,
    DocumentProcessingJob,
    ExtractedItem,
    ItemCandidate,
    PurchaseRequestDocument,
    RequestAuditEvent,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def audit(
    session,
    request_id: str,
    event_type: str,
    *,
    document_id: str = "",
    actor: str = "",
    details=None,
):
    session.add(
        RequestAuditEvent(
            id=str(uuid.uuid4()),
            request_id=request_id,
            document_id=document_id,
            event_type=event_type,
            actor=actor[:160],
            details=details or {},
            created_at=now_iso(),
        )
    )


_DOCUMENT_EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


async def store_document_files(
    request_id: str, document_id: str, files: list[DocumentFileInput],
) -> list[str]:
    """Writes each file to attachment storage off the event loop, before any
    DB session is opened, and returns their keys in `files` order. On a
    failure it removes whatever it already wrote and re-raises."""
    stored_keys: list[str] = []
    try:
        for file in files:
            key = (
                f"document-captures/{request_id}/{document_id}/"
                f"{uuid.uuid4().hex}{_DOCUMENT_EXTENSIONS[file.media_type]}"
            )
            await put_attachment(key, file.content, file.media_type, hashlib.sha256(file.content).hexdigest())
            stored_keys.append(key)
    except Exception:
        await delete_attachments_quietly_async(stored_keys)
        raise
    return stored_keys


def create_document(
    session,
    request_id: str,
    document_type: str,
    files: list[DocumentFileInput],
    *,
    document_id: str,
    stored_keys: list[str],
    queue_processing: bool = True,
):
    """Writes the document rows for files already stored by
    store_document_files (same document_id, keys in `files` order). Never
    calls the object store; the caller owns cleanup of `stored_keys`."""
    if len(stored_keys) != len(files):
        raise ValueError("every document file must be stored before create_document")
    created_at = now_iso()
    retention_days = max(1, min(int(os.getenv("DOCUMENT_RETENTION_DAYS", "90")), 3650))
    row = PurchaseRequestDocument(
        id=document_id,
        request_id=request_id,
        document_type=document_type,
        status="uploaded",
        retention_expires_at=(
            datetime.now(timezone.utc) + timedelta(days=retention_days)
        ).isoformat(),
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(row)
    session.flush()
    for position, (file, key) in enumerate(zip(files, stored_keys), 1):
        session.add(
            DocumentFile(
                id=str(uuid.uuid4()),
                document_id=document_id,
                position=position,
                original_filename=file.filename,
                stored_filename=key,
                media_type=file.media_type,
                size_bytes=len(file.content),
                sha256=hashlib.sha256(file.content).hexdigest(),
                created_at=created_at,
            )
        )
    if queue_processing:
        session.add(
            DocumentProcessingJob(
                id=str(uuid.uuid4()),
                document_id=document_id,
                status="queued",
                attempts=0,
                max_attempts=max(
                    1,
                    min(
                        int(os.getenv("DOCUMENT_PROCESSING_MAX_ATTEMPTS", "3")), 10
                    ),
                ),
                available_at=created_at,
                created_at=created_at,
                updated_at=created_at,
            )
        )
    audit(
        session,
        request_id,
        "document_uploaded",
        document_id=document_id,
        actor="public",
        details={
            "type": document_type,
            "files": len(files),
            "processing_queued": queue_processing,
        },
    )
    session.flush()
    return row


def process_document(document_id: str) -> None:
    ocr_provider, extraction_provider = build_providers()
    with SessionLocal() as session:
        document = session.get(PurchaseRequestDocument, document_id)
        if not document or document.status == "cancelled":
            return
        document.status = "processing"
        document.ocr_provider = ocr_provider.name
        document.extraction_provider = extraction_provider.name
        document.updated_at = now_iso()
        session.commit()

    with SessionLocal() as session:
        files = [
            (file.stored_filename, file.size_bytes, file.sha256, file.original_filename, file.media_type)
            for file in session.scalars(
                select(DocumentFile)
                .where(DocumentFile.document_id == document_id)
                .order_by(DocumentFile.position)
            ).all()
        ]
        document = session.get(PurchaseRequestDocument, document_id)
        if not document or document.status == "cancelled":
            return
        document_type = document.document_type
    # This runs on the worker thread, so blocking storage reads are fine
    # here - but not inside the session above: a slow object store must not
    # hold a pooled DB connection.
    storage = get_attachment_storage()
    inputs: list[DocumentFileInput] = []
    for stored_filename, size_bytes, sha256, original_filename, media_type in files:
        stored = storage.get(stored_filename)
        try:
            body = stored.body.read()
        finally:
            stored.body.close()
        if len(body) != size_bytes or hashlib.sha256(body).hexdigest() != sha256:
            raise DocumentProcessingError("Stored document integrity check failed")
        inputs.append(DocumentFileInput(original_filename, media_type, body))

    ocr = ocr_provider.extract(inputs)
    if not ocr.raw_text.strip():
        raise DocumentProcessingError("No readable text was found in the document")
    extracted, extraction_metadata = extraction_provider.extract_items(
        ocr.raw_text, document_type
    )

    with SessionLocal() as session:
        document = session.get(PurchaseRequestDocument, document_id)
        if not document or document.status == "cancelled":
            return
        session.execute(
            delete(ItemCandidate).where(
                ItemCandidate.extracted_item_id.in_(
                    select(ExtractedItem.id).where(
                        ExtractedItem.document_id == document_id
                    )
                )
            )
        )
        session.execute(
            delete(ExtractedItem).where(ExtractedItem.document_id == document_id)
        )
        items = session.scalars(select(Item)).all()
        timestamp = now_iso()
        for position, value in enumerate(extracted, 1):
            row = ExtractedItem(
                id=str(uuid.uuid4()),
                document_id=document_id,
                position=position,
                raw_line_text=value.raw_line_text[:4000],
                product_name=value.product_name[:500],
                brand=value.brand[:250],
                specification=value.specification[:4000],
                size=value.size[:160],
                quantity=value.quantity,
                unit=value.unit[:100],
                notes=value.notes[:2000],
                extraction_confidence=value.extraction_confidence,
                created_at=timestamp,
                updated_at=timestamp,
            )
            candidates = match_items(row, items)
            row.match_state, row.selected_item_id = match_state(candidates)
            session.add(row)
            for rank, candidate in enumerate(candidates, 1):
                session.add(
                    ItemCandidate(
                        id=str(uuid.uuid4()),
                        extracted_item_id=row.id,
                        item_id=candidate.item_id,
                        score=candidate.score,
                        rank=rank,
                        reasons=candidate.reasons,
                        created_at=timestamp,
                    )
                )
        document.raw_text = ocr.raw_text
        document.ocr_confidence = ocr.confidence
        document.page_count = ocr.page_count
        document.provider_metadata = {
            "ocr": ocr.provider_data,
            "extraction": extraction_metadata,
        }
        document.status = "review_required"
        document.failure_code = ""
        document.failure_message = ""
        document.updated_at = timestamp
        audit(
            session,
            document.request_id,
            "document_processed",
            document_id=document.id,
            actor="system",
            details={"items": len(extracted), "pages": ocr.page_count},
        )
        session.commit()


def confirm_document(session, document: PurchaseRequestDocument, actor: str) -> int:
    if document.status != "review_required":
        raise ValueError("Document is not ready for review confirmation")
    rows = session.scalars(
        select(ExtractedItem)
        .where(ExtractedItem.document_id == document.id)
        .order_by(ExtractedItem.position)
    ).all()
    accepted = [row for row in rows if not row.excluded]
    if not accepted:
        raise ValueError("At least one reviewed item is required")
    for row in accepted:
        if (
            not row.product_name.strip()
            or row.quantity is None
            or row.quantity <= 0
            or not row.unit.strip()
        ):
            raise ValueError(
                "Every included row needs a product, positive quantity, and unit"
            )
    current = session.scalars(
        select(IncomingPurchaseRequestItem)
        .where(IncomingPurchaseRequestItem.request_id == document.request_id)
        .order_by(IncomingPurchaseRequestItem.position.desc())
    ).first()
    position = current.position if current else 0
    for row in accepted:
        position += 1
        matched = (
            session.get(Item, row.selected_item_id) if row.selected_item_id else None
        )
        session.add(
            IncomingPurchaseRequestItem(
                id=str(uuid.uuid4()),
                request_id=document.request_id,
                position=position,
                product_name=(
                    (matched.product_name or matched.name)
                    if matched
                    else row.product_name.strip()
                ),
                preferred_brand=(matched.brand if matched else row.brand).strip(),
                main_category=(matched.main_category if matched else "").strip(),
                subcategory=(matched.subcategory if matched else "").strip(),
                specifications=(
                    matched.specifications if matched else row.specification
                ).strip(),
                quantity=row.quantity,
                unit=(matched.unit if matched and matched.unit else row.unit).strip(),
            )
        )
    timestamp = now_iso()
    document.status = "confirmed"
    document.confirmed_by = actor[:160]
    document.confirmed_at = timestamp
    document.updated_at = timestamp
    audit(
        session,
        document.request_id,
        "document_items_confirmed",
        document_id=document.id,
        actor=actor,
        details={"items_added": len(accepted)},
    )
    session.flush()
    return len(accepted)
