"""Authenticated Site Portal API: context, Item Master search, previously
requested products, and purchase-request submission.

This intentionally reuses the existing incoming_purchase_requests /
incoming_purchase_request_items tables (the same tables the anonymous
public-intake flow in incoming_requests.py writes to) so a Site Portal
submission enters the one existing formal Incoming Purchase Request
workflow — it is not a second request system. The anonymous public
endpoint (POST /api/public/purchase-requests) is untouched; this module
only adds a new, separate, authenticated creation path.

Every endpoint here requires an authenticated, active site_portal user
(require_site_portal, from auth/service.py). Nothing here trusts a
client-supplied requester name, project id, or item name — see
_resolve_project and submit_portal_request for the server-side checks.
"""

from __future__ import annotations

import hashlib
import ntpath
import posixpath
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, or_, select

try:
    from .attachment_storage import (
        delete_attachments_quietly_async, put_attachment,
    )
    from .auth.models import User, UserProjectAccess
    from .auth.service import require_site_portal
    from .database import Item, Project, SessionLocal
    from .incoming_requests import (
        MAX_ITEMS, PRIORITIES,
        IncomingPurchaseRequest, IncomingPurchaseRequestItem,
        IncomingRequestGeneralAttachment, IncomingRequestStatusHistory, InternalNotification,
        _detect_file_type,
    )
except ImportError:  # pragma: no cover - direct backend execution
    from attachment_storage import (
        delete_attachments_quietly_async, put_attachment,
    )
    from auth.models import User, UserProjectAccess
    from auth.service import require_site_portal
    from database import Item, Project, SessionLocal
    from incoming_requests import (
        MAX_ITEMS, PRIORITIES,
        IncomingPurchaseRequest, IncomingPurchaseRequestItem,
        IncomingRequestGeneralAttachment, IncomingRequestStatusHistory, InternalNotification,
        _detect_file_type,
    )

router = APIRouter(prefix="/api/portal", tags=["site-portal"])

DELIVERY_DESTINATIONS = {"site", "warehouse"}
DESTINATION_LABEL = {"site": "الموقع", "warehouse": "المخزن"}
PREVIOUS_ITEMS_LIMIT = 12
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_FILE_BYTES = 25 * 1024 * 1024
MAX_ATTACHMENTS = 10


def _detect_extended_file_type(content: bytes) -> tuple[str, str] | None:
    """Same allowlist as _detect_file_type (PDF/JPEG/PNG/WebP), plus Excel.
    Still a pure signature check, same shallow-detection philosophy as the
    rest of this codebase's attachment handling — not a content parser.
    XLSX is OOXML (a ZIP container); this only confirms the ZIP signature,
    not that the archive is actually a spreadsheet."""
    basic = _detect_file_type(content)
    if basic:
        return basic
    if content.startswith(b"PK\x03\x04"):
        return (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx",
        )
    if content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "application/vnd.ms-excel", ".xls"
    return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _local_today():
    """Application-local date used for delivery-date boundaries."""
    return datetime.now().astimezone().date()


class ProjectRef(BaseModel):
    id: str
    code: str
    name: str


class PortalContext(BaseModel):
    requester_name: str
    projects: List[ProjectRef]
    default_project_id: Optional[str] = None


class ItemRef(BaseModel):
    id: str
    code: str
    name: str
    unit: str
    main_category: str


class PortalRequestItemIn(BaseModel):
    # Master-linked line: item_id set, product_name/unit empty (both are
    # always derived from Item Master server-side, never trusted from here).
    # Manual line: item_id empty, product_name + unit required.
    item_id: str = Field(default="", max_length=64)
    product_name: str = Field(default="", max_length=200)
    unit: str = Field(default="", max_length=50)
    quantity: float = Field(gt=0, le=1_000_000_000)
    note: str = Field(default="", max_length=2000)


class PortalRequestIn(BaseModel):
    required_delivery_date: str = Field(min_length=10, max_length=10)
    priority: str
    delivery_destination: str
    notes: str = Field(default="", max_length=4000)
    # Only consulted when the user has more than one assigned project (see
    # _resolve_project) — never trusted for a single-project user.
    project_id: str = Field(default="", max_length=64)
    items: List[PortalRequestItemIn] = Field(min_length=1, max_length=MAX_ITEMS)


class CorrectionDraftIn(BaseModel):
    """One returned item's pending correction — saved as a draft, never a REQ
    by itself. See save_returned_item_correction / resubmit_corrected_items."""
    product_name: str = Field(default="", max_length=200)
    unit: str = Field(default="", max_length=50)
    quantity: float = Field(gt=0, le=1_000_000_000)
    note: str = Field(default="", max_length=2000)
    required_delivery_date: str = Field(default="", max_length=10)


class ResubmitCorrectionsIn(BaseModel):
    item_ids: List[str] = Field(min_length=1, max_length=MAX_ITEMS)


def _owned_request(session, request_id: str, user: User) -> IncomingPurchaseRequest:
    row = session.get(IncomingPurchaseRequest, request_id)
    if not row or row.requester_user_id != user.id:
        # Do not reveal whether another Site Engineer's request exists.
        raise HTTPException(404, "طلب الشراء غير موجود")
    return row


def _clarification_summary(history: list[IncomingRequestStatusHistory]) -> dict | None:
    entry = next((item for item in reversed(history) if item.to_status == "need_clarification"), None)
    if not entry:
        return None
    resubmitted = next((
        item for item in history
        if item.created_at > entry.created_at
        and item.from_status == "need_clarification"
        and item.to_status == "under_review"
    ), None)
    return {
        "reason": entry.note or "",
        "requested_by": entry.changed_by or "",
        "requested_at": entry.created_at,
        "response_status": "submitted" if resubmitted else "awaiting_response",
        "response": resubmitted.note if resubmitted else "",
        "responded_at": resubmitted.created_at if resubmitted else None,
    }


@router.get("/purchase-requests")
def list_portal_requests(user: User = Depends(require_site_portal)) -> list[dict]:
    """Read the current Site Engineer's own REQs from the formal workflow."""
    with SessionLocal() as session:
        requests = session.scalars(
            select(IncomingPurchaseRequest)
            .where(IncomingPurchaseRequest.requester_user_id == user.id)
            .order_by(IncomingPurchaseRequest.created_at.desc())
            .limit(50)
        ).all()
        request_ids = [row.id for row in requests]
        histories = session.scalars(
            select(IncomingRequestStatusHistory)
            .where(IncomingRequestStatusHistory.request_id.in_(request_ids))
            .order_by(IncomingRequestStatusHistory.created_at)
        ).all() if request_ids else []
        history_by_request: dict[str, list[IncomingRequestStatusHistory]] = {}
        for item in histories:
            history_by_request.setdefault(item.request_id, []).append(item)
        return [{
            "id": row.id,
            "request_number": row.request_number,
            "project_name": row.project_name,
            "required_delivery_date": row.required_delivery_date,
            "priority": row.priority,
            "status": row.status,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "clarification": _clarification_summary(history_by_request.get(row.id, [])),
        } for row in requests]


def _returned_item_eligible(item: IncomingPurchaseRequestItem) -> bool:
    return item.review_status in {"rejected", "need_clarification"}


def _draft_ready(item: IncomingPurchaseRequestItem) -> bool:
    draft = item.correction_draft or {}
    return bool(draft.get("product_name") and draft.get("unit") and (draft.get("quantity") or 0) > 0)


@router.get("/returned-items")
def list_returned_items(user: User = Depends(require_site_portal)) -> list[dict]:
    """Return only this Site Engineer's item-level exceptions, grouped by
    their original REQ on the frontend via request_id.

    The rows remain part of their original REQ. A linked child REQ is exposed
    once the item has actually been resubmitted (as part of a grouped
    correction), preventing it from being resubmitted a second time. Before
    that, `draft`/`ready` reflect a pending correction saved but not yet
    resubmitted — see save_returned_item_correction / resubmit_corrected_items.
    """
    with SessionLocal() as session:
        records = session.execute(
            select(IncomingPurchaseRequestItem, IncomingPurchaseRequest)
            .join(
                IncomingPurchaseRequest,
                IncomingPurchaseRequest.id == IncomingPurchaseRequestItem.request_id,
            )
            .where(
                IncomingPurchaseRequest.requester_user_id == user.id,
                IncomingPurchaseRequestItem.review_status.in_({"rejected", "need_clarification"}),
            )
            .order_by(IncomingPurchaseRequestItem.reviewed_at.desc())
        ).all()
        source_item_ids = [item.id for item, _ in records]
        children = session.execute(
            select(IncomingPurchaseRequestItem, IncomingPurchaseRequest)
            .join(
                IncomingPurchaseRequest,
                IncomingPurchaseRequest.id == IncomingPurchaseRequestItem.request_id,
            )
            .where(IncomingPurchaseRequestItem.source_item_id.in_(source_item_ids))
        ).all() if source_item_ids else []
        child_by_source_item_id = {
            child_item.source_item_id: child_request for child_item, child_request in children
        }
        return [{
            "id": item.id,
            "request_id": request_row.id,
            "request_number": request_row.request_number,
            "project_name": request_row.project_name,
            "item_id": item.item_id,
            "product_name": item.product_name,
            "quantity": item.quantity,
            "unit": item.unit,
            "specifications": item.specifications,
            "status": item.review_status,
            "reason": item.review_reason,
            "reviewer": item.reviewed_by,
            "reviewed_at": item.reviewed_at,
            "draft": item.correction_draft or None,
            "ready": _draft_ready(item) if item.id not in child_by_source_item_id else False,
            "corrected_request": ({
                "id": child_by_source_item_id[item.id].id,
                "request_number": child_by_source_item_id[item.id].request_number,
                "status": child_by_source_item_id[item.id].status,
            } if item.id in child_by_source_item_id else None),
        } for item, request_row in records]


@router.post("/returned-items/{item_id}/correct")
def save_returned_item_correction(
    item_id: str,
    body: CorrectionDraftIn,
    user: User = Depends(require_site_portal),
) -> dict:
    """Save (or update) one returned item's pending correction.

    This never creates a REQ and never edits the original line — it only
    records what the corrected line WOULD look like. Several items from the
    same original REQ can each be drafted independently; they are grouped
    into one corrected child REQ only when resubmit_corrected_items runs.
    """
    with SessionLocal() as session:
        item = session.get(IncomingPurchaseRequestItem, item_id)
        if not item:
            raise HTTPException(404, "الصنف المرتجع غير موجود")
        original = _owned_request(session, item.request_id, user)
        if not _returned_item_eligible(item):
            raise HTTPException(409, "هذا الصنف لا ينتظر تصحيحًا حاليًا")
        already_resubmitted = session.scalar(
            select(IncomingPurchaseRequestItem.id).where(
                IncomingPurchaseRequestItem.source_item_id == item.id,
            )
        )
        if already_resubmitted:
            raise HTTPException(409, "هذا الصنف أُعيد تقديمه بالفعل")

        assigned_project_ids = {project.id for project in _assigned_projects(session, user.id)}
        if original.project_id not in assigned_project_ids:
            raise HTTPException(403, "لم يعد هذا المشروع مخصصًا لحسابك")

        delivery_text = body.required_delivery_date.strip()
        if delivery_text:
            try:
                delivery_date = datetime.strptime(delivery_text, "%Y-%m-%d").date()
            except ValueError as exc:
                raise HTTPException(422, "تاريخ التسليم المطلوب غير صحيح") from exc
            if delivery_date < _local_today():
                raise HTTPException(422, "تاريخ التسليم المطلوب لا يمكن أن يكون في الماضي")

        master_item = session.get(Item, item.item_id) if item.item_id else None
        product_name = (
            (master_item.product_name or master_item.name) if master_item
            else body.product_name.strip()
        )
        unit = (master_item.unit or item.unit) if master_item else body.unit.strip()
        if not product_name:
            raise HTTPException(422, "اسم الصنف المصحح مطلوب")
        if not unit:
            raise HTTPException(422, "وحدة الصنف المصحح مطلوبة")

        timestamp = _now()
        item.correction_draft = {
            "product_name": product_name, "unit": unit,
            "quantity": body.quantity, "note": body.note.strip(),
            "required_delivery_date": delivery_text,
            "saved_by": user.username, "saved_at": timestamp,
        }
        original.updated_at = timestamp
        session.add(IncomingRequestStatusHistory(
            id=str(uuid.uuid4()), request_id=original.id,
            from_status=original.status, to_status=original.status,
            changed_by=user.username,
            note=f"تم تحديث تصحيح البند {item.position} ({product_name})",
            created_at=timestamp,
        ))
        session.commit()
        return {"ok": True, "item_id": item.id, "ready": True, "draft": item.correction_draft}


@router.post("/purchase-requests/{request_id}/resubmit-corrections")
def resubmit_corrected_items(
    request_id: str,
    body: ResubmitCorrectionsIn,
    user: User = Depends(require_site_portal),
) -> dict:
    """Group every currently-ready corrected item from one original REQ into
    ONE new linked child REQ. Atomic: any validation failure aborts the whole
    batch, never a partially-created REQ.

    Idempotent by construction: once an item has a child line (source_item_id
    pointing to it), it is no longer "ready" and cannot be selected again. A
    duplicate/retried call with the exact same item_ids therefore finds those
    items already resubmitted and, if they all resolve to the SAME child REQ
    (the normal double-click/network-retry case), returns that same REQ
    instead of erroring or creating a second one.
    """
    item_ids = list(dict.fromkeys(body.item_ids))  # de-duplicate, keep order

    with SessionLocal() as session:
        original = _owned_request(session, request_id, user)
        assigned_project_ids = {project.id for project in _assigned_projects(session, user.id)}
        if original.project_id not in assigned_project_ids:
            raise HTTPException(403, "لم يعد هذا المشروع مخصصًا لحسابك")
        # The existing-children check below is check-then-insert, and this is
        # a sync route (thread pool), so parallel calls raced even on ONE
        # worker: 10 concurrent clicks on PostgreSQL created 4 child REQs.
        # Locking the original REQ row serializes them; each later caller
        # then sees the first one's committed children and takes the
        # idempotent-retry path. No-op on SQLite, whose single writer already
        # serializes.
        session.execute(
            select(IncomingPurchaseRequest.id)
            .where(IncomingPurchaseRequest.id == original.id)
            .with_for_update()
        )

        items = session.scalars(
            select(IncomingPurchaseRequestItem).where(
                IncomingPurchaseRequestItem.id.in_(item_ids),
                IncomingPurchaseRequestItem.request_id == original.id,
            )
        ).all()
        items_by_id = {row.id: row for row in items}
        missing = [item_id for item_id in item_ids if item_id not in items_by_id]
        if missing:
            # Either unknown, or it belongs to a different original REQ —
            # either way it cannot be grouped into this batch.
            raise HTTPException(422, "بعض الأصناف غير موجودة في هذا الطلب الأصلي")

        ordered_items = [items_by_id[item_id] for item_id in item_ids]

        existing_children = session.execute(
            select(IncomingPurchaseRequestItem.source_item_id, IncomingPurchaseRequestItem.request_id)
            .where(IncomingPurchaseRequestItem.source_item_id.in_(item_ids))
        ).all()
        if existing_children:
            resubmitted_ids = {row[0] for row in existing_children}
            child_request_ids = {row[1] for row in existing_children}
            if resubmitted_ids == set(item_ids) and len(child_request_ids) == 1:
                # Exact retry of an already-completed resubmission (double
                # click, client retry after a dropped response, ...).
                existing_child = session.get(IncomingPurchaseRequest, next(iter(child_request_ids)))
                return {
                    "ok": True, "already_exists": True,
                    "request_id": existing_child.id, "request_number": existing_child.request_number,
                    "source_request_id": original.id, "item_count": len(item_ids),
                }
            raise HTTPException(
                409, "بعض الأصناف المحددة أُعيد تقديمها بالفعل. يرجى تحديث الصفحة",
            )

        for item in ordered_items:
            if not _returned_item_eligible(item):
                raise HTTPException(409, f"البند {item.position} لا ينتظر تصحيحًا حاليًا")
            if not _draft_ready(item):
                raise HTTPException(422, f"البند {item.position} لا يحتوي على تصحيح مكتمل بعد")

        delivery_candidates = [
            item.correction_draft.get("required_delivery_date", "") for item in ordered_items
        ]
        delivery_text = max((value for value in delivery_candidates if value), default="") \
            or original.required_delivery_date
        try:
            delivery_date = datetime.strptime(delivery_text, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(422, "تاريخ التسليم المطلوب غير صحيح") from exc
        if delivery_date < _local_today():
            raise HTTPException(422, "تاريخ التسليم المطلوب لا يمكن أن يكون في الماضي")

        request_id_new = str(uuid.uuid4())
        request_number = f"REQ-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:10].upper()}"
        timestamp = _now()
        combined_notes = " / ".join(
            filter(None, (item.correction_draft.get("note", "") for item in ordered_items))
        )
        try:
            child = IncomingPurchaseRequest(
                id=request_id_new, request_number=request_number,
                requester_name=user.display_name or user.username,
                company_name=original.company_name, phone_number=original.phone_number,
                whatsapp_number=original.whatsapp_number, email=original.email,
                project_name=original.project_name, project_id=original.project_id,
                customer_id=original.customer_id, customer_name=original.customer_name,
                project_location=original.project_location,
                delivery_location=original.delivery_location,
                required_delivery_date=delivery_text, priority=original.priority,
                notes=combined_notes, status="new", assigned_employee="",
                submission_token=str(uuid.uuid4()),
                content_fingerprint=hashlib.sha256(
                    f"corrected-group:{original.id}:{request_id_new}".encode()
                ).hexdigest(),
                requester_user_id=user.id,
                delivery_destination=original.delivery_destination,
                source_request_id=original.id, source_item_id="",
                created_at=timestamp, updated_at=timestamp,
            )
            session.add(child)
            for position, item in enumerate(ordered_items, 1):
                draft = item.correction_draft
                # Re-check the Item Master link still exists — it may have
                # been removed since the draft was saved.
                item_still_linked = bool(item.item_id) and session.get(Item, item.item_id) is not None
                session.add(IncomingPurchaseRequestItem(
                    id=str(uuid.uuid4()), request_id=request_id_new, position=position,
                    item_id=item.item_id if item_still_linked else "",
                    product_name=draft["product_name"],
                    preferred_brand=item.preferred_brand,
                    main_category=item.main_category, subcategory=item.subcategory,
                    specifications=draft.get("note", ""),
                    quantity=draft["quantity"], unit=draft["unit"],
                    source_item_id=item.id,
                ))
            session.add(IncomingRequestStatusHistory(
                id=str(uuid.uuid4()), request_id=request_id_new, from_status="", to_status="new",
                changed_by=user.username,
                note=f"تم الإنشاء من الأصناف المرتجعة للطلب {original.request_number}",
                created_at=timestamp,
            ))
            session.add(IncomingRequestStatusHistory(
                id=str(uuid.uuid4()), request_id=original.id,
                from_status=original.status, to_status=original.status,
                changed_by=user.username,
                note=f"تمت إعادة تقديم {len(ordered_items)} من الأصناف كطلب مصحح {request_number}",
                created_at=timestamp,
            ))
            session.add(InternalNotification(
                id=str(uuid.uuid4()), notification_type="corrected_purchase_request",
                entity_type="incoming_purchase_request", entity_id=request_id_new,
                title=f"طلب مصحح جديد {request_number}",
                message=f"مرتبط بالطلب {original.request_number} — {len(ordered_items)} أصناف",
                is_read=0, created_at=timestamp,
            ))
            original.updated_at = timestamp
            session.commit()
        except Exception:
            session.rollback()
            raise
    return {
        "ok": True, "already_exists": False,
        "request_id": request_id_new, "request_number": request_number,
        "source_request_id": original.id, "item_count": len(ordered_items),
    }


def _clarification_target(
    session, request_id: str, user: User, new_attachment_count: int,
) -> IncomingPurchaseRequest:
    """The caller's own REQ, still awaiting clarification, with room for
    the new attachments - or the matching HTTP error."""
    row = _owned_request(session, request_id, user)
    if row.status != "need_clarification":
        raise HTTPException(409, "هذا الطلب لا ينتظر توضيحًا حاليًا")
    existing_attachment_count = session.scalar(
        select(func.count()).select_from(IncomingRequestGeneralAttachment).where(
            IncomingRequestGeneralAttachment.request_id == request_id,
        )
    ) or 0
    if existing_attachment_count + new_attachment_count > MAX_ATTACHMENTS:
        raise HTTPException(422, f"الحد الأقصى الإجمالي لمرفقات الطلب هو {MAX_ATTACHMENTS}")
    latest_clarification = session.scalar(
        select(IncomingRequestStatusHistory)
        .where(
            IncomingRequestStatusHistory.request_id == row.id,
            IncomingRequestStatusHistory.to_status == "need_clarification",
        )
        .order_by(IncomingRequestStatusHistory.created_at.desc())
    )
    if not latest_clarification:
        raise HTTPException(409, "لم يتم العثور على طلب التوضيح")
    return row


async def _store_portal_attachments(request_id: str, prepared: list[dict]) -> list[str]:
    """Writes prepared attachments under `request_id/` off the event loop
    and sets each one's stored_filename. Returns the written keys; on a
    failure, removes whatever it already wrote and re-raises."""
    written_keys: list[str] = []
    try:
        for attachment in prepared:
            key = f"{request_id}/{uuid.uuid4().hex}{attachment['extension']}"
            await put_attachment(key, attachment["content"], attachment["media_type"], attachment["sha256"])
            attachment["stored_filename"] = key
            written_keys.append(key)
    except Exception:
        await delete_attachments_quietly_async(written_keys)
        raise
    return written_keys


@router.post("/purchase-requests/{request_id}/clarification")
async def submit_clarification(
    request_id: str,
    response: str = Form(...),
    attachments: List[UploadFile] = File(default=[]),
    user: User = Depends(require_site_portal),
) -> dict:
    """Respond on the same REQ and return it to Procurement review."""
    response_text = response.strip()
    if not response_text:
        raise HTTPException(422, "رد التوضيح مطلوب")
    prepared = await _prepare_portal_attachments(attachments)
    with SessionLocal() as session:
        _clarification_target(session, request_id, user, len(prepared))
    # Objects are written with no DB session open (a slow object store must
    # not hold a pooled connection); the request is re-checked below before
    # any metadata row is written, and the objects removed if that fails.
    written_keys = await _store_portal_attachments(request_id, prepared)
    try:
        with SessionLocal() as session:
            # Row lock (PostgreSQL): a concurrent second submission waits,
            # then fails the status re-check instead of also applying.
            session.get(IncomingPurchaseRequest, request_id, with_for_update=True)
            row = _clarification_target(session, request_id, user, len(prepared))
            timestamp = _now()
            for attachment in prepared:
                session.add(IncomingRequestGeneralAttachment(
                    id=str(uuid.uuid4()), request_id=request_id,
                    original_filename=attachment["original_filename"],
                    stored_filename=attachment["stored_filename"],
                    media_type=attachment["media_type"], size_bytes=attachment["size_bytes"],
                    sha256=attachment["sha256"], created_at=timestamp,
                ))
            row.status = "under_review"
            row.updated_at = timestamp
            session.add(IncomingRequestStatusHistory(
                id=str(uuid.uuid4()), request_id=row.id,
                from_status="need_clarification", to_status="under_review",
                changed_by=user.username, note=response_text, created_at=timestamp,
            ))
            session.add(InternalNotification(
                id=str(uuid.uuid4()), notification_type="clarification_submitted",
                entity_type="incoming_purchase_request", entity_id=row.id,
                title=f"تم استلام توضيح للطلب {row.request_number}",
                message=f"أعاد {user.display_name or user.username} الطلب للمراجعة بعد إرسال التوضيح",
                is_read=0, created_at=timestamp,
            ))
            session.commit()
            request_number = row.request_number
    except Exception:
        await delete_attachments_quietly_async(written_keys)
        raise
    return {"ok": True, "request_id": request_id, "request_number": request_number, "status": "under_review"}


def _item_ref(item: Item) -> ItemRef:
    return ItemRef(
        id=item.id, code=item.code,
        name=item.product_name or item.name,
        unit=item.unit, main_category=item.main_category,
    )


def _assigned_projects(session, user_id: str) -> list[Project]:
    access_rows = session.scalars(
        select(UserProjectAccess).where(UserProjectAccess.user_id == user_id)
    ).all()
    project_ids = [row.project_id for row in access_rows]
    if not project_ids:
        return []
    return list(session.scalars(select(Project).where(Project.id.in_(project_ids))).all())


def _resolve_project(session, user: User, requested_project_id: str) -> Project:
    """Server-side project derivation. A client-supplied project_id is only
    ever consulted to disambiguate a user with more than one assignment, and
    even then must already be one of that user's own UserProjectAccess rows."""
    projects = _assigned_projects(session, user.id)
    if not projects:
        raise HTTPException(
            422, "لا يوجد مشروع مخصص لهذا الحساب. برجاء التواصل مع المسؤول",
        )
    if len(projects) == 1:
        return projects[0]
    by_id = {p.id: p for p in projects}
    if requested_project_id not in by_id:
        raise HTTPException(422, "يرجى تحديد أحد المشروعات المخصصة لحسابك")
    return by_id[requested_project_id]


@router.get("/context", response_model=PortalContext)
def get_portal_context(user: User = Depends(require_site_portal)) -> PortalContext:
    with SessionLocal() as session:
        projects = _assigned_projects(session, user.id)
        return PortalContext(
            requester_name=user.display_name or user.username,
            projects=[ProjectRef(id=p.id, code=p.code, name=p.name) for p in projects],
            default_project_id=projects[0].id if len(projects) == 1 else None,
        )


@router.get("/items", response_model=list[ItemRef])
def search_portal_items(
    search: str = "", user: User = Depends(require_site_portal),
) -> list[ItemRef]:
    with SessionLocal() as session:
        statement = select(Item)
        term = search.strip()
        if term:
            like = f"%{term}%"
            statement = statement.where(or_(
                Item.product_name.ilike(like),
                Item.name.ilike(like),
                Item.code.ilike(like),
                Item.main_category.ilike(like),
                Item.subcategory.ilike(like),
            ))
        rows = session.scalars(statement.order_by(Item.name).limit(50)).all()
        return [_item_ref(row) for row in rows]


@router.get("/previous-items", response_model=list[ItemRef])
def previously_requested_items(user: User = Depends(require_site_portal)) -> list[ItemRef]:
    with SessionLocal() as session:
        ranked = session.execute(
            select(
                IncomingPurchaseRequestItem.item_id,
                func.max(IncomingPurchaseRequest.created_at).label("last_at"),
            )
            .join(
                IncomingPurchaseRequest,
                IncomingPurchaseRequest.id == IncomingPurchaseRequestItem.request_id,
            )
            .where(
                IncomingPurchaseRequest.requester_user_id == user.id,
                IncomingPurchaseRequestItem.item_id != "",
            )
            .group_by(IncomingPurchaseRequestItem.item_id)
            .order_by(func.max(IncomingPurchaseRequest.created_at).desc())
            .limit(PREVIOUS_ITEMS_LIMIT)
        ).all()
        if not ranked:
            return []
        ordered_ids = [row[0] for row in ranked]
        items = session.scalars(select(Item).where(Item.id.in_(ordered_ids))).all()
        items_by_id = {item.id: item for item in items}
        return [_item_ref(items_by_id[item_id]) for item_id in ordered_ids if item_id in items_by_id]


def _detect_and_read(content: bytes, filename: str) -> dict:
    detected = _detect_extended_file_type(content)
    if not detected:
        raise HTTPException(422, "المرفقات المسموحة هي صور JPG وPNG وWebP أو PDF أو ملفات Excel فقط")
    media_type, extension = detected
    safe_name = ntpath.basename(posixpath.basename(filename))
    return {
        "content": content, "media_type": media_type, "extension": extension,
        "original_filename": safe_name[:240], "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


async def _prepare_portal_attachments(files: List[UploadFile]) -> list[dict]:
    if len(files) > MAX_ATTACHMENTS:
        raise HTTPException(422, f"الحد الأقصى لعدد المرفقات هو {MAX_ATTACHMENTS}")
    prepared: list[dict] = []
    total = 0
    for index, upload in enumerate(files):
        content = await upload.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(413, "حجم كل مرفق يجب ألا يتجاوز 5 ميجابايت")
        total += len(content)
        if total > MAX_TOTAL_FILE_BYTES:
            raise HTTPException(413, "إجمالي حجم المرفقات يجب ألا يتجاوز 25 ميجابايت")
        prepared.append(_detect_and_read(content, upload.filename or f"attachment-{index}"))
    return prepared


def create_incoming_request(
    session, *, user: User, project: Project, items: list[dict],
    required_delivery_date: str, priority: str, delivery_destination: str,
    notes: str, prepared_attachments: list[dict], intake_note: str,
    source: str = "", request_id: str | None = None,
) -> tuple[str, str]:
    """Create one formal Incoming Purchase Request. This is the single place
    that constructs the IncomingPurchaseRequest/-Item/-Attachment/
    -StatusHistory rows for an authenticated (non-anonymous) intake channel —
    the Site Portal HTTP endpoint below and the WhatsApp intake
    (whatsapp/request_service.py) both call this; neither re-implements it.

    `items` entries are already fully resolved: {item_id ("" for manual),
    product_name, preferred_brand, main_category, subcategory,
    specifications, quantity, unit}. `prepared_attachments` entries must
    already be validated (see _prepare_portal_attachments) AND written to
    storage under `request_id` (see _store_portal_attachments) - this
    function never calls the object store, so it never blocks on it while
    holding `session`; it only writes rows. The caller owns cleanup of the
    stored objects if this raises. Returns (request_id, request_number).
    """
    request_id = request_id or str(uuid.uuid4())
    if any(not attachment.get("stored_filename") for attachment in prepared_attachments):
        raise ValueError("prepared attachments must be stored before create_incoming_request")
    request_number = f"REQ-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:10].upper()}"
    created_at = _now()
    destination_label = DESTINATION_LABEL.get(delivery_destination, delivery_destination)
    delivery_location = (
        (project.address or project.city or destination_label)
        if delivery_destination == "site" else destination_label
    )

    row = IncomingPurchaseRequest(
        id=request_id, request_number=request_number,
        requester_name=user.display_name or user.username,
        company_name="", phone_number="", whatsapp_number="", email="",
        project_name=project.name, project_id=project.id,
        customer_id="", customer_name="",
        project_location=project.address or "", delivery_location=delivery_location,
        required_delivery_date=required_delivery_date, priority=priority,
        notes=notes.strip(), status="new", assigned_employee="",
        submission_token=str(uuid.uuid4()),
        content_fingerprint=hashlib.sha256(f"portal:{request_id}".encode()).hexdigest(),
        requester_user_id=user.id, delivery_destination=delivery_destination,
        source=source, created_at=created_at, updated_at=created_at,
    )
    session.add(row)

    for position, entry in enumerate(items, 1):
        session.add(IncomingPurchaseRequestItem(
            id=str(uuid.uuid4()), request_id=request_id, position=position,
            item_id=entry["item_id"], product_name=entry["product_name"],
            preferred_brand=entry.get("preferred_brand", ""),
            main_category=entry.get("main_category", ""),
            subcategory=entry.get("subcategory", ""),
            specifications=entry.get("specifications", ""),
            quantity=entry["quantity"], unit=entry["unit"],
        ))

    for attachment in prepared_attachments:
        session.add(IncomingRequestGeneralAttachment(
            id=str(uuid.uuid4()), request_id=request_id,
            original_filename=attachment["original_filename"],
            stored_filename=attachment["stored_filename"],
            media_type=attachment["media_type"],
            size_bytes=attachment["size_bytes"], sha256=attachment["sha256"],
            created_at=created_at,
        ))

    session.add(IncomingRequestStatusHistory(
        id=str(uuid.uuid4()), request_id=request_id, from_status="", to_status="new",
        changed_by=user.username, note=intake_note,
        created_at=created_at,
    ))
    session.add(InternalNotification(
        id=str(uuid.uuid4()), notification_type="new_purchase_request",
        entity_type="incoming_purchase_request", entity_id=request_id,
        title=f"طلب شراء وارد جديد {request_number}",
        message=f"من {user.display_name or user.username} — مشروع {project.name}",
        is_read=0, created_at=created_at,
    ))
    session.commit()
    return request_id, request_number


@router.post("/purchase-requests")
async def submit_portal_request(
    payload: str = Form(...),
    attachments: List[UploadFile] = File(default=[]),
    user: User = Depends(require_site_portal),
) -> dict:
    try:
        body = PortalRequestIn.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(422, "يرجى مراجعة الحقول المطلوبة وبيانات الأصناف") from exc

    if body.priority not in PRIORITIES:
        raise HTTPException(422, "درجة الأولوية غير صحيحة")
    if body.delivery_destination not in DELIVERY_DESTINATIONS:
        raise HTTPException(422, "وجهة التسليم غير صحيحة")
    try:
        delivery_date = datetime.strptime(body.required_delivery_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(422, "تاريخ التسليم المطلوب غير صحيح") from exc
    if delivery_date < _local_today():
        raise HTTPException(422, "تاريخ التسليم المطلوب لا يمكن أن يكون في الماضي")

    if not body.items:
        raise HTTPException(422, "أضف صنفًا واحدًا على الأقل")

    master_item_ids = []
    for entry in body.items:
        if entry.item_id and entry.product_name:
            # Reject rather than silently pick one side — an ambiguous line
            # is a client bug, not something to guess at.
            raise HTTPException(
                422, "لا يمكن لصنف واحد أن يكون من قائمة الأصناف وصنفًا يدويًا في نفس الوقت",
            )
        if entry.item_id:
            master_item_ids.append(entry.item_id)
        else:
            if not entry.product_name.strip():
                raise HTTPException(422, "اسم الصنف اليدوي مطلوب")
            if not entry.unit.strip():
                raise HTTPException(422, "وحدة الصنف اليدوي مطلوبة")
    if len(master_item_ids) != len(set(master_item_ids)):
        raise HTTPException(422, "لا يمكن تكرار نفس الصنف في نفس الطلب")

    with SessionLocal() as session:
        project = _resolve_project(session, user, body.project_id)

        items_by_id: dict[str, Item] = {}
        if master_item_ids:
            item_rows = session.scalars(select(Item).where(Item.id.in_(master_item_ids))).all()
            items_by_id = {row.id: row for row in item_rows}
            missing = [item_id for item_id in master_item_ids if item_id not in items_by_id]
            if missing:
                raise HTTPException(422, "أحد الأصناف المختارة غير موجود في قائمة الأصناف")

        prepared = await _prepare_portal_attachments(attachments)

        resolved_items = []
        for entry in body.items:
            if entry.item_id:
                item_row = items_by_id[entry.item_id]
                resolved_items.append({
                    "item_id": item_row.id,
                    "product_name": item_row.product_name or item_row.name,
                    "preferred_brand": item_row.brand or "",
                    "main_category": item_row.main_category or "",
                    "subcategory": item_row.subcategory or "",
                    "specifications": entry.note.strip(),
                    "quantity": entry.quantity, "unit": item_row.unit or "",
                })
            else:
                # Manual line: never linked to Item Master. Procurement
                # decides later whether to convert it via "إضافة للدليل".
                resolved_items.append({
                    "item_id": "", "product_name": entry.product_name.strip(),
                    "preferred_brand": "", "main_category": "", "subcategory": "",
                    "specifications": entry.note.strip(),
                    "quantity": entry.quantity, "unit": entry.unit.strip(),
                })

    # Objects are written with no DB session open (a slow object store must
    # not hold a pooled connection); project access is re-checked in the
    # session that writes the rows, and the objects removed if that fails.
    request_id = str(uuid.uuid4())
    written_keys = await _store_portal_attachments(request_id, prepared)
    try:
        with SessionLocal() as session:
            project = _resolve_project(session, user, body.project_id)
            request_id, request_number = create_incoming_request(
                session, user=user, project=project, items=resolved_items,
                required_delivery_date=body.required_delivery_date, priority=body.priority,
                delivery_destination=body.delivery_destination, notes=body.notes,
                prepared_attachments=prepared,
                intake_note="تم استلام الطلب من بوابة طلبات الموقع",
                source="site_portal", request_id=request_id,
            )
    except Exception:
        await delete_attachments_quietly_async(written_keys)
        raise

    return {"ok": True, "request_number": request_number, "request_id": request_id}
