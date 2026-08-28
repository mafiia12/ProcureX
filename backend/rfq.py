"""RFQ (Request for Quotation) and Supplier Quotation workflow.

Sits between an Incoming Purchase Request reaching status "pricing" and the
existing Price Comparison (CMP) module: Procurement Responsible sends an RFQ
to one or more suppliers, records each supplier's quotation, and CMP remains
the authoritative comparison/selection record (see /comparison-rows below,
which only prepares rows - it never creates or selects a comparison itself).

Traceability is preserved by ID wherever possible: REQ item -> RFQ item ->
supplier quotation line -> (optionally) a CMP row the frontend builds from
/comparison-rows.
"""

from __future__ import annotations

import ntpath
import posixpath
import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import (
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    delete,
    func,
    select,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from urllib.parse import quote

try:
    from .attachment_storage import get_attachment_storage
    from .auth.models import User
    from .auth.service import require_erp_role
    from .business_codes import reserve_code
    from .database import Base, SessionLocal, Supplier
    from .incoming_requests import (
        IncomingPurchaseRequest, IncomingPurchaseRequestItem, require_internal_access,
    )
    from .site_portal import _detect_extended_file_type
except ImportError:  # pragma: no cover - direct backend execution
    from attachment_storage import get_attachment_storage
    from auth.models import User
    from auth.service import require_erp_role
    from business_codes import reserve_code
    from database import Base, SessionLocal, Supplier
    from incoming_requests import (
        IncomingPurchaseRequest, IncomingPurchaseRequestItem, require_internal_access,
    )
    from site_portal import _detect_extended_file_type

# _audit lives in procurement_workflow.py, which itself imports from
# incoming_requests.py - importing it lazily here (same reason
# incoming_requests.py imports it lazily) avoids a circular import at
# module load time.


router = APIRouter(
    prefix="/api/workflow/rfqs",
    tags=["rfq-supplier-quotations"],
    dependencies=[Depends(require_internal_access)],
)

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_FILE_BYTES = 25 * 1024 * 1024
MAX_ATTACHMENTS = 10
QUOTATION_STATUSES = {"draft", "received", "withdrawn"}


class RequestForQuotation(Base):
    __tablename__ = "rfqs"
    __table_args__ = (
        Index("ix_rfqs_project", "project_id"),
        Index("ix_rfqs_updated", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    rfq_number: Mapped[str] = mapped_column(String, unique=True)
    source_request_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("incoming_purchase_requests.id", ondelete="RESTRICT"),
        unique=True,
    )
    source_request_number: Mapped[str] = mapped_column(String, default="", server_default="")
    project_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True,
    )
    project_name: Mapped[str] = mapped_column(String, default="", server_default="")
    rfq_date: Mapped[str] = mapped_column(String)
    deadline: Mapped[str] = mapped_column(String, default="", server_default="")
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_by: Mapped[str] = mapped_column(String, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)


class RFQItem(Base):
    __tablename__ = "rfq_items"
    __table_args__ = (
        Index("ix_rfq_items_rfq", "rfq_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    rfq_id: Mapped[str] = mapped_column(
        String, ForeignKey("rfqs.id", ondelete="CASCADE"), index=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    source_request_item_id: Mapped[Optional[str]] = mapped_column(
        String,
        ForeignKey("incoming_purchase_request_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    item_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("items.id", ondelete="SET NULL"), nullable=True,
    )
    product_name: Mapped[str] = mapped_column(String)
    specifications: Mapped[str] = mapped_column(Text, default="", server_default="")
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String, default="", server_default="")


class RFQSupplier(Base):
    __tablename__ = "rfq_suppliers"
    __table_args__ = (
        UniqueConstraint("rfq_id", "supplier_id", name="uq_rfq_supplier"),
        Index("ix_rfq_suppliers_rfq", "rfq_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    rfq_id: Mapped[str] = mapped_column(
        String, ForeignKey("rfqs.id", ondelete="CASCADE"), index=True,
    )
    supplier_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True,
    )
    supplier_name: Mapped[str] = mapped_column(String, default="", server_default="")
    added_at: Mapped[str] = mapped_column(String)


class SupplierQuotation(Base):
    __tablename__ = "supplier_quotations"
    __table_args__ = (
        UniqueConstraint("rfq_id", "supplier_id", name="uq_rfq_supplier_quotation"),
        Index("ix_supplier_quotations_rfq", "rfq_id"),
        Index("ix_supplier_quotations_status", "status"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    rfq_id: Mapped[str] = mapped_column(
        String, ForeignKey("rfqs.id", ondelete="CASCADE"), index=True,
    )
    supplier_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True,
    )
    supplier_name: Mapped[str] = mapped_column(String, default="", server_default="")
    quotation_ref: Mapped[str] = mapped_column(String, default="", server_default="")
    quotation_date: Mapped[str] = mapped_column(String, default="", server_default="")
    valid_until: Mapped[str] = mapped_column(String, default="", server_default="")
    payment_terms: Mapped[str] = mapped_column(String, default="", server_default="")
    delivery_terms: Mapped[str] = mapped_column(String, default="", server_default="")
    currency: Mapped[str] = mapped_column(String, default="EGP", server_default="EGP")
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String, default="draft", server_default="draft")
    created_by: Mapped[str] = mapped_column(String, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)


class SupplierQuotationLine(Base):
    __tablename__ = "supplier_quotation_lines"
    __table_args__ = (
        UniqueConstraint("quotation_id", "rfq_item_id", name="uq_quotation_rfq_item"),
        Index("ix_supplier_quotation_lines_quotation", "quotation_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    quotation_id: Mapped[str] = mapped_column(
        String, ForeignKey("supplier_quotations.id", ondelete="CASCADE"), index=True,
    )
    rfq_item_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("rfq_items.id", ondelete="SET NULL"), nullable=True,
    )
    source_request_item_id: Mapped[str] = mapped_column(String, default="", server_default="")
    position: Mapped[int] = mapped_column(Integer)
    product_name: Mapped[str] = mapped_column(String, default="", server_default="")
    quantity: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    unit: Mapped[str] = mapped_column(String, default="", server_default="")
    unit_price: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    discount_pct: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    tax_pct: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    availability: Mapped[str] = mapped_column(
        String, default="available", server_default="available",
    )
    remark: Mapped[str] = mapped_column(Text, default="", server_default="")


class SupplierQuotationAttachment(Base):
    __tablename__ = "supplier_quotation_attachments"
    __table_args__ = (
        Index("ix_supplier_quotation_attachments_quotation", "quotation_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    quotation_id: Mapped[str] = mapped_column(
        String, ForeignKey("supplier_quotations.id", ondelete="CASCADE"), index=True,
    )
    original_filename: Mapped[str] = mapped_column(String)
    stored_filename: Mapped[str] = mapped_column(String, unique=True)
    media_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String)


class RFQCreateIn(BaseModel):
    source_request_id: str = Field(min_length=1)
    deadline: str = Field(default="", max_length=10)
    notes: str = Field(default="", max_length=4000)
    actor: str = ""


class RFQSupplierIn(BaseModel):
    supplier_id: str = Field(min_length=1)
    actor: str = ""


class QuotationCreateIn(BaseModel):
    supplier_id: str = Field(min_length=1)
    actor: str = ""


class QuotationLineIn(BaseModel):
    rfq_item_id: str = Field(min_length=1)
    quantity: float = Field(default=0, ge=0, le=1_000_000_000)
    unit: str = Field(default="", max_length=50)
    unit_price: float = Field(default=0, ge=0, le=1_000_000_000_000)
    discount_pct: float = Field(default=0, ge=0, le=100)
    tax_pct: float = Field(default=0, ge=0, le=100)
    availability: Literal["available", "unavailable"] = "available"
    remark: str = Field(default="", max_length=2000)


class QuotationUpdateIn(BaseModel):
    quotation_ref: str = Field(default="", max_length=200)
    quotation_date: str = Field(default="", max_length=10)
    valid_until: str = Field(default="", max_length=10)
    payment_terms: str = Field(default="", max_length=300)
    delivery_terms: str = Field(default="", max_length=300)
    currency: str = Field(default="EGP", max_length=10)
    notes: str = Field(default="", max_length=4000)
    status: Literal["draft", "received", "withdrawn"] = "draft"
    lines: List[QuotationLineIn] = Field(default_factory=list, max_length=500)
    actor: str = ""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_rfq_number() -> str:
    return reserve_code(
        "rfqs", "RFQ-", 6, ("RFQ-",), RequestForQuotation, RequestForQuotation.rfq_number,
    )


def _formal_quotation_rows(session, item_ids: Optional[set] = None) -> list[dict]:
    """Single source of truth for "latest formal price": one row per line
    of a *received* supplier quotation, newest quotation first. Mirrors the
    join/ordering /api/supplier-price-history already uses, so every
    "latest formal price" lookup (item page, comparison last-price) agrees
    with that screen instead of running its own logic.

    Legacy direct-purchase history (PriceHistory / price_history) never
    feeds this - only RFQ -> SupplierQuotation(status="received") data
    counts as formal.
    """
    statement = (
        select(SupplierQuotationLine, SupplierQuotation, RFQItem)
        .join(SupplierQuotation, SupplierQuotation.id == SupplierQuotationLine.quotation_id)
        .outerjoin(RFQItem, RFQItem.id == SupplierQuotationLine.rfq_item_id)
        .where(SupplierQuotation.status == "received")
        .order_by(
            SupplierQuotation.quotation_date.desc(),
            SupplierQuotation.updated_at.desc(),
            SupplierQuotationLine.position,
        )
    )
    if item_ids is not None:
        if not item_ids:
            return []
        statement = statement.where(RFQItem.item_id.in_(item_ids))
    rows = []
    for line, quotation, rfq_item in session.execute(statement).all():
        item_id = rfq_item.item_id if rfq_item else None
        if not item_id:
            continue
        rows.append({
            "item_id": item_id,
            "supplier_id": quotation.supplier_id or "",
            "supplier_name": quotation.supplier_name,
            "unit_price": float(line.unit_price or 0),
            "date": quotation.quotation_date or quotation.created_at[:10],
            "quotation_id": quotation.id,
        })
    return rows


def latest_formal_price_by_item(session, item_ids: Optional[set] = None) -> dict:
    """Latest formal (received supplier quotation) price per item, any supplier."""
    result: dict = {}
    for row in _formal_quotation_rows(session, item_ids):
        result.setdefault(row["item_id"], row)
    return result


def latest_formal_price_by_item_supplier(session, pairs: Optional[set] = None) -> dict:
    """Latest formal price per (item_id, supplier_id) pair.

    `pairs`, when given, is a set of (item_id, supplier_id) tuples - used
    only to narrow the underlying query to the relevant items (avoids
    scanning every quotation line when the caller only needs a handful of
    items, e.g. one comparison screen).
    """
    item_ids = {item_id for item_id, _supplier_id in pairs} if pairs is not None else None
    result: dict = {}
    for row in _formal_quotation_rows(session, item_ids):
        key = (row["item_id"], row["supplier_id"])
        result.setdefault(key, row)
    return result


def _line_total(line: SupplierQuotationLine) -> float:
    subtotal = float(line.quantity or 0) * float(line.unit_price or 0)
    discount = subtotal * float(line.discount_pct or 0) / 100
    taxable = subtotal - discount
    tax = taxable * float(line.tax_pct or 0) / 100
    return round(taxable + tax, 2)


def _line_document(line: SupplierQuotationLine) -> dict:
    return {
        "id": line.id,
        "rfq_item_id": line.rfq_item_id or "",
        "source_request_item_id": line.source_request_item_id,
        "product_name": line.product_name,
        "quantity": line.quantity,
        "unit": line.unit,
        "unit_price": line.unit_price,
        "discount_pct": line.discount_pct,
        "tax_pct": line.tax_pct,
        "availability": line.availability,
        "remark": line.remark,
        "line_total": _line_total(line),
    }


def _quotation_summary(session, quotation: SupplierQuotation) -> dict:
    lines = session.scalars(
        select(SupplierQuotationLine)
        .where(SupplierQuotationLine.quotation_id == quotation.id)
        .order_by(SupplierQuotationLine.position)
    ).all()
    attachments = session.scalars(
        select(SupplierQuotationAttachment)
        .where(SupplierQuotationAttachment.quotation_id == quotation.id)
        .order_by(SupplierQuotationAttachment.created_at)
    ).all()
    return {
        "id": quotation.id,
        "rfq_id": quotation.rfq_id,
        "supplier_id": quotation.supplier_id or "",
        "supplier_name": quotation.supplier_name,
        "quotation_ref": quotation.quotation_ref,
        "quotation_date": quotation.quotation_date,
        "valid_until": quotation.valid_until,
        "payment_terms": quotation.payment_terms,
        "delivery_terms": quotation.delivery_terms,
        "currency": quotation.currency,
        "notes": quotation.notes,
        "status": quotation.status,
        "line_count": len(lines),
        "attachment_count": len(attachments),
        "attachments": [
            {
                "id": attachment.id,
                "original_filename": attachment.original_filename,
                "media_type": attachment.media_type,
                "size_bytes": attachment.size_bytes,
                "download_url": (
                    f"/workflow/rfqs/{quotation.rfq_id}/quotations/{quotation.id}"
                    f"/attachments/{attachment.id}"
                ),
            }
            for attachment in attachments
        ],
        "total_value": round(sum(_line_total(line) for line in lines), 2),
        "created_at": quotation.created_at,
        "updated_at": quotation.updated_at,
        "lines": [_line_document(line) for line in lines],
    }


def _rfq_detail(session, rfq: RequestForQuotation) -> dict:
    items = session.scalars(
        select(RFQItem).where(RFQItem.rfq_id == rfq.id).order_by(RFQItem.position)
    ).all()
    suppliers = session.scalars(
        select(RFQSupplier).where(RFQSupplier.rfq_id == rfq.id).order_by(RFQSupplier.added_at)
    ).all()
    quotations = session.scalars(
        select(SupplierQuotation).where(SupplierQuotation.rfq_id == rfq.id)
    ).all()
    quotation_summaries = [_quotation_summary(session, quotation) for quotation in quotations]
    return {
        "id": rfq.id,
        "rfq_number": rfq.rfq_number,
        "source_request_id": rfq.source_request_id,
        "source_request_number": rfq.source_request_number,
        "project_id": rfq.project_id or "",
        "project_name": rfq.project_name,
        "rfq_date": rfq.rfq_date,
        "deadline": rfq.deadline,
        "notes": rfq.notes,
        "created_by": rfq.created_by,
        "created_at": rfq.created_at,
        "updated_at": rfq.updated_at,
        "items": [
            {
                "id": item.id,
                "source_request_item_id": item.source_request_item_id or "",
                "item_id": item.item_id or "",
                "product_name": item.product_name,
                "specifications": item.specifications,
                "quantity": item.quantity,
                "unit": item.unit,
                "position": item.position,
            }
            for item in items
        ],
        "suppliers": [
            {
                "id": supplier.id,
                "supplier_id": supplier.supplier_id or "",
                "supplier_name": supplier.supplier_name,
                "added_at": supplier.added_at,
            }
            for supplier in suppliers
        ],
        "quotations": quotation_summaries,
        "supplier_count": len(suppliers),
        "received_quotation_count": sum(
            1 for quotation in quotations if quotation.status == "received"
        ),
    }


@router.post("")
def create_rfq(
    body: RFQCreateIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    try:
        from .procurement_workflow import _audit
    except ImportError:
        from procurement_workflow import _audit

    with SessionLocal() as session:
        request_row = session.get(IncomingPurchaseRequest, body.source_request_id)
        if not request_row:
            raise HTTPException(404, "طلب الشراء غير موجود")

        existing = session.scalar(
            select(RequestForQuotation).where(
                RequestForQuotation.source_request_id == request_row.id
            )
        )
        if existing:
            return {"already_exists": True, "rfq": _rfq_detail(session, existing)}

        if request_row.status != "pricing":
            raise HTTPException(
                409, "لا يمكن إنشاء طلب تسعير إلا بعد اعتماد الطلب فنيًا للتسعير",
            )
        if not request_row.project_id:
            raise HTTPException(409, "يجب ربط الطلب بمشروع قبل إنشاء طلب تسعير")

        items = session.scalars(
            select(IncomingPurchaseRequestItem)
            .where(
                IncomingPurchaseRequestItem.request_id == request_row.id,
                IncomingPurchaseRequestItem.review_status == "approved",
            )
            .order_by(IncomingPurchaseRequestItem.position)
        ).all()
        if not items:
            raise HTTPException(409, "لا توجد أصناف معتمدة مؤهلة للتسعير في طلب الشراء")

        request_id = request_row.id
        request_number = request_row.request_number
        project_id = request_row.project_id
        project_name = request_row.project_name

        # Release the read transaction before the sequence table's own
        # serialized transaction (same pattern as convert_manual_item_to_master).
        session.commit()
        rfq_number = _next_rfq_number()

        timestamp = _now()
        rfq = RequestForQuotation(
            id=str(uuid.uuid4()), rfq_number=rfq_number,
            source_request_id=request_id, source_request_number=request_number,
            project_id=project_id, project_name=project_name,
            rfq_date=timestamp[:10], deadline=body.deadline.strip(),
            notes=body.notes.strip(), created_by=current_user.username,
            created_at=timestamp, updated_at=timestamp,
        )
        session.add(rfq)
        session.flush()
        for position, item in enumerate(items, start=1):
            session.add(RFQItem(
                id=str(uuid.uuid4()), rfq_id=rfq.id, position=position,
                source_request_item_id=item.id, item_id=item.item_id or None,
                product_name=item.product_name, specifications=item.specifications,
                quantity=item.quantity, unit=item.unit,
            ))
        _audit(
            session, entity_type="rfq", entity_id=rfq.id, event_type="rfq_created",
            project_id=project_id or "", actor_name=current_user.username,
            message=f"تم إنشاء طلب تسعير {rfq_number} من الطلب {request_number}",
            metadata={
                "source_request_id": request_id, "actor_role": current_user.role,
                "eligible_item_count": len(items),
            },
        )
        session.commit()
        return {"already_exists": False, "rfq": _rfq_detail(session, rfq)}


@router.get("/by-request/{request_id}")
def get_rfq_by_request(
    request_id: str, current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        rfq = session.scalar(
            select(RequestForQuotation).where(
                RequestForQuotation.source_request_id == request_id
            )
        )
        if not rfq:
            raise HTTPException(404, "لا يوجد طلب تسعير لهذا الطلب بعد")
        return _rfq_detail(session, rfq)


@router.get("/{rfq_id}")
def get_rfq(rfq_id: str, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        rfq = session.get(RequestForQuotation, rfq_id)
        if not rfq:
            raise HTTPException(404, "طلب التسعير غير موجود")
        return _rfq_detail(session, rfq)


@router.post("/{rfq_id}/suppliers")
def add_rfq_supplier(
    rfq_id: str, body: RFQSupplierIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    try:
        from .procurement_workflow import _audit
    except ImportError:
        from procurement_workflow import _audit

    with SessionLocal() as session:
        rfq = session.get(RequestForQuotation, rfq_id)
        if not rfq:
            raise HTTPException(404, "طلب التسعير غير موجود")
        supplier = session.get(Supplier, body.supplier_id)
        if not supplier:
            raise HTTPException(422, "المورد المحدد غير موجود")

        existing = session.scalar(
            select(RFQSupplier).where(
                RFQSupplier.rfq_id == rfq.id, RFQSupplier.supplier_id == supplier.id,
            )
        )
        if existing:
            return {"already_exists": True, "rfq": _rfq_detail(session, rfq)}

        session.add(RFQSupplier(
            id=str(uuid.uuid4()), rfq_id=rfq.id, supplier_id=supplier.id,
            supplier_name=supplier.name, added_at=_now(),
        ))
        rfq.updated_at = _now()
        _audit(
            session, entity_type="rfq", entity_id=rfq.id, event_type="rfq_supplier_added",
            project_id=rfq.project_id or "", actor_name=current_user.username,
            message=f"تمت إضافة المورد {supplier.name} لطلب التسعير {rfq.rfq_number}",
            metadata={"supplier_id": supplier.id, "actor_role": current_user.role},
        )
        session.commit()
        return {"already_exists": False, "rfq": _rfq_detail(session, rfq)}


@router.post("/{rfq_id}/quotations")
def create_quotation(
    rfq_id: str, body: QuotationCreateIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    try:
        from .procurement_workflow import _audit
    except ImportError:
        from procurement_workflow import _audit

    with SessionLocal() as session:
        rfq = session.get(RequestForQuotation, rfq_id)
        if not rfq:
            raise HTTPException(404, "طلب التسعير غير موجود")
        rfq_supplier = session.scalar(
            select(RFQSupplier).where(
                RFQSupplier.rfq_id == rfq.id, RFQSupplier.supplier_id == body.supplier_id,
            )
        )
        if not rfq_supplier:
            raise HTTPException(422, "يجب إضافة المورد لطلب التسعير أولاً")

        existing = session.scalar(
            select(SupplierQuotation).where(
                SupplierQuotation.rfq_id == rfq.id,
                SupplierQuotation.supplier_id == rfq_supplier.supplier_id,
            )
        )
        if existing:
            return {"already_exists": True, "quotation": _quotation_summary(session, existing)}

        timestamp = _now()
        quotation = SupplierQuotation(
            id=str(uuid.uuid4()), rfq_id=rfq.id, supplier_id=rfq_supplier.supplier_id,
            supplier_name=rfq_supplier.supplier_name, currency="EGP", status="draft",
            created_by=current_user.username, created_at=timestamp, updated_at=timestamp,
        )
        session.add(quotation)
        _audit(
            session, entity_type="supplier_quotation", entity_id=quotation.id,
            event_type="supplier_quotation_created", project_id=rfq.project_id or "",
            actor_name=current_user.username,
            message=f"تم تسجيل عرض سعر من {rfq_supplier.supplier_name} لطلب التسعير {rfq.rfq_number}",
            metadata={
                "rfq_id": rfq.id, "supplier_id": rfq_supplier.supplier_id,
                "actor_role": current_user.role,
            },
        )
        session.commit()
        return {"already_exists": False, "quotation": _quotation_summary(session, quotation)}


@router.put("/{rfq_id}/quotations/{quotation_id}")
def update_quotation(
    rfq_id: str, quotation_id: str, body: QuotationUpdateIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    try:
        from .procurement_workflow import _audit
    except ImportError:
        from procurement_workflow import _audit

    with SessionLocal() as session:
        rfq = session.get(RequestForQuotation, rfq_id)
        if not rfq:
            raise HTTPException(404, "طلب التسعير غير موجود")
        quotation = session.get(SupplierQuotation, quotation_id)
        if not quotation or quotation.rfq_id != rfq.id:
            raise HTTPException(404, "عرض السعر غير موجود")

        valid_item_ids = {
            row.id for row in session.scalars(
                select(RFQItem).where(RFQItem.rfq_id == rfq.id)
            ).all()
        }
        for line in body.lines:
            if line.rfq_item_id not in valid_item_ids:
                raise HTTPException(422, "بند غير مرتبط بطلب التسعير هذا")
        item_ids_in_lines = [line.rfq_item_id for line in body.lines]
        if len(item_ids_in_lines) != len(set(item_ids_in_lines)):
            raise HTTPException(422, "لا يمكن تكرار نفس البند داخل عرض السعر")

        was_received = quotation.status == "received"
        quotation.quotation_ref = body.quotation_ref.strip()
        quotation.quotation_date = body.quotation_date.strip()
        quotation.valid_until = body.valid_until.strip()
        quotation.payment_terms = body.payment_terms.strip()
        quotation.delivery_terms = body.delivery_terms.strip()
        quotation.currency = body.currency.strip() or "EGP"
        quotation.notes = body.notes.strip()
        quotation.status = body.status
        quotation.updated_at = _now()

        session.execute(
            delete(SupplierQuotationLine).where(
                SupplierQuotationLine.quotation_id == quotation.id
            )
        )
        session.flush()
        rfq_items_by_id = {
            row.id: row for row in session.scalars(
                select(RFQItem).where(RFQItem.rfq_id == rfq.id)
            ).all()
        }
        for position, line in enumerate(body.lines, start=1):
            rfq_item = rfq_items_by_id[line.rfq_item_id]
            session.add(SupplierQuotationLine(
                id=str(uuid.uuid4()), quotation_id=quotation.id,
                rfq_item_id=rfq_item.id,
                source_request_item_id=rfq_item.source_request_item_id or "",
                position=position, product_name=rfq_item.product_name,
                quantity=line.quantity, unit=line.unit.strip() or rfq_item.unit,
                unit_price=line.unit_price, discount_pct=line.discount_pct,
                tax_pct=line.tax_pct, availability=line.availability,
                remark=line.remark.strip(),
            ))

        if body.status == "received" and not was_received:
            _audit(
                session, entity_type="supplier_quotation", entity_id=quotation.id,
                event_type="supplier_quotation_received", project_id=rfq.project_id or "",
                actor_name=current_user.username,
                message=f"تم استلام عرض سعر {quotation.supplier_name} لطلب التسعير {rfq.rfq_number}",
                metadata={"rfq_id": rfq.id, "actor_role": current_user.role},
            )
        session.commit()
        return _quotation_summary(session, quotation)


@router.post("/{rfq_id}/quotations/{quotation_id}/attachments")
async def upload_quotation_attachments(
    rfq_id: str, quotation_id: str,
    files: List[UploadFile] = File(...),
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    if len(files) > MAX_ATTACHMENTS:
        raise HTTPException(422, f"الحد الأقصى لعدد المرفقات هو {MAX_ATTACHMENTS}")

    with SessionLocal() as session:
        quotation = session.get(SupplierQuotation, quotation_id)
        if not quotation or quotation.rfq_id != rfq_id:
            raise HTTPException(404, "عرض السعر غير موجود")

    prepared = []
    total = 0
    for index, upload in enumerate(files):
        content = await upload.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(413, "حجم كل مرفق يجب ألا يتجاوز 5 ميجابايت")
        total += len(content)
        if total > MAX_TOTAL_FILE_BYTES:
            raise HTTPException(413, "إجمالي حجم المرفقات يجب ألا يتجاوز 25 ميجابايت")
        detected = _detect_extended_file_type(content)
        if not detected:
            raise HTTPException(
                422,
                "المرفقات المسموحة هي PDF أو JPG أو PNG أو WebP أو ملفات Excel فقط",
            )
        media_type, extension = detected
        import hashlib
        safe_name = ntpath.basename(posixpath.basename(upload.filename or f"attachment-{index}"))
        prepared.append({
            "content": content, "media_type": media_type, "extension": extension,
            "original_filename": safe_name[:240],
            "size_bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
        })

    storage = get_attachment_storage()
    written_keys: list[str] = []
    created = []
    try:
        with SessionLocal() as session:
            quotation = session.get(SupplierQuotation, quotation_id)
            if not quotation or quotation.rfq_id != rfq_id:
                raise HTTPException(404, "عرض السعر غير موجود")
            for item in prepared:
                stored_key = f"rfq-quotations/{quotation_id}/{uuid.uuid4().hex}{item['extension']}"
                storage.put(stored_key, item["content"], item["media_type"], item["sha256"])
                written_keys.append(stored_key)
                row = SupplierQuotationAttachment(
                    id=str(uuid.uuid4()), quotation_id=quotation.id,
                    original_filename=item["original_filename"], stored_filename=stored_key,
                    media_type=item["media_type"], size_bytes=item["size_bytes"],
                    sha256=item["sha256"], created_at=_now(),
                )
                session.add(row)
                created.append(row)
            quotation.updated_at = _now()
            session.commit()
    except Exception:
        for key in written_keys:
            try:
                storage.delete(key)
            except Exception:
                pass
        raise

    return {"attachments": [
        {
            "id": row.id, "original_filename": row.original_filename,
            "media_type": row.media_type, "size_bytes": row.size_bytes,
        }
        for row in created
    ]}


@router.get("/{rfq_id}/quotations/{quotation_id}/attachments/{attachment_id}")
async def download_quotation_attachment(
    rfq_id: str, quotation_id: str, attachment_id: str,
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal() as session:
        attachment = session.get(SupplierQuotationAttachment, attachment_id)
        if not attachment or attachment.quotation_id != quotation_id:
            raise HTTPException(404, "المرفق غير موجود")
        quotation = session.get(SupplierQuotation, quotation_id)
        if not quotation or quotation.rfq_id != rfq_id:
            raise HTTPException(404, "المرفق غير موجود")
        try:
            stored = get_attachment_storage().get(attachment.stored_filename)
        except (FileNotFoundError, KeyError):
            raise HTTPException(404, "الملف غير موجود على التخزين")
        return StreamingResponse(
            stored.body, media_type=attachment.media_type,
            headers={
                "Content-Disposition": (
                    "attachment; filename=attachment; filename*=UTF-8''"
                    f"{quote(attachment.original_filename)}"
                ),
            },
        )


@router.get("/{rfq_id}/comparison-rows")
def rfq_comparison_rows(
    rfq_id: str, current_user: User = Depends(require_erp_role()),
):
    """Shape received supplier-quotation lines as Price Comparison rows the
    frontend can drop straight into a new/existing CMP. Read-only: never
    creates a comparison, never selects a supplier."""
    with SessionLocal() as session:
        rfq = session.get(RequestForQuotation, rfq_id)
        if not rfq:
            raise HTTPException(404, "طلب التسعير غير موجود")
        quotations = session.scalars(
            select(SupplierQuotation).where(
                SupplierQuotation.rfq_id == rfq_id, SupplierQuotation.status == "received",
            )
        ).all()
        rows = []
        for quotation in quotations:
            lines = session.scalars(
                select(SupplierQuotationLine)
                .where(SupplierQuotationLine.quotation_id == quotation.id)
                .order_by(SupplierQuotationLine.position)
            ).all()
            for line in lines:
                rfq_item = session.get(RFQItem, line.rfq_item_id) if line.rfq_item_id else None
                rows.append({
                    "quotation_id": quotation.id,
                    "rfq_id": rfq.id,
                    "item_id": (rfq_item.item_id if rfq_item else "") or "",
                    "item_code": "",
                    "product_name": line.product_name,
                    "specifications": rfq_item.specifications if rfq_item else "",
                    "supplier_id": quotation.supplier_id or "",
                    "supplier_name": quotation.supplier_name,
                    "quantity": line.quantity,
                    "unit": line.unit,
                    "unit_price": line.unit_price,
                    "discount_pct": line.discount_pct,
                    "tax_pct": line.tax_pct,
                    "payment_terms": quotation.payment_terms,
                    "availability": line.availability,
                    "price_valid_until": quotation.valid_until,
                    "notes": line.remark,
                })
        return {
            "rfq_id": rfq.id,
            "source_request_id": rfq.source_request_id,
            "source_request_number": rfq.source_request_number,
            "project_id": rfq.project_id or "",
            "project_name": rfq.project_name,
            "rows": rows,
            "supplier_quotations": [
                _quotation_summary(session, quotation) for quotation in quotations
            ],
        }
