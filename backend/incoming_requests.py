"""Public intake and protected internal workflow for purchase requests."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

from fastapi import (
    APIRouter, Depends, File, Form, Header, HTTPException, Request, Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import (
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
    or_,
    select,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

try:
    from .attachment_storage import get_attachment_storage
    from .auth.models import User
    from .auth.service import require_erp_role
    from .business_codes import next_business_code
    from .database import Base, Customer, Item, SessionLocal
    from .rate_limit import RateLimiter
except ImportError:
    from attachment_storage import get_attachment_storage
    from auth.models import User
    from auth.service import require_erp_role
    from business_codes import next_business_code
    from database import Base, Customer, Item, SessionLocal
    from rate_limit import RateLimiter
# procurement_workflow imports IncomingPurchaseRequest etc. from this module,
# so _audit/normalize_match must be imported lazily (inside the function that
# needs them) to avoid a circular import at module load time.


MAX_FILE_BYTES = min(int(os.getenv("PUBLIC_MAX_UPLOAD_BYTES", str(5 * 1024 * 1024))), 10 * 1024 * 1024)
MAX_TOTAL_FILE_BYTES = min(
    int(os.getenv("PUBLIC_MAX_TOTAL_UPLOAD_BYTES", str(25 * 1024 * 1024))),
    50 * 1024 * 1024,
)
MAX_ITEMS = min(int(os.getenv("PUBLIC_MAX_REQUEST_ITEMS", "20")), 50)
RATE_LIMIT_MAX = int(os.getenv("PUBLIC_REQUEST_RATE_LIMIT", "5"))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("PUBLIC_REQUEST_RATE_WINDOW_SECONDS", "900"))

REQUEST_STATUSES = {
    "new", "under_review", "need_clarification", "pricing",
    "waiting_for_approval", "approved", "rejected",
    "converted_to_purchase", "completed", "cancelled", "hold",
}
MANUAL_REQUEST_TRANSITIONS = {
    "new": {"under_review", "need_clarification", "hold", "cancelled"},
    "under_review": {"need_clarification", "hold", "cancelled"},
    "need_clarification": {"under_review", "hold", "cancelled"},
    "hold": {"under_review", "need_clarification", "cancelled"},
    "pricing": {"cancelled"},
    "waiting_for_approval": {"cancelled"},
    "approved": {"cancelled"},
    "converted_to_purchase": {"cancelled"},
    "rejected": set(),
    "completed": set(),
    "cancelled": set(),
}
PRIORITIES = {"low", "normal", "high", "urgent"}
DOCUMENT_TYPES = {"internal_request", "purchase_draft"}
TERMINAL_CONVERSION_STATUSES = {"rejected", "completed", "cancelled"}


class IncomingPurchaseRequest(Base):
    __tablename__ = "incoming_purchase_requests"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_number: Mapped[str] = mapped_column(String, unique=True, index=True)
    requester_name: Mapped[str] = mapped_column(String)
    company_name: Mapped[str] = mapped_column(String, default="", server_default="")
    phone_number: Mapped[str] = mapped_column(String)
    whatsapp_number: Mapped[str] = mapped_column(String, default="", server_default="")
    email: Mapped[str] = mapped_column(String, default="", server_default="")
    project_name: Mapped[str] = mapped_column(String)
    project_id: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    customer_id: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    customer_name: Mapped[str] = mapped_column(String, default="", server_default="")
    project_location: Mapped[str] = mapped_column(Text)
    delivery_location: Mapped[str] = mapped_column(Text)
    required_delivery_date: Mapped[str] = mapped_column(String)
    priority: Mapped[str] = mapped_column(String, index=True)
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(
        String, index=True, default="new", server_default="new"
    )
    assigned_employee: Mapped[str] = mapped_column(
        String, default="", server_default=""
    )
    submission_token: Mapped[str] = mapped_column(String, unique=True)
    content_fingerprint: Mapped[str] = mapped_column(String, index=True)
    requester_ip_hash: Mapped[str] = mapped_column(String, default="", server_default="")
    user_agent_hash: Mapped[str] = mapped_column(String, default="", server_default="")
    converted_customer_id: Mapped[str] = mapped_column(
        String, default="", server_default=""
    )
    conversion_type: Mapped[str] = mapped_column(String, default="", server_default="")
    converted_document_id: Mapped[str] = mapped_column(
        String, default="", server_default=""
    )
    # Empty for the anonymous public-intake flow; set for Site Portal
    # submissions (see site_portal.py) so history can be scoped per user
    # without trusting a client-supplied name.
    requester_user_id: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    # Optional ancestry for a corrected item re-submitted from the Site Portal.
    # The original REQ/item remain immutable and auditable; the child gets its
    # own downstream procurement chain.
    source_request_id: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    source_item_id: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    # "site" | "warehouse" for Site Portal submissions; empty for the
    # anonymous public-intake flow, which has no such concept.
    delivery_destination: Mapped[str] = mapped_column(String, default="", server_default="")
    # Intake channel: "" (anonymous public intake, unchanged default),
    # "site_portal", or "whatsapp" (see site_portal.create_incoming_request).
    # Unrelated to source_request_id/source_item_id above, which track
    # corrected-item ancestry, not the intake channel.
    source: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String, index=True)
    updated_at: Mapped[str] = mapped_column(String)


class IncomingPurchaseRequestItem(Base):
    __tablename__ = "incoming_purchase_request_items"
    __table_args__ = (UniqueConstraint("request_id", "position"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_id: Mapped[str] = mapped_column(
        String, ForeignKey("incoming_purchase_requests.id", ondelete="CASCADE"), index=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    # Empty for the anonymous public-intake flow (free-text product_name);
    # set to a real items.id for Site Portal submissions, which may only
    # reference an existing Item Master row (see site_portal.py).
    item_id: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    product_name: Mapped[str] = mapped_column(String)
    preferred_brand: Mapped[str] = mapped_column(String, default="", server_default="")
    main_category: Mapped[str] = mapped_column(String, default="", server_default="")
    subcategory: Mapped[str] = mapped_column(String, default="", server_default="")
    specifications: Mapped[str] = mapped_column(Text, default="", server_default="")
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String)

    review_status: Mapped[str] = mapped_column(
        String,
        default="pending",
        server_default="pending",
        index=True,
    )

    review_reason: Mapped[str] = mapped_column(
        Text,
        default="",
        server_default="",
    )

    reviewed_by: Mapped[str] = mapped_column(
        String,
        default="",
        server_default="",
    )

    reviewed_at: Mapped[str] = mapped_column(
        String,
        default="",
        server_default="",
    )
    hold_since: Mapped[str] = mapped_column(
        String,
        default="",
        server_default="",
    )

    approved_unit_price: Mapped[float] = mapped_column(
        Float,
        default=0,
        server_default=text("0"),
    )

    approved_price_note: Mapped[str] = mapped_column(
        Text,
        default="",
        server_default="",
    )

    # Ancestry for a line inside a corrected child REQ: the ORIGINAL returned
    # item (in the parent REQ) this line was resubmitted from. Empty for every
    # ordinary line. Item-level (not request-level like
    # IncomingPurchaseRequest.source_item_id above) because one grouped
    # corrected REQ can carry several corrected lines, each tracing back to a
    # different original item — see site_portal.py's returned-items flow.
    source_item_id: Mapped[str] = mapped_column(String, index=True, default="", server_default="")

    # Pending correction, saved by the Site Engineer but not yet resubmitted.
    # {} until a draft is saved; then {product_name, unit, quantity, note,
    # required_delivery_date, saved_by, saved_at}. Only meaningful while this
    # item's review_status is "rejected"/"need_clarification" and it has no
    # child line yet (source_item_id of some other item pointing back at it).
    correction_draft: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")

class IncomingRequestAttachment(Base):
    __tablename__ = "incoming_request_attachments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("incoming_purchase_request_items.id", ondelete="CASCADE"),
        unique=True,
    )
    original_filename: Mapped[str] = mapped_column(String)
    stored_filename: Mapped[str] = mapped_column(String, unique=True)
    media_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String)


class IncomingRequestGeneralAttachment(Base):
    """Request-level supporting files (Site Portal), as opposed to
    IncomingRequestAttachment above which is one-file-per-item and used by
    the anonymous public-intake flow. A separate table, not a change to the
    existing one, because request_item_id there is NOT NULL + UNIQUE and
    SQLite cannot relax that without a table rebuild."""

    __tablename__ = "incoming_request_general_attachments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_id: Mapped[str] = mapped_column(
        String, ForeignKey("incoming_purchase_requests.id", ondelete="CASCADE"), index=True,
    )
    original_filename: Mapped[str] = mapped_column(String)
    stored_filename: Mapped[str] = mapped_column(String, unique=True)
    media_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String)


class IncomingRequestStatusHistory(Base):
    __tablename__ = "incoming_request_status_history"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_id: Mapped[str] = mapped_column(
        String, ForeignKey("incoming_purchase_requests.id", ondelete="CASCADE"), index=True,
    )
    from_status: Mapped[str] = mapped_column(String, default="", server_default="")
    to_status: Mapped[str] = mapped_column(String)
    changed_by: Mapped[str] = mapped_column(String, default="", server_default="")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String)


class IncomingRequestInternalNote(Base):
    __tablename__ = "incoming_request_internal_notes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_id: Mapped[str] = mapped_column(
        String, ForeignKey("incoming_purchase_requests.id", ondelete="CASCADE"), index=True,
    )
    author: Mapped[str] = mapped_column(String, default="", server_default="")
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String)


class InternalNotification(Base):
    __tablename__ = "internal_notifications"
    __table_args__ = (
        Index("ix_internal_notifications_unread", "is_read", "created_at"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    notification_type: Mapped[str] = mapped_column(String)
    entity_type: Mapped[str] = mapped_column(String)
    entity_id: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    message: Mapped[str] = mapped_column(Text, default="", server_default="")
    is_read: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    created_at: Mapped[str] = mapped_column(String)


class InternalPurchaseDocument(Base):
    __tablename__ = "internal_purchase_documents"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    document_number: Mapped[str] = mapped_column(String, unique=True)
    document_type: Mapped[str] = mapped_column(String)
    source_request_id: Mapped[str] = mapped_column(
        String, ForeignKey("incoming_purchase_requests.id"), unique=True,
    )
    status: Mapped[str] = mapped_column(String, default="draft", server_default="draft")
    requester_name: Mapped[str] = mapped_column(String)
    company_name: Mapped[str] = mapped_column(String, default="", server_default="")
    customer_id: Mapped[str] = mapped_column(String, default="", server_default="")
    project_name: Mapped[str] = mapped_column(String)
    project_location: Mapped[str] = mapped_column(Text, default="", server_default="")
    delivery_location: Mapped[str] = mapped_column(Text, default="", server_default="")
    required_delivery_date: Mapped[str] = mapped_column(
        String, default="", server_default=""
    )
    priority: Mapped[str] = mapped_column(String)
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_by: Mapped[str] = mapped_column(String, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String)


class InternalPurchaseDocumentItem(Base):
    __tablename__ = "internal_purchase_document_items"
    __table_args__ = (UniqueConstraint("document_id", "position"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String, ForeignKey("internal_purchase_documents.id", ondelete="CASCADE"), index=True,
    )
    source_request_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("incoming_purchase_request_items.id"),
    )
    position: Mapped[int] = mapped_column(Integer)
    product_name: Mapped[str] = mapped_column(String)
    preferred_brand: Mapped[str] = mapped_column(String, default="", server_default="")
    main_category: Mapped[str] = mapped_column(String, default="", server_default="")
    subcategory: Mapped[str] = mapped_column(String, default="", server_default="")
    specifications: Mapped[str] = mapped_column(Text, default="", server_default="")
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String)


class PublicRequestItemIn(BaseModel):
    product_name: str = Field(min_length=2, max_length=200)
    preferred_brand: str = Field(default="", max_length=120)
    main_category: str = Field(default="", max_length=120)
    subcategory: str = Field(default="", max_length=120)
    specifications: str = Field(default="", max_length=2000)
    quantity: float = Field(gt=0, le=1_000_000_000)
    unit: str = Field(min_length=1, max_length=50)
    attachment_index: Optional[int] = Field(default=None, ge=0)


class PublicRequestIn(BaseModel):
    requester_name: str = Field(min_length=2, max_length=160)
    company_name: str = Field(default="", max_length=180)
    phone_number: str = Field(min_length=7, max_length=30)
    whatsapp_number: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=254)
    project_name: str = Field(min_length=2, max_length=200)
    project_location: str = Field(min_length=2, max_length=500)
    delivery_location: str = Field(min_length=2, max_length=500)
    required_delivery_date: str = Field(min_length=10, max_length=10)
    priority: str
    notes: str = Field(default="", max_length=4000)
    submission_token: str = Field(min_length=12, max_length=100)
    items: List[PublicRequestItemIn] = Field(min_length=1, max_length=MAX_ITEMS)


class AssignmentIn(BaseModel):
    employee: str = Field(default="", max_length=160)


class StatusChangeIn(BaseModel):
    status: str
    changed_by: str = Field(default="", max_length=160)
    note: str = Field(default="", max_length=1000)


ITEM_REVIEW_STATUSES = {
    "pending",
    "approved",
    "rejected",
    "need_clarification",
    "hold",
}


class ItemReviewIn(BaseModel):
    status: str
    reason: str = Field(default="", max_length=2000)
    reviewed_by: str = Field(default="", max_length=160)

class ApprovedItemPriceIn(BaseModel):
    unit_price: float = Field(ge=0)
    price_note: str = Field(default="", max_length=2000)
    updated_by: str = Field(default="", max_length=160)

class InternalNoteIn(BaseModel):
    author: str = Field(default="", max_length=160)
    note: str = Field(min_length=2, max_length=4000)


class ConvertIn(BaseModel):
    document_type: str
    converted_by: str = Field(default="", max_length=160)


class ConvertManualItemIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    unit: str = Field(min_length=1, max_length=50)
    main_category: str = Field(default="", max_length=120)
    subcategory: str = Field(default="", max_length=120)
    brand: str = Field(default="", max_length=120)
    specifications: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=2000)


public_router = APIRouter(prefix="/api/public/purchase-requests", tags=["public-purchase-requests"])
internal_router = APIRouter(
    prefix="/api/internal/incoming-purchase-requests",
    tags=["internal-incoming-purchase-requests"],
)

_rate_limiter = RateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS)


@public_router.get("/health", include_in_schema=False)
async def public_request_health():
    return {"ok": True}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_private(value: str) -> str:
    salt = os.getenv("REQUEST_PRIVACY_SALT") or os.getenv("INTERNAL_REQUEST_TOKEN") or "localhost"
    return hashlib.sha256(f"{salt}:{value}".encode("utf-8")).hexdigest()


def _client_ip(request: Request) -> str:
    if os.getenv("TRUST_PROXY_HEADERS", "").lower() == "true":
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def _check_rate_limit(key: str) -> None:
    _rate_limiter.hit(key, "تم إرسال عدد كبير من الطلبات. يرجى المحاولة لاحقاً")


def _validate_public_payload(body: PublicRequestIn) -> None:
    if body.priority not in PRIORITIES:
        raise HTTPException(422, "درجة الأولوية غير صحيحة")
    phone_pattern = re.compile(r"^[+0-9()\-\s]{7,30}$")
    if not phone_pattern.fullmatch(body.phone_number):
        raise HTTPException(422, "رقم الهاتف غير صحيح")
    if body.whatsapp_number and not phone_pattern.fullmatch(body.whatsapp_number):
        raise HTTPException(422, "رقم واتساب غير صحيح")
    if body.email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", body.email):
        raise HTTPException(422, "البريد الإلكتروني غير صحيح")
    try:
        delivery_date = datetime.strptime(body.required_delivery_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(422, "تاريخ التسليم المطلوب غير صحيح") from exc
    if delivery_date < datetime.now(timezone.utc).date():
        raise HTTPException(422, "تاريخ التسليم المطلوب لا يمكن أن يكون في الماضي")


def _fingerprint(body: PublicRequestIn) -> str:
    data = body.model_dump(exclude={"submission_token"})
    normalized = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _detect_file_type(content: bytes) -> tuple[str, str] | None:
    if content.startswith(b"%PDF-"):
        return "application/pdf", ".pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


async def _prepare_attachments(body: PublicRequestIn, files: List[UploadFile]) -> dict[int, dict]:
    referenced = [item.attachment_index for item in body.items if item.attachment_index is not None]
    if len(referenced) != len(set(referenced)):
        raise HTTPException(422, "لا يمكن استخدام نفس المرفق لأكثر من صنف")
    if set(referenced) != set(range(len(files))):
        raise HTTPException(422, "بيانات المرفقات غير متطابقة مع الأصناف")
    prepared: dict[int, dict] = {}
    total = 0
    for index, upload in enumerate(files):
        content = await upload.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(413, "حجم كل مرفق يجب ألا يتجاوز 5 ميجابايت")
        detected = _detect_file_type(content)
        if not detected:
            raise HTTPException(422, "المرفقات المسموحة هي PDF أو صور JPG وPNG وWebP فقط")
        total += len(content)
        if total > MAX_TOTAL_FILE_BYTES:
            raise HTTPException(413, "إجمالي حجم المرفقات يجب ألا يتجاوز 25 ميجابايت")
        media_type, extension = detected
        original = Path(upload.filename or f"attachment{extension}").name[:240]
        prepared[index] = {
            "content": content,
            "media_type": media_type,
            "extension": extension,
            "original_filename": original,
            "size_bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
    return prepared


def require_internal_access(
    request: Request,
    x_internal_token: Optional[str] = Header(default=None, alias="X-Internal-Token"),
) -> None:
    configured = os.getenv("INTERNAL_REQUEST_TOKEN", "").strip()
    if configured:
        if not x_internal_token or not hmac.compare_digest(x_internal_token, configured):
            raise HTTPException(401, "رمز الوصول الداخلي مطلوب")
        return
    if _client_ip(request) not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        raise HTTPException(403, "المسارات الداخلية متاحة محلياً فقط")


def _request_summary(
    row: IncomingPurchaseRequest, item_count: int = 0, source_request_number: str = "",
) -> dict:
    return {
        "id": row.id,
        "request_number": row.request_number,
        "requester_name": row.requester_name,
        "company_name": row.company_name,
        "phone_number": row.phone_number,
        "whatsapp_number": row.whatsapp_number,
        "email": row.email,
        "project_name": row.project_name,
        "project_id": row.project_id,
        "customer_id": row.customer_id,
        "customer_name": row.customer_name,
        "project_location": row.project_location,
        "delivery_location": row.delivery_location,
        "delivery_destination": row.delivery_destination,
        "source": row.source,
        "requester_user_id": row.requester_user_id,
        "source_request_id": row.source_request_id,
        "source_item_id": row.source_item_id,
        "source_request_number": source_request_number,
        "required_delivery_date": row.required_delivery_date,
        "priority": row.priority,
        "notes": row.notes,
        "status": row.status,
        "assigned_employee": row.assigned_employee,
        "converted_customer_id": row.converted_customer_id,
        "conversion_type": row.conversion_type,
        "converted_document_id": row.converted_document_id,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "item_count": item_count,
    }


def _get_request(session, request_id: str) -> IncomingPurchaseRequest:
    row = session.get(IncomingPurchaseRequest, request_id)
    if not row:
        raise HTTPException(404, "طلب الشراء غير موجود")
    return row


def _detail(session, row: IncomingPurchaseRequest) -> dict:
    items = session.scalars(
        select(IncomingPurchaseRequestItem)
        .where(IncomingPurchaseRequestItem.request_id == row.id)
        .order_by(IncomingPurchaseRequestItem.position)
    ).all()
    item_ids = [item.id for item in items]
    attachments = session.scalars(
        select(IncomingRequestAttachment).where(
            IncomingRequestAttachment.request_item_id.in_(item_ids)
        )
    ).all() if item_ids else []
    attachment_map = {attachment.request_item_id: attachment for attachment in attachments}
    source_request_number = ""
    if row.source_request_id:
        source_request_number = session.scalar(
            select(IncomingPurchaseRequest.request_number)
            .where(IncomingPurchaseRequest.id == row.source_request_id)
        ) or ""
    result = _request_summary(row, len(items), source_request_number)
    result["items"] = [{
        "id": item.id,
        "position": item.position,
        "item_id": item.item_id,
        "product_name": item.product_name,
        "preferred_brand": item.preferred_brand,
        "main_category": item.main_category,
        "subcategory": item.subcategory,
        "specifications": item.specifications,
        "quantity": item.quantity,
        "unit": item.unit,
        "review_status": item.review_status,
        "review_reason": item.review_reason,
        "reviewed_by": item.reviewed_by,
        "reviewed_at": item.reviewed_at,
        "source_item_id": item.source_item_id,
        "attachment": ({
            "id": attachment_map[item.id].id,
            "original_filename": attachment_map[item.id].original_filename,
            "media_type": attachment_map[item.id].media_type,
            "size_bytes": attachment_map[item.id].size_bytes,
        } if item.id in attachment_map else None),
    } for item in items]
    result["general_attachments"] = [{
        "id": attachment.id,
        "original_filename": attachment.original_filename,
        "media_type": attachment.media_type,
        "size_bytes": attachment.size_bytes,
    } for attachment in session.scalars(
        select(IncomingRequestGeneralAttachment)
        .where(IncomingRequestGeneralAttachment.request_id == row.id)
        .order_by(IncomingRequestGeneralAttachment.created_at)
    ).all()]
    result["status_history"] = [{
        "id": history.id,
        "from_status": history.from_status,
        "to_status": history.to_status,
        "changed_by": history.changed_by,
        "note": history.note,
        "created_at": history.created_at,
    } for history in session.scalars(
        select(IncomingRequestStatusHistory)
        .where(IncomingRequestStatusHistory.request_id == row.id)
        .order_by(IncomingRequestStatusHistory.created_at)
    ).all()]
    result["internal_notes"] = [{
        "id": note.id, "author": note.author, "note": note.note, "created_at": note.created_at,
    } for note in session.scalars(
        select(IncomingRequestInternalNote)
        .where(IncomingRequestInternalNote.request_id == row.id)
        .order_by(IncomingRequestInternalNote.created_at.desc())
    ).all()]
    document = session.scalars(
        select(InternalPurchaseDocument).where(InternalPurchaseDocument.source_request_id == row.id)
    ).first()
    result["converted_document"] = ({
        "id": document.id,
        "document_number": document.document_number,
        "document_type": document.document_type,
        "status": document.status,
        "created_at": document.created_at,
    } if document else None)
    return result


@public_router.post("")
async def submit_public_request(
    request: Request,
    response: Response,
    payload: str = Form(...),
    website: str = Form(default=""),
    attachments: List[UploadFile] = File(default=[]),
):
    response.headers["Cache-Control"] = "no-store"
    if website.strip():
        raise HTTPException(422, "تعذر إرسال الطلب")
    try:
        body = PublicRequestIn.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(422, "يرجى مراجعة الحقول المطلوبة وبيانات الأصناف") from exc
    _validate_public_payload(body)
    fingerprint = _fingerprint(body)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    with SessionLocal() as session:
        duplicate = session.scalars(
            select(IncomingPurchaseRequest).where(
                or_(
                    IncomingPurchaseRequest.submission_token == body.submission_token,
                    (IncomingPurchaseRequest.content_fingerprint == fingerprint)
                    & (IncomingPurchaseRequest.created_at >= cutoff),
                )
            ).order_by(IncomingPurchaseRequest.created_at.desc())
        ).first()
        if duplicate:
            return {"ok": True, "duplicate": True, "request_number": duplicate.request_number}

    ip_hash = _hash_private(_client_ip(request))
    _check_rate_limit(ip_hash)
    prepared = await _prepare_attachments(body, attachments)
    request_id = str(uuid.uuid4())
    request_number = f"REQ-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:10].upper()}"
    created_at = _now()
    storage = get_attachment_storage()
    written_keys: list[str] = []
    try:
        if prepared:
            for index, attachment in prepared.items():
                stored_name = f"{uuid.uuid4().hex}{attachment['extension']}"
                attachment["stored_filename"] = f"{request_id}/{stored_name}"
                storage.put(
                    attachment["stored_filename"], attachment["content"],
                    attachment["media_type"], attachment["sha256"],
                )
                written_keys.append(attachment["stored_filename"])

        with SessionLocal() as session:
            row = IncomingPurchaseRequest(
                id=request_id,
                request_number=request_number,
                requester_name=body.requester_name.strip(),
                company_name=body.company_name.strip(),
                phone_number=body.phone_number.strip(),
                whatsapp_number=body.whatsapp_number.strip(),
                email=body.email.strip().lower(),
                project_name=body.project_name.strip(),
                project_location=body.project_location.strip(),
                delivery_location=body.delivery_location.strip(),
                required_delivery_date=body.required_delivery_date,
                priority=body.priority,
                notes=body.notes.strip(),
                status="new",
                assigned_employee="",
                submission_token=body.submission_token,
                content_fingerprint=fingerprint,
                requester_ip_hash=ip_hash,
                user_agent_hash=_hash_private(request.headers.get("user-agent", "")),
                created_at=created_at,
                updated_at=created_at,
            )
            session.add(row)
            for position, item in enumerate(body.items, 1):
                item_id = str(uuid.uuid4())
                session.add(IncomingPurchaseRequestItem(
                    id=item_id,
                    request_id=request_id,
                    position=position,
                    product_name=item.product_name.strip(),
                    preferred_brand=item.preferred_brand.strip(),
                    main_category=item.main_category.strip(),
                    subcategory=item.subcategory.strip(),
                    specifications=item.specifications.strip(),
                    quantity=item.quantity,
                    unit=item.unit.strip(),
                ))
                if item.attachment_index is not None:
                    attachment = prepared[item.attachment_index]
                    session.add(IncomingRequestAttachment(
                        id=str(uuid.uuid4()),
                        request_item_id=item_id,
                        original_filename=attachment["original_filename"],
                        stored_filename=attachment["stored_filename"],
                        media_type=attachment["media_type"],
                        size_bytes=attachment["size_bytes"],
                        sha256=attachment["sha256"],
                        created_at=created_at,
                    ))
            session.add(IncomingRequestStatusHistory(
                id=str(uuid.uuid4()), request_id=request_id, from_status="", to_status="new",
                changed_by="public", note="تم استلام الطلب من النموذج العام", created_at=created_at,
            ))
            session.add(InternalNotification(
                id=str(uuid.uuid4()), notification_type="new_purchase_request",
                entity_type="incoming_purchase_request", entity_id=request_id,
                title=f"طلب شراء وارد جديد {request_number}",
                message=f"من {body.requester_name.strip()} — مشروع {body.project_name.strip()}",
                is_read=0, created_at=created_at,
            ))
            session.commit()
    except Exception:
        for key in written_keys:
            storage.delete(key)
        raise
    return {"ok": True, "duplicate": False, "request_number": request_number}


@internal_router.get("", dependencies=[Depends(require_internal_access)])
async def list_incoming_requests(
    search: str = "",
    status: str = "",
    priority: str = "",
    assigned_employee: str = "",
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        statement = select(IncomingPurchaseRequest)
        if search.strip():
            term = f"%{search.strip()}%"
            statement = statement.where(or_(
                IncomingPurchaseRequest.request_number.ilike(term),
                IncomingPurchaseRequest.requester_name.ilike(term),
                IncomingPurchaseRequest.company_name.ilike(term),
                IncomingPurchaseRequest.phone_number.ilike(term),
                IncomingPurchaseRequest.project_name.ilike(term),
            ))
        if status:
            statement = statement.where(IncomingPurchaseRequest.status == status)
        if priority:
            statement = statement.where(IncomingPurchaseRequest.priority == priority)
        if assigned_employee.strip():
            statement = statement.where(
                IncomingPurchaseRequest.assigned_employee.ilike(f"%{assigned_employee.strip()}%")
            )
        rows = session.scalars(statement.order_by(IncomingPurchaseRequest.created_at.desc()).limit(500)).all()
        counts = dict(session.execute(
            select(IncomingPurchaseRequestItem.request_id, func.count())
            .where(IncomingPurchaseRequestItem.request_id.in_([row.id for row in rows]))
            .group_by(IncomingPurchaseRequestItem.request_id)
        ).all()) if rows else {}
        source_ids = {row.source_request_id for row in rows if row.source_request_id}
        source_numbers = dict(session.execute(
            select(IncomingPurchaseRequest.id, IncomingPurchaseRequest.request_number)
            .where(IncomingPurchaseRequest.id.in_(source_ids))
        ).all()) if source_ids else {}
        return [
            _request_summary(row, counts.get(row.id, 0), source_numbers.get(row.source_request_id, ""))
            for row in rows
        ]


@internal_router.get("/notifications", dependencies=[Depends(require_internal_access)])
async def list_request_notifications(unread_only: bool = False, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        statement = select(InternalNotification).where(
            InternalNotification.entity_type == "incoming_purchase_request"
        )
        if unread_only:
            statement = statement.where(InternalNotification.is_read == 0)
        rows = session.scalars(statement.order_by(InternalNotification.created_at.desc()).limit(100)).all()
        return [{
            "id": row.id, "entity_id": row.entity_id, "title": row.title,
            "message": row.message, "is_read": bool(row.is_read), "created_at": row.created_at,
        } for row in rows]


@internal_router.get("/notifications/unread-count", dependencies=[Depends(require_internal_access)])
async def unread_notification_count(current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        count = session.scalar(select(func.count()).select_from(InternalNotification).where(
            (InternalNotification.entity_type == "incoming_purchase_request")
            & (InternalNotification.is_read == 0)
        ))
        return {"count": count or 0}


@internal_router.post("/notifications/{notification_id}/read", dependencies=[Depends(require_internal_access)])
async def mark_notification_read(notification_id: str, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        row = session.get(InternalNotification, notification_id)
        if not row:
            raise HTTPException(404, "الإشعار غير موجود")
        row.is_read = 1
        session.commit()
        return {"ok": True}


@internal_router.get("/{request_id}", dependencies=[Depends(require_internal_access)])
async def get_incoming_request(request_id: str, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        return _detail(session, _get_request(session, request_id))


@internal_router.patch("/{request_id}/assignment", dependencies=[Depends(require_internal_access)])
async def assign_request(request_id: str, body: AssignmentIn, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        row = _get_request(session, request_id)
        row.assigned_employee = body.employee.strip()
        row.updated_at = _now()
        session.commit()
        return _request_summary(row)


@internal_router.post("/{request_id}/notes", dependencies=[Depends(require_internal_access)])
async def add_internal_note(request_id: str, body: InternalNoteIn, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        row = _get_request(session, request_id)
        created_at = _now()
        note = IncomingRequestInternalNote(
            id=str(uuid.uuid4()), request_id=row.id, author=body.author.strip(),
            note=body.note.strip(), created_at=created_at,
        )
        row.updated_at = created_at
        session.add(note)
        session.commit()
        return {"id": note.id, "author": note.author, "note": note.note, "created_at": note.created_at}

@internal_router.patch(
    "/{request_id}/items/{item_id}/review",
    dependencies=[Depends(require_internal_access)],
)
async def review_request_item(
    request_id: str,
    item_id: str,
    body: ItemReviewIn,
    current_user: User = Depends(require_erp_role("procurement_engineer")),
):
    if body.status not in ITEM_REVIEW_STATUSES:
        raise HTTPException(422, "حالة مراجعة الصنف غير صحيحة")

    if body.status in {"rejected", "need_clarification"} and not body.reason.strip():
        raise HTTPException(
            422,
            "سبب الرفض أو طلب الاستكمال مطلوب",
        )

    with SessionLocal() as session:
        row = _get_request(session, request_id)

        item = session.get(IncomingPurchaseRequestItem, item_id)

        if not item or item.request_id != row.id:
            raise HTTPException(404, "الصنف غير موجود في طلب الشراء")

        item.review_status = body.status
        item.review_reason = body.reason.strip()
        item.reviewed_by = current_user.username
        item.reviewed_at = _now()
        if body.status == "hold":
            if not item.hold_since:
                item.hold_since = _now()
        else:
            item.hold_since = ""

        row.updated_at = _now()

        try:
            from .procurement_workflow import _audit
        except ImportError:
            from procurement_workflow import _audit
        _audit(
            session, entity_type="incoming_request_item", entity_id=item.id,
            event_type=f"request_item_{body.status}", project_id=row.project_id,
            actor_name=current_user.username,
            message=f"تم تحديث مراجعة البند {item.product_name}",
            metadata={
                "request_id": row.id, "review_status": body.status,
                "reason": body.reason.strip(), "actor_role": current_user.role,
            },
        )
        session.commit()

        return _detail(session, row)


@internal_router.post("/{request_id}/items/{item_id}/convert-to-item")
async def convert_manual_item_to_master(
    request_id: str, item_id: str, body: ConvertManualItemIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    """Turn one manual (not-in-catalog) request line into a real Item Master
    row, on Procurement's explicit action only - never automatic.

    Sprint 2.3: procurement_responsible (Item Master conversion is a
    procurement/sourcing responsibility), admin always overrides. Was
    admin-only as a temporary measure in 14480fa, before the full ERP role
    model existed.
    """
    try:
        from .procurement_workflow import _audit, normalize_match
    except ImportError:
        from procurement_workflow import _audit, normalize_match

    with SessionLocal() as session:
        row = _get_request(session, request_id)
        line = session.get(IncomingPurchaseRequestItem, item_id)
        if not line or line.request_id != row.id:
            raise HTTPException(404, "الصنف غير موجود في طلب الشراء")

        if line.item_id:
            existing = session.get(Item, line.item_id)
            if existing is None:
                raise HTTPException(409, "هذا السطر مرتبط بصنف غير متاح حاليًا")
            # Idempotent: already converted/linked, never create a second Item.
            return {
                "created": False, "item_id": existing.id,
                "item_code": existing.code, "item_name": existing.name,
            }

        target_name = normalize_match(body.name)
        duplicate = next(
            (candidate for candidate in session.scalars(select(Item)).all()
             if normalize_match(candidate.name) == target_name),
            None,
        )
        if duplicate is not None:
            raise HTTPException(409, {
                "code": "duplicate_item_name",
                "message": "يوجد صنف مشابه بالفعل",
                "existing_item": {
                    "id": duplicate.id, "code": duplicate.code, "name": duplicate.name,
                },
            })

        # Release the read transaction before the sequence table's own
        # serialized transaction (same pattern as convert_requester_to_customer
        # below - important for SQLite/WAL).
        session.commit()
        code = next_business_code("items")

        created_at = _now()
        new_item = Item(
            id=str(uuid.uuid4()), code=code, name=body.name.strip(),
            product_name=body.name.strip(), brand=body.brand.strip(),
            category=body.main_category.strip(), main_category=body.main_category.strip(),
            subcategory=body.subcategory.strip(), unit=body.unit.strip(),
            specs=body.specifications.strip(), specifications=body.specifications.strip(),
            notes=body.notes.strip(), extra_data={},
        )
        session.add(new_item)
        session.flush()

        # Link only - the manual line's original product_name/specifications
        # (the requester's own wording) is preserved verbatim, not overwritten.
        line.item_id = new_item.id
        row.updated_at = created_at

        _audit(
            session, entity_type="incoming_purchase_request", entity_id=row.id,
            event_type="manual_item_converted_to_master",
            message=f"تم تحويل صنف يدوي إلى صنف معتمد {new_item.code}",
            actor_name=current_user.username,
            metadata={
                "request_item_id": line.id, "new_item_id": new_item.id,
                "new_item_code": new_item.code,
            },
        )
        session.commit()

        return {
            "created": True, "item_id": new_item.id,
            "item_code": new_item.code, "item_name": new_item.name,
        }


@internal_router.patch(
    "/{request_id}/items/{item_id}/approved-price",
    dependencies=[Depends(require_internal_access)],
)
async def update_approved_item_price(
    request_id: str,
    item_id: str,
    body: ApprovedItemPriceIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    with SessionLocal() as session:
        row = _get_request(session, request_id)

        item = session.get(IncomingPurchaseRequestItem, item_id)

        if not item or item.request_id != row.id:
            raise HTTPException(404, "الصنف غير موجود في طلب الشراء")

        if item.review_status != "approved":
            raise HTTPException(
                409,
                "لا يمكن إضافة سعر إلا للصنف المعتمد",
            )

        item.approved_unit_price = body.unit_price
        item.approved_price_note = body.price_note.strip()

        row.updated_at = _now()

        session.commit()

        return _detail(session, row)


@internal_router.get(
    "/approved/items",
    dependencies=[Depends(require_internal_access)],
)
async def list_approved_items(current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        rows = session.scalars(
            select(IncomingPurchaseRequestItem)
            .order_by(
                IncomingPurchaseRequestItem.request_id,
                IncomingPurchaseRequestItem.position,
            )
        ).all()

        result = []

        for item in rows:
            request_row = session.get(
                IncomingPurchaseRequest,
                item.request_id,
            )

            if not request_row:
                continue

            result.append({
                "item_id": item.id,
                "request_id": request_row.id,
                "request_number": request_row.request_number,
                "requester_name": request_row.requester_name,
                "company_name": request_row.company_name,
                "project_name": request_row.project_name,
                "phone_number": request_row.phone_number,
                "whatsapp_number": request_row.whatsapp_number,
                "email": request_row.email,
                "position": item.position,
                "product_name": item.product_name,
                "preferred_brand": item.preferred_brand,
                "specifications": item.specifications,
                "quantity": item.quantity,
                "unit": item.unit,
                "review_status": item.review_status,
                "review_reason": item.review_reason,
                "reviewed_by": item.reviewed_by,
                "reviewed_at": item.reviewed_at,
                "hold_since": item.hold_since,
                "approved_unit_price": item.approved_unit_price,
                "approved_price_note": item.approved_price_note,
                "approved_total": item.quantity * item.approved_unit_price,
            })

        return result


@internal_router.get(
    "/hold/overdue",
    dependencies=[Depends(require_internal_access)],
)
async def list_overdue_hold_items(current_user: User = Depends(require_erp_role())):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    with SessionLocal() as session:
        rows = session.scalars(
            select(IncomingPurchaseRequestItem)
            .where(
                IncomingPurchaseRequestItem.review_status == "hold",
                IncomingPurchaseRequestItem.hold_since != "",
                IncomingPurchaseRequestItem.hold_since <= cutoff.isoformat(),
            )
            .order_by(IncomingPurchaseRequestItem.hold_since)
        ).all()

        result = []

        for item in rows:
            request_row = session.get(
                IncomingPurchaseRequest,
                item.request_id,
            )

            if not request_row:
                continue

            result.append({
                "item_id": item.id,
                "request_id": request_row.id,
                "request_number": request_row.request_number,
                "requester_name": request_row.requester_name,
                "company_name": request_row.company_name,
                "project_name": request_row.project_name,
                "position": item.position,
                "product_name": item.product_name,
                "preferred_brand": item.preferred_brand,
                "specifications": item.specifications,
                "quantity": item.quantity,
                "unit": item.unit,
                "review_status": item.review_status,
                "review_reason": item.review_reason,
                "reviewed_by": item.reviewed_by,
                "reviewed_at": item.reviewed_at,
                "hold_since": item.hold_since,
            })

        return result
@internal_router.post("/{request_id}/status", dependencies=[Depends(require_internal_access)])
async def change_request_status(request_id: str, body: StatusChangeIn, current_user: User = Depends(require_erp_role())):
    if body.status not in REQUEST_STATUSES:
        raise HTTPException(422, "حالة الطلب غير صحيحة")
    with SessionLocal() as session:
        row = _get_request(session, request_id)
        previous = row.status
        if previous == body.status:
            return _detail(session, row)
        if body.status not in MANUAL_REQUEST_TRANSITIONS.get(previous, set()):
            raise HTTPException(
                409,
                "لا يمكن تغيير حالة الطلب يدويًا من "
                f"{previous} إلى {body.status}؛ استخدم إجراء سير العمل المخصص",
            )
        changed_at = _now()
        row.status = body.status
        row.updated_at = changed_at
        session.add(IncomingRequestStatusHistory(
            id=str(uuid.uuid4()), request_id=row.id, from_status=previous,
            to_status=body.status, changed_by=body.changed_by.strip(),
            note=body.note.strip(), created_at=changed_at,
        ))
        session.commit()
        return _detail(session, row)


@internal_router.get(
    "/{request_id}/attachments/{attachment_id}",
    dependencies=[Depends(require_internal_access)],
)
async def get_request_attachment(
    request_id: str, attachment_id: str, current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        attachment = session.get(IncomingRequestAttachment, attachment_id)
        if not attachment:
            raise HTTPException(404, "المرفق غير موجود")
        item = session.get(IncomingPurchaseRequestItem, attachment.request_item_id)
        if not item or item.request_id != request_id:
            raise HTTPException(404, "المرفق غير موجود")
        try:
            stored = get_attachment_storage().get(attachment.stored_filename)
        except (FileNotFoundError, KeyError):
            raise HTTPException(404, "ملف المرفق غير موجود")
        return StreamingResponse(
            stored.body,
            media_type=attachment.media_type,
            headers={
                "Cache-Control": "private, no-store",
                "Content-Length": str(stored.content_length),
                "Content-Disposition": (
                    "attachment; filename=attachment; filename*=UTF-8''"
                    f"{quote(attachment.original_filename)}"
                ),
            },
        )


@internal_router.get(
    "/{request_id}/general-attachments/{attachment_id}",
    dependencies=[Depends(require_internal_access)],
)
async def get_request_general_attachment(
    request_id: str, attachment_id: str, current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        attachment = session.get(IncomingRequestGeneralAttachment, attachment_id)
        if not attachment or attachment.request_id != request_id:
            raise HTTPException(404, "المرفق غير موجود")
        try:
            stored = get_attachment_storage().get(attachment.stored_filename)
        except (FileNotFoundError, KeyError):
            raise HTTPException(404, "ملف المرفق غير موجود")
        return StreamingResponse(
            stored.body,
            media_type=attachment.media_type,
            headers={
                "Cache-Control": "private, no-store",
                "Content-Length": str(stored.content_length),
                "Content-Disposition": (
                    "attachment; filename=attachment; filename*=UTF-8''"
                    f"{quote(attachment.original_filename)}"
                ),
            },
        )


@internal_router.post("/{request_id}/convert-customer", dependencies=[Depends(require_internal_access)])
async def convert_requester_to_customer(request_id: str, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        row = _get_request(session, request_id)
        if row.converted_customer_id:
            customer = session.get(Customer, row.converted_customer_id)
            if customer:
                return {"created": False, "customer_id": customer.id, "customer_code": customer.code}
        conditions = [Customer.name == (row.company_name or row.requester_name)]
        if row.phone_number:
            conditions.append(Customer.phone == row.phone_number)
        if row.email:
            conditions.append(Customer.email == row.email)
        customer = session.scalars(select(Customer).where(or_(*conditions))).first()
        created = False
        if not customer:
            # End the lookup transaction before reserving through the independent,
            # serialized sequence transaction (important for SQLite/WAL).
            session.commit()
            customer = Customer(
                id=str(uuid.uuid4()), code=next_business_code("customers"),
                name=row.company_name or row.requester_name,
                contact_person=row.requester_name,
                phone=row.phone_number, whatsapp=row.whatsapp_number, email=row.email,
                address=row.delivery_location, status="نشط",
                notes=f"تم إنشاؤه من طلب الشراء الوارد {row.request_number}",
                extra_data={},
            )
            session.add(customer)
            created = True
        row.converted_customer_id = customer.id
        row.updated_at = _now()
        session.commit()
        return {"created": created, "customer_id": customer.id, "customer_code": customer.code}


@internal_router.post("/{request_id}/convert", dependencies=[Depends(require_internal_access)])
async def convert_request_to_document(request_id: str, body: ConvertIn, current_user: User = Depends(require_erp_role())):
    if body.document_type not in DOCUMENT_TYPES:
        raise HTTPException(422, "نوع التحويل غير صحيح")
    with SessionLocal() as session:
        row = _get_request(session, request_id)
        existing = session.scalars(select(InternalPurchaseDocument).where(
            InternalPurchaseDocument.source_request_id == row.id
        )).first()
        if existing:
            return {
                "created": False, "document_id": existing.id,
                "document_number": existing.document_number,
                "document_type": existing.document_type,
            }
        if row.status in TERMINAL_CONVERSION_STATUSES:
            raise HTTPException(409, "لا يمكن تحويل طلب مغلق أو مرفوض")
        created_at = _now()
        prefix = "IPR" if body.document_type == "internal_request" else "PDR"
        document = InternalPurchaseDocument(
            id=str(uuid.uuid4()),
            document_number=f"{prefix}-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:8].upper()}",
            document_type=body.document_type,
            source_request_id=row.id,
            status="draft",
            requester_name=row.requester_name,
            company_name=row.company_name,
            customer_id=row.converted_customer_id,
            project_name=row.project_name,
            project_location=row.project_location,
            delivery_location=row.delivery_location,
            required_delivery_date=row.required_delivery_date,
            priority=row.priority,
            notes=row.notes,
            created_by=body.converted_by.strip(),
            created_at=created_at,
        )
        session.add(document)
        items = session.scalars(select(IncomingPurchaseRequestItem).where(
            IncomingPurchaseRequestItem.request_id == row.id
        ).order_by(IncomingPurchaseRequestItem.position)).all()
        for item in items:
            session.add(InternalPurchaseDocumentItem(
                id=str(uuid.uuid4()), document_id=document.id,
                source_request_item_id=item.id, position=item.position,
                product_name=item.product_name, preferred_brand=item.preferred_brand,
                main_category=item.main_category, subcategory=item.subcategory,
                specifications=item.specifications, quantity=item.quantity, unit=item.unit,
            ))
        previous = row.status
        row.status = "converted_to_purchase"
        row.conversion_type = body.document_type
        row.converted_document_id = document.id
        row.updated_at = created_at
        session.add(IncomingRequestStatusHistory(
            id=str(uuid.uuid4()), request_id=row.id, from_status=previous,
            to_status="converted_to_purchase", changed_by=body.converted_by.strip(),
            note=f"تم إنشاء مستند داخلي مبدئي {document.document_number}", created_at=created_at,
        ))
        session.commit()
        return {
            "created": True, "document_id": document.id,
            "document_number": document.document_number,
            "document_type": document.document_type,
        }
