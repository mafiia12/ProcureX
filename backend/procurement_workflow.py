"""Guided project, engineer-approval, payment, and audit workflows.

Commercial approval rows are immutable snapshots. Public access is by a random
token only; internal numeric/business identifiers are never used as credentials.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import unicodedata
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, func, select
from sqlalchemy.orm import Mapped, mapped_column

try:
    from .attachment_storage import get_attachment_storage
    from .auth.models import User
    from .auth.service import require_erp_role
    from .business_codes import next_business_code, reserve_code
    from .database import (
        Base, Customer, Payment, Project, Purchase, PurchaseOrder, PurchaseOrderItem,
        PurchaseOrderPayment, PurchaseOrderReceipt, PurchaseOrderReceiptLine, SessionLocal,
    )
    from .incoming_requests import (
        IncomingPurchaseRequest, IncomingPurchaseRequestItem,
        IncomingRequestAttachment, IncomingRequestGeneralAttachment,
        IncomingRequestStatusHistory, require_internal_access,
    )
    from .price_comparisons import (
        PriceComparison, PriceComparisonRow, calculate_comparison,
        _row_document as _comparison_row_document,
    )
    from .rfq import (
        RequestForQuotation, RFQItem, RFQSupplier, SupplierQuotation,
        SupplierQuotationAttachment, SupplierQuotationLine,
    )
except ImportError:
    from attachment_storage import get_attachment_storage
    from auth.models import User
    from auth.service import require_erp_role
    from business_codes import next_business_code, reserve_code
    from database import (
        Base, Customer, Payment, Project, Purchase, PurchaseOrder, PurchaseOrderItem,
        PurchaseOrderPayment, PurchaseOrderReceipt, PurchaseOrderReceiptLine, SessionLocal,
    )
    from incoming_requests import (
        IncomingPurchaseRequest, IncomingPurchaseRequestItem,
        IncomingRequestAttachment, IncomingRequestGeneralAttachment,
        IncomingRequestStatusHistory, require_internal_access,
    )
    from price_comparisons import (
        PriceComparison, PriceComparisonRow, calculate_comparison,
        _row_document as _comparison_row_document,
    )
    from rfq import (
        RequestForQuotation, RFQItem, RFQSupplier, SupplierQuotation,
        SupplierQuotationAttachment, SupplierQuotationLine,
    )


internal_workflow_router = APIRouter(
    prefix="/api/workflow", tags=["procurement-workflow"],
    dependencies=[Depends(require_internal_access)],
)
public_approval_router = APIRouter(prefix="/api/public/approvals", tags=["public-approvals"])

APPROVAL_STATUSES = {
    "draft", "ready_to_send", "sent", "pending_approval", "approved",
    "rejected", "revision_requested", "expired", "cancelled",
}
# Stored values are preserved for historical compatibility. The constant names
# carry the business meaning that the similar database values do not express.
APPROVAL_STAGE_COMPARISON_TECHNICAL = "comparison_technical"
APPROVAL_STAGE_EXPENDITURE_APPROVAL = "fund_release"
APPROVAL_STAGE_FUNDS_AVAILABILITY = "funds_release"
APPROVAL_STAGE_PO_READY = "po_ready"
APPROVAL_STAGE_EXTERNAL_REVIEW = "external_review"
APPROVAL_STAGES = {
    APPROVAL_STAGE_COMPARISON_TECHNICAL,
    APPROVAL_STAGE_EXPENDITURE_APPROVAL,
    APPROVAL_STAGE_FUNDS_AVAILABILITY,
    APPROVAL_STAGE_PO_READY,
    APPROVAL_STAGE_EXTERNAL_REVIEW,
}
PAYMENT_METHODS = {"vodafone_cash", "instapay", "cash"}
PAYMENT_STATUSES = {"pending", "proof_submitted", "under_review", "verified", "rejected", "cancelled"}
MAX_PROOF_BYTES = 5 * 1024 * 1024
PROOF_MEDIA = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


REQUEST_MILESTONE_ORDER = {
    "new": 0,
    "under_review": 1,
    "pricing": 2,
    "waiting_for_approval": 3,
    "approved": 4,
    "converted_to_purchase": 5,
    "completed": 6,
}
REQUEST_TERMINAL_STATUSES = {"rejected", "cancelled", "completed"}


def advance_request_milestone(
    session,
    request_id: str,
    status: str,
    *,
    actor: str = "",
    note: str = "",
) -> bool:
    """Advance a linked request without rewriting historical workflow state."""
    if not request_id or status not in REQUEST_MILESTONE_ORDER:
        return False
    request_row = session.get(IncomingPurchaseRequest, request_id)
    if not request_row or request_row.status in REQUEST_TERMINAL_STATUSES:
        return False
    current_rank = REQUEST_MILESTONE_ORDER.get(request_row.status, -1)
    if current_rank >= REQUEST_MILESTONE_ORDER[status]:
        return False
    timestamp = now_iso()
    previous_status = request_row.status
    request_row.status = status
    request_row.updated_at = timestamp
    session.add(IncomingRequestStatusHistory(
        id=str(uuid.uuid4()),
        request_id=request_row.id,
        from_status=previous_status,
        to_status=status,
        changed_by=actor.strip(),
        note=note,
        created_at=timestamp,
    ))
    return True


def sync_request_completion(session, request_id: str, *, actor: str = "") -> bool:
    """Complete a request only when every non-cancelled formal PO is complete."""
    if not request_id:
        return False
    request_row = session.scalar(
        select(IncomingPurchaseRequest)
        .where(IncomingPurchaseRequest.id == request_id)
        .with_for_update()
    )
    if not request_row:
        return False
    active_statuses = session.scalars(
        select(PurchaseOrder.status).where(
            PurchaseOrder.source_request_id == request_id,
            PurchaseOrder.status != "cancelled",
        )
    ).all()
    if not active_statuses:
        return False
    target = "completed" if all(status == "completed" for status in active_statuses) else "converted_to_purchase"
    return advance_request_milestone(
        session,
        request_id,
        target,
        actor=actor,
        note=(
            "All non-cancelled formal purchase orders completed"
            if target == "completed"
            else "Formal purchase orders remain open"
        ),
    )


class EngineerApproval(Base):
    __tablename__ = "engineer_approvals"
    __table_args__ = (
        UniqueConstraint("approval_number", name="uq_engineer_approval_number"),
        UniqueConstraint("comparison_id", "revision_number", name="uq_approval_comparison_revision"),
        Index("ix_engineer_approvals_project", "project_id"),
        Index("ix_engineer_approvals_status", "status"),
        Index("ix_engineer_approvals_token", "secure_token", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    approval_number: Mapped[str] = mapped_column(String, nullable=False)
    secure_token: Mapped[str] = mapped_column(String, nullable=False)
    project_id: Mapped[str] = mapped_column(String, default="", server_default="")
    project_name: Mapped[str] = mapped_column(String, default="", server_default="")
    customer_id: Mapped[str] = mapped_column(String, default="", server_default="")
    customer_name: Mapped[str] = mapped_column(String, default="", server_default="")
    source_request_id: Mapped[str] = mapped_column(String, default="", server_default="")
    source_request_number: Mapped[str] = mapped_column(String, default="", server_default="")
    comparison_id: Mapped[str] = mapped_column(String, nullable=False)
    comparison_number: Mapped[str] = mapped_column(String, default="", server_default="")
    previous_revision_id: Mapped[str] = mapped_column(String, default="", server_default="")
    revision_number: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String, default="draft", server_default="draft")
    approval_type: Mapped[str] = mapped_column(String, default="external_engineer", server_default="external_engineer")
    approval_stage: Mapped[str] = mapped_column(String, default="external_review", server_default="external_review")
    responsible_role: Mapped[str] = mapped_column(String, default="external_engineer", server_default="external_engineer")
    subtotal: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    discount_total: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    tax_total: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    shipping_total: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    other_total: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    final_total: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    engineer_name: Mapped[str] = mapped_column(String, default="", server_default="")
    engineer_email: Mapped[str] = mapped_column(String, default="", server_default="")
    engineer_phone: Mapped[str] = mapped_column(String, default="", server_default="")
    sent_at: Mapped[str] = mapped_column(String, default="", server_default="")
    first_opened_at: Mapped[str] = mapped_column(String, default="", server_default="")
    last_opened_at: Mapped[str] = mapped_column(String, default="", server_default="")
    approved_at: Mapped[str] = mapped_column(String, default="", server_default="")
    rejected_at: Mapped[str] = mapped_column(String, default="", server_default="")
    revision_requested_at: Mapped[str] = mapped_column(String, default="", server_default="")
    expiry_at: Mapped[str] = mapped_column(String, default="", server_default="")
    decision_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_by: Mapped[str] = mapped_column(String, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class EngineerApprovalLine(Base):
    __tablename__ = "engineer_approval_lines"
    __table_args__ = (
        UniqueConstraint("approval_id", "position", name="uq_approval_line_position"),
        Index("ix_engineer_approval_lines_approval", "approval_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    approval_id: Mapped[str] = mapped_column(String, ForeignKey("engineer_approvals.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    item_id: Mapped[str] = mapped_column(String, default="", server_default="")
    item_code: Mapped[str] = mapped_column(String, default="", server_default="")
    product_name: Mapped[str] = mapped_column(String)
    brand: Mapped[str] = mapped_column(String, default="", server_default="")
    specifications: Mapped[str] = mapped_column(Text, default="", server_default="")
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String, default="", server_default="")
    supplier_id: Mapped[str] = mapped_column(String, default="", server_default="")
    supplier_name: Mapped[str] = mapped_column(String)
    unit_price: Mapped[float] = mapped_column(Float)
    discount_pct: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    tax_pct: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    shipping_cost: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    other_cost: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    line_total: Mapped[float] = mapped_column(Float)
    delivery_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    payment_terms: Mapped[str] = mapped_column(String, default="", server_default="")
    price_valid_until: Mapped[str] = mapped_column(String, default="", server_default="")
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")


class ApprovalPayment(Base):
    __tablename__ = "approval_payments"
    __table_args__ = (
        Index("ix_approval_payments_approval", "approval_id"),
        Index("ix_approval_payments_status", "status"),
        Index("ix_approval_payments_cash_reference", "cash_reference", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    approval_id: Mapped[str] = mapped_column(String, ForeignKey("engineer_approvals.id", ondelete="CASCADE"))
    method: Mapped[str] = mapped_column(String)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String, default="EGP", server_default="EGP")
    status: Mapped[str] = mapped_column(String, default="pending", server_default="pending")
    payment_reference: Mapped[str] = mapped_column(String, default="", server_default="")
    external_reference: Mapped[str] = mapped_column(String, default="", server_default="")
    cash_reference: Mapped[str] = mapped_column(String, default="", server_default="")
    cash_consumed_at: Mapped[str] = mapped_column(String, default="", server_default="")
    proof_storage_key: Mapped[str] = mapped_column(String, default="", server_default="")
    proof_original_name: Mapped[str] = mapped_column(String, default="", server_default="")
    proof_media_type: Mapped[str] = mapped_column(String, default="", server_default="")
    proof_size: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    proof_sha256: Mapped[str] = mapped_column(String, default="", server_default="")
    proof_uploaded_at: Mapped[str] = mapped_column(String, default="", server_default="")
    payer_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    reviewed_by: Mapped[str] = mapped_column(String, default="", server_default="")
    reviewed_at: Mapped[str] = mapped_column(String, default="", server_default="")
    paid_at: Mapped[str] = mapped_column(String, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class WorkflowAuditEvent(Base):
    __tablename__ = "workflow_audit_events"
    __table_args__ = (
        Index("ix_workflow_audit_entity", "entity_type", "entity_id"),
        Index("ix_workflow_audit_project", "project_id"),
        Index("ix_workflow_audit_created", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String)
    entity_id: Mapped[str] = mapped_column(String)
    project_id: Mapped[str] = mapped_column(String, default="", server_default="")
    event_type: Mapped[str] = mapped_column(String)
    actor_type: Mapped[str] = mapped_column(String, default="internal", server_default="internal")
    actor_name: Mapped[str] = mapped_column(String, default="", server_default="")
    message: Mapped[str] = mapped_column(Text, default="", server_default="")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    created_at: Mapped[str] = mapped_column(String, nullable=False)


ACTION_PRIORITY_ORDER = (
    "delivery_problem", "partial_receiving", "comparison_approval",
    "fund_approval", "funds_release", "ready_for_po", "technical_review",
    "ready_for_comparison", "po_review", "under_supply",
)


def _workflow_action_counts(requests, comparisons, approvals, purchase_orders) -> dict:
    comparison_request_ids = {
        row.source_request_id for row in comparisons if row.source_request_id
    }
    ordered_approval_ids = {
        row.approval_id for row in purchase_orders if row.approval_id
    }
    return {
        "technical_review": sum(
            1 for row in requests if row.status in {"new", "under_review"}
        ),
        "ready_for_comparison": sum(
            1 for row in requests
            if row.status == "pricing" and row.id not in comparison_request_ids
        ),
        "comparison_approval": sum(
            1 for row in approvals
            if row.approval_type == "comparison_workflow"
            and row.status == "pending_approval"
            and row.approval_stage == APPROVAL_STAGE_COMPARISON_TECHNICAL
        ),
        "fund_approval": sum(
            1 for row in approvals
            if row.approval_type == "comparison_workflow"
            and row.status == "pending_approval"
            and row.approval_stage == APPROVAL_STAGE_EXPENDITURE_APPROVAL
        ),
        "funds_release": sum(
            1 for row in approvals
            if row.approval_type == "comparison_workflow"
            and row.status == "pending_approval"
            and row.approval_stage == APPROVAL_STAGE_FUNDS_AVAILABILITY
        ),
        "ready_for_po": sum(
            1 for row in approvals
            if row.approval_type == "comparison_workflow"
            and row.status == "approved"
            and row.approval_stage == APPROVAL_STAGE_PO_READY
            and row.id not in ordered_approval_ids
        ),
        "po_review": sum(1 for row in purchase_orders if row.status == "draft"),
        "in_delivery": sum(
            1 for row in purchase_orders
            if row.status in {"in_delivery", "partial_received", "delivery_problem"}
        ),
        "under_supply": sum(
            1 for row in purchase_orders if row.status == "in_delivery"
        ),
        "partial_receiving": sum(
            1 for row in purchase_orders if row.status == "partial_received"
        ),
        "delivery_problem": sum(
            1 for row in purchase_orders if row.status == "delivery_problem"
        ),
    }


def _action_priorities(actions: dict) -> list[dict]:
    return [
        {"key": key, "count": actions[key]}
        for key in ACTION_PRIORITY_ORDER
        if actions.get(key, 0) > 0
    ]


# Sprint 3.6 Dashboard - REQUEST PIPELINE. Every REQ status in
# incoming_requests.REQUEST_STATUSES maps to exactly one bucket below (no
# double counting). "converted_to_purchase" means at least one formal PO
# already exists for the request, so it is bucketed as under-delivery
# rather than a separate "PO/Procurement" stage the REQ status can't
# actually distinguish without joining PurchaseOrder rows.
REQUEST_PIPELINE_STAGES = (
    ("new", "طلبات جديدة", {"new"}),
    ("technical_review", "مراجعة فنية", {"under_review", "need_clarification", "hold"}),
    ("pricing_rfq", "تسعير / طلبات عروض أسعار", {"pricing"}),
    ("waiting_approval", "بانتظار الاعتماد", {"waiting_for_approval"}),
    ("po_procurement", "جاهز لإصدار أمر شراء", {"approved"}),
    ("under_delivery", "تحت التوريد", {"converted_to_purchase"}),
    ("completed", "مكتمل", {"completed"}),
    ("closed", "مرفوض / ملغي", {"rejected", "cancelled"}),
)


def request_pipeline_summary(requests) -> list[dict]:
    """One bucket per REQ (see REQUEST_PIPELINE_STAGES) - counts only, no
    financial totals. Every REQ lands in exactly one bucket: a status that
    doesn't match any known stage (stale/legacy data) falls into "other"
    rather than silently vanishing from the total."""
    status_to_key = {
        status: key for key, _label, statuses in REQUEST_PIPELINE_STAGES for status in statuses
    }
    counts = {key: 0 for key, _label, _statuses in REQUEST_PIPELINE_STAGES}
    unmapped = 0
    for row in requests:
        key = status_to_key.get(row.status)
        if key:
            counts[key] += 1
        else:
            unmapped += 1
    result = [{"key": key, "label": label, "count": counts[key]} for key, label, _statuses in REQUEST_PIPELINE_STAGES]
    if unmapped:
        result.append({"key": "other", "label": "غير مصنف", "count": unmapped})
    return result


def calculate_procurement_kpis(
    *, requests=(), comparisons=(), approvals=(), purchase_orders=(),
    purchases=(), direct_payments=(), approval_payments=(),
) -> dict:
    """Return independent formal, direct, and approval financial ledgers."""
    active_orders = [row for row in purchase_orders if row.status != "cancelled"]
    under_supply_orders = [
        row for row in active_orders
        if row.status in {"in_delivery", "partial_received", "delivery_problem"}
    ]
    completed_orders = [row for row in active_orders if row.status == "completed"]
    paid_by_purchase = {}
    for payment in direct_payments:
        paid_by_purchase[payment.purchase_id] = (
            paid_by_purchase.get(payment.purchase_id, 0.0)
            + float(payment.amount_paid or 0)
        )

    direct_purchase_total = sum(float(row.invoice_total or 0) for row in purchases)
    direct_paid_total = sum(float(row.amount_paid or 0) for row in direct_payments)
    direct_outstanding_total = sum(
        max(
            float(row.invoice_total or 0)
            - paid_by_purchase.get(row.purchase_id, 0.0),
            0.0,
        )
        for row in purchases
    )
    pending_approval_payments = [
        row for row in approval_payments
        if row.status in {"pending", "proof_submitted", "under_review"}
    ]
    verified_approval_payments = [
        row for row in approval_payments if row.status == "verified"
    ]
    actions = _workflow_action_counts(
        requests, comparisons, approvals, purchase_orders,
    )

    result = {
        "request_count": len(requests),
        "comparison_count": len(comparisons),
        "approval_count": len(approvals),
        "purchase_order_count": len(purchase_orders),
        "formal_po_count": len(active_orders),
        "formal_po_total": round(sum(float(row.final_total or 0) for row in active_orders), 2),
        "direct_purchase_count": len(purchases),
        "direct_purchase_total": round(direct_purchase_total, 2),
        "direct_paid_total": round(direct_paid_total, 2),
        "direct_outstanding_total": round(direct_outstanding_total, 2),
        "approval_paid_total": round(sum(float(row.amount or 0) for row in verified_approval_payments), 2),
        "approval_pending_total": round(sum(float(row.amount or 0) for row in pending_approval_payments), 2),
        "approval_pending_count": len(pending_approval_payments),
        "formal_under_supply_count": len(under_supply_orders),
        "formal_under_supply_value": round(sum(float(row.final_total or 0) for row in under_supply_orders), 2),
        "formal_completed_po_count": len(completed_orders),
        "formal_completed_po_value": round(sum(float(row.final_total or 0) for row in completed_orders), 2),
        "formal_partial_received_count": sum(1 for row in active_orders if row.status == "partial_received"),
        "formal_delivery_problem_count": sum(1 for row in active_orders if row.status == "delivery_problem"),
        "actions": actions,
        "action_priorities": _action_priorities(actions),
    }
    # Compatibility aliases. Each financial alias now belongs to one ledger.
    result.update({
        "purchase_order_total": result["formal_po_total"],
        "actual_purchase_total": result["direct_purchase_total"],
        "awaiting_payment": result["approval_pending_count"],
        "paid": result["direct_paid_total"],
    })
    return result


def _row(row, *, exclude: set[str] | None = None) -> dict:
    excluded = exclude or set()
    return {c.name: getattr(row, c.name) for c in row.__table__.columns if c.name not in excluded}


def _audit(session, *, entity_type: str, entity_id: str, event_type: str,
           message: str, project_id: str = "", actor_type: str = "internal",
           actor_name: str = "", metadata: dict | None = None) -> None:
    safe_metadata = {k: v for k, v in (metadata or {}).items() if "token" not in k.lower() and "secret" not in k.lower()}
    session.add(WorkflowAuditEvent(
        id=str(uuid.uuid4()), entity_type=entity_type, entity_id=entity_id,
        project_id=project_id or "", event_type=event_type,
        actor_type=actor_type, actor_name=actor_name or "", message=message,
        metadata_json=safe_metadata, created_at=now_iso(),
    ))


def normalize_match(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").casefold()
    value = re.sub(r"[^\w\u0600-\u06ff]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _project_score(request_row: IncomingPurchaseRequest, project: Project) -> float:
    name = SequenceMatcher(None, normalize_match(request_row.project_name), normalize_match(project.name)).ratio()
    customer_source = request_row.customer_name or request_row.company_name
    customer = SequenceMatcher(None, normalize_match(customer_source), normalize_match(project.customer_name)).ratio()
    location_source = request_row.project_location
    location_target = " ".join([project.governorate, project.city, project.address])
    location = SequenceMatcher(None, normalize_match(location_source), normalize_match(location_target)).ratio()
    return round(name * 0.65 + customer * 0.2 + location * 0.15, 4)


def _suggestions(session, request_row: IncomingPurchaseRequest, limit: int = 8) -> list[dict]:
    choices = []
    for project in session.scalars(select(Project)).all():
        score = _project_score(request_row, project)
        if score >= 0.38:
            choices.append({
                "id": project.id, "code": project.code, "name": project.name,
                "customer_name": project.customer_name, "governorate": project.governorate,
                "city": project.city, "address": project.address, "score": score,
            })
    return sorted(choices, key=lambda item: item["score"], reverse=True)[:limit]


class LinkProjectIn(BaseModel):
    project_id: str = Field(min_length=1)
    actor: str = ""


class CreateProjectIn(BaseModel):
    name: str = Field(min_length=2, max_length=240)
    customer_name: str = ""
    governorate: str = ""
    city: str = ""
    address: str = ""
    engineer: str = ""
    status: str = "نشط"
    notes: str = ""
    actor: str = ""
    confirm_similar: bool = False


def _link_request(session, request_row: IncomingPurchaseRequest, project: Project, actor: str) -> None:
    request_row.project_id = project.id
    request_row.project_name = project.name
    request_row.customer_name = project.customer_name or request_row.customer_name
    request_row.updated_at = now_iso()
    comparisons = session.scalars(
        select(PriceComparison).where(PriceComparison.source_request_id == request_row.id)
    ).all()
    for comparison in comparisons:
        comparison.project_id = project.id
        comparison.project_name = project.name
        comparison.customer_name = project.customer_name or comparison.customer_name
        comparison.updated_at = now_iso()
    _audit(session, entity_type="incoming_request", entity_id=request_row.id,
           event_type="request_linked_to_project", project_id=project.id,
           actor_name=actor, message=f"تم ربط الطلب بالمشروع {project.name}")


@internal_workflow_router.get("/incoming-purchase-requests/{request_id}/project-suggestions")
def project_suggestions(request_id: str):
    with SessionLocal() as session:
        request_row = session.get(IncomingPurchaseRequest, request_id)
        if not request_row:
            raise HTTPException(404, "طلب الشراء غير موجود")
        return {"linked_project_id": request_row.project_id, "suggestions": _suggestions(session, request_row)}


@internal_workflow_router.post("/incoming-purchase-requests/{request_id}/link-project")
def link_existing_project(request_id: str, body: LinkProjectIn):
    with SessionLocal.begin() as session:
        request_row = session.get(IncomingPurchaseRequest, request_id)
        project = session.get(Project, body.project_id)
        if not request_row:
            raise HTTPException(404, "طلب الشراء غير موجود")
        if not project:
            raise HTTPException(404, "المشروع غير موجود")
        if request_row.project_id and request_row.project_id != project.id:
            raise HTTPException(409, "الطلب مربوط بمشروع آخر بالفعل")
        if request_row.project_id == project.id:
            return {"ok": True, "project": _row(project), "already_linked": True}
        _link_request(session, request_row, project, body.actor)
        return {"ok": True, "project": _row(project), "already_linked": False}


@internal_workflow_router.post("/incoming-purchase-requests/{request_id}/create-project")
def create_project_from_request(request_id: str, body: CreateProjectIn):
    with SessionLocal.begin() as session:
        request_row = session.get(IncomingPurchaseRequest, request_id)
        if not request_row:
            raise HTTPException(404, "طلب الشراء غير موجود")
        if request_row.project_id:
            raise HTTPException(409, "الطلب مربوط بمشروع بالفعل")
        exact = session.scalar(select(Project).where(func.lower(Project.name) == body.name.strip().lower()))
        if exact:
            raise HTTPException(409, {"message": "يوجد مشروع بنفس الاسم", "project": _row(exact)})
        probe = IncomingPurchaseRequest(
            id="probe", request_number="probe", requester_name="", phone_number="",
            project_name=body.name, project_location=" ".join([body.governorate, body.city, body.address]),
            delivery_location="", required_delivery_date="", priority="normal",
            submission_token="probe", content_fingerprint="probe", created_at="", updated_at="",
            company_name=body.customer_name, customer_name=body.customer_name,
        )
        similar = _suggestions(session, probe, 3)
        if similar and similar[0]["score"] >= 0.72 and not body.confirm_similar:
            raise HTTPException(409, {"message": "وجدنا مشروعًا مشابهًا", "suggestions": similar})
        project = Project(
            id=str(uuid.uuid4()), code=next_business_code("projects"), name=body.name.strip(),
            customer_name=body.customer_name.strip(), governorate=body.governorate.strip(),
            city=body.city.strip(), address=body.address.strip(), engineer=body.engineer.strip(),
            status=body.status.strip(), notes=body.notes.strip(),
            extra_data={"created_from_purchase_request_id": request_row.id,
                        "created_from_purchase_request_number": request_row.request_number},
        )
        session.add(project)
        session.flush()
        _link_request(session, request_row, project, body.actor)
        _audit(session, entity_type="project", entity_id=project.id,
               event_type="project_created_from_request", project_id=project.id,
               actor_name=body.actor, message="تم إنشاء المشروع من طلب شراء وارد")
        return {"ok": True, "project": _row(project)}


class ApprovalCreateIn(BaseModel):
    comparison_id: str
    engineer_name: str = ""
    engineer_email: str = ""
    engineer_phone: str = ""
    expiry_at: str = ""
    created_by: str = ""
    approval_type: Literal["external_engineer", "comparison_workflow"] = "external_engineer"


def _approval_code() -> str:
    return reserve_code(
        "engineer_approvals", "APR-", 6, ("APR-",),
        EngineerApproval, EngineerApproval.approval_number,
    )


def _calculated_selected_rows(session, comparison: PriceComparison) -> list[dict]:
    rows = session.scalars(
        select(PriceComparisonRow).where(
            PriceComparisonRow.comparison_id == comparison.id,
            PriceComparisonRow.selected_for_purchase == 1,
        ).order_by(PriceComparisonRow.position)
    ).all()
    if not rows:
        raise HTTPException(422, "اختر عرضًا صالحًا لكل صنف واحفظ المقارنة أولاً")
    calculated = calculate_comparison(
        datetime.now(timezone.utc).date().isoformat(),
        [{c.name: getattr(row, c.name) for c in PriceComparisonRow.__table__.columns} for row in rows],
    )["rows"]
    if any(not row["eligible"] for row in calculated):
        raise HTTPException(422, "توجد عروض مختارة غير مكتملة أو منتهية الصلاحية")
    product_keys = [row.get("item_id") or row.get("item_code") or row.get("product_name") for row in calculated]
    if len(product_keys) != len(set(product_keys)):
        raise HTTPException(422, "يجب اختيار عرض واحد فقط لكل صنف")
    return calculated


def _create_approval(session, comparison: PriceComparison, rows: list[dict], body: ApprovalCreateIn,
                     *, revision: int = 0, previous_id: str = "") -> EngineerApproval:
    project = session.get(Project, comparison.project_id) if comparison.project_id else None
    if not project:
        raise HTTPException(409, "يجب ربط المقارنة بمشروع صحيح قبل إنشاء الاعتماد")
    source_request = None
    if body.approval_type == "comparison_workflow":
        if not comparison.source_request_id:
            raise HTTPException(409, "يجب ربط المقارنة بطلب شراء قبل بدء الاعتماد الداخلي")
        source_request = session.get(IncomingPurchaseRequest, comparison.source_request_id)
        if not source_request:
            raise HTTPException(409, "طلب الشراء المصدر للمقارنة غير موجود")
        if source_request.project_id != project.id:
            raise HTTPException(409, "مشروع الاعتماد لا يطابق مشروع طلب الشراء المصدر")
    timestamp = now_iso()
    subtotal = sum(float(row.get("subtotal") or 0) for row in rows)
    discount = sum(float(row.get("discount_amount") or row.get("discount_value") or 0) for row in rows)
    tax = sum(float(row.get("tax_amount") or row.get("tax_value") or 0) for row in rows)
    shipping = sum(float(row.get("shipping_cost") or 0) for row in rows)
    other = sum(float(row.get("other_cost") or 0) for row in rows)
    total = sum(float(row.get("final_total") or 0) for row in rows)
    approval = EngineerApproval(
        id=str(uuid.uuid4()), approval_number=_approval_code(), secure_token=secrets.token_urlsafe(32),
        project_id=project.id, project_name=project.name,
        customer_id=(source_request.customer_id if source_request else "") or comparison.customer_id or "",
        customer_name=comparison.customer_name,
        source_request_id=source_request.id if source_request else comparison.source_request_id,
        source_request_number=(
            source_request.request_number if source_request else comparison.source_request_number
        ),
        comparison_id=comparison.id, comparison_number=comparison.comparison_number,
        previous_revision_id=previous_id, revision_number=revision,
        status="pending_approval" if body.approval_type == "comparison_workflow" else "draft",
        approval_type=body.approval_type,
        approval_stage=(
            APPROVAL_STAGE_COMPARISON_TECHNICAL
            if body.approval_type == "comparison_workflow"
            else APPROVAL_STAGE_EXTERNAL_REVIEW
        ),
        responsible_role="procurement_engineer" if body.approval_type == "comparison_workflow" else "external_engineer",
        subtotal=round(subtotal, 2), discount_total=round(discount, 2), tax_total=round(tax, 2),
        shipping_total=round(shipping, 2), other_total=round(other, 2), final_total=round(total, 2),
        engineer_name=body.engineer_name.strip(), engineer_email=body.engineer_email.strip(),
        engineer_phone=body.engineer_phone.strip(), expiry_at=body.expiry_at,
        created_by=body.created_by.strip(), created_at=timestamp, updated_at=timestamp,
    )
    session.add(approval)
    session.flush()
    for position, row in enumerate(rows, 1):
        session.add(EngineerApprovalLine(
            id=str(uuid.uuid4()), approval_id=approval.id, position=position,
            item_id=row.get("item_id") or "", item_code=row.get("item_code") or "",
            product_name=row.get("product_name") or "", brand=row.get("brand") or "",
            specifications=row.get("specifications") or "", quantity=float(row.get("quantity") or 0),
            unit=row.get("unit") or "", supplier_id=row.get("supplier_id") or "",
            supplier_name=row.get("supplier_name") or "", unit_price=float(row.get("unit_price") or 0),
            discount_pct=float(row.get("discount_pct") or 0), tax_pct=float(row.get("tax_pct") or 0),
            shipping_cost=float(row.get("shipping_cost") or 0), other_cost=float(row.get("other_cost") or 0),
            line_total=float(row.get("final_total") or 0), delivery_days=int(row.get("delivery_days") or 0),
            payment_terms=row.get("payment_terms") or "", price_valid_until=row.get("price_valid_until") or "",
            notes=row.get("notes") or "",
        ))
    _audit(session, entity_type="approval", entity_id=approval.id,
           event_type="approval_created", project_id=approval.project_id,
           actor_name=body.created_by, message=f"تم إنشاء {approval.approval_number} - الإصدار {revision + 1}")
    advance_request_milestone(
        session,
        approval.source_request_id,
        "waiting_for_approval",
        actor=body.created_by,
        note=f"Approval process started with {approval.approval_number}",
    )
    return approval


@internal_workflow_router.post("/approvals/from-comparison", status_code=201)
def create_approval_from_comparison(
    body: ApprovalCreateIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    body.created_by = current_user.username
    with SessionLocal.begin() as session:
        comparison = session.get(PriceComparison, body.comparison_id)
        if not comparison:
            raise HTTPException(404, "المقارنة غير موجودة")
        duplicate = session.scalar(select(EngineerApproval).where(
            EngineerApproval.comparison_id == comparison.id,
            EngineerApproval.revision_number == 0,
        ))
        if duplicate:
            raise HTTPException(409, {"message": "تم إنشاء اعتماد لهذه المقارنة من قبل", "approval_id": duplicate.id})
        approval = _create_approval(session, comparison, _calculated_selected_rows(session, comparison), body)
        return {"ok": True, "approval": _approval_detail(session, approval, include_token=True)}


def _payments(session, approval_id: str) -> list[dict]:
    return [_row(item, exclude={"proof_storage_key", "proof_sha256"}) for item in session.scalars(
        select(ApprovalPayment).where(ApprovalPayment.approval_id == approval_id).order_by(ApprovalPayment.created_at.desc())
    ).all()]


def _timeline(session, entity_id: str) -> list[dict]:
    return [_row(item) for item in session.scalars(
        select(WorkflowAuditEvent).where(
            WorkflowAuditEvent.entity_type == "approval", WorkflowAuditEvent.entity_id == entity_id
        ).order_by(WorkflowAuditEvent.created_at.desc())
    ).all()]


def _approval_detail(session, approval: EngineerApproval, *, include_token: bool = False) -> dict:
    excluded = set() if include_token else {"secure_token"}
    data = _row(approval, exclude=excluded)
    data["lines"] = [_row(line) for line in session.scalars(
        select(EngineerApprovalLine).where(EngineerApprovalLine.approval_id == approval.id).order_by(EngineerApprovalLine.position)
    ).all()]
    data["payments"] = _payments(session, approval.id)
    data["timeline"] = _timeline(session, approval.id)
    return data


@internal_workflow_router.get("/approvals")
def list_approvals(status: str = "", payment_status: str = "", project_id: str = "", search: str = ""):
    with SessionLocal() as session:
        statement = select(EngineerApproval).order_by(EngineerApproval.updated_at.desc())
        if status:
            statement = statement.where(EngineerApproval.status == status)
        if project_id:
            statement = statement.where(EngineerApproval.project_id == project_id)
        if search.strip():
            needle = f"%{search.strip()}%"
            statement = statement.where(
                EngineerApproval.approval_number.ilike(needle) |
                EngineerApproval.project_name.ilike(needle) |
                EngineerApproval.engineer_name.ilike(needle)
            )
        rows = session.scalars(statement).all()
        result = []
        for approval in rows:
            data = _row(approval, exclude={"secure_token"})
            payments = _payments(session, approval.id)
            data["payment_status"] = payments[0]["status"] if payments else "not_started"
            data["payment_id"] = payments[0]["id"] if payments else ""
            if not payment_status or data["payment_status"] == payment_status:
                result.append(data)
        counts = {state: sum(1 for row in result if row["status"] == state) for state in APPROVAL_STATUSES}
        payment_counts = {state: sum(1 for row in result if row["payment_status"] == state) for state in PAYMENT_STATUSES | {"not_started"}}
        return {"items": result, "counts": counts, "payment_counts": payment_counts}


@internal_workflow_router.get("/action-summary")
def workflow_action_summary():
    """Small, persisted work queue for the roles in the procurement flow."""
    with SessionLocal() as session:
        requests = session.scalars(select(IncomingPurchaseRequest)).all()
        comparisons = session.scalars(select(PriceComparison)).all()
        approvals = session.scalars(select(EngineerApproval)).all()
        orders = session.scalars(select(PurchaseOrder)).all()
        actions = _workflow_action_counts(requests, comparisons, approvals, orders)
        return {**actions, "priorities": _action_priorities(actions)}


@internal_workflow_router.get("/approvals/{approval_id}")
def get_approval(approval_id: str):
    with SessionLocal() as session:
        approval = session.get(EngineerApproval, approval_id)
        if not approval:
            raise HTTPException(404, "الاعتماد غير موجود")
        return _approval_detail(session, approval, include_token=True)


def _review_workspace_request(session, approval: EngineerApproval) -> dict:
    """REQ + items + attachments + technical-review, or None for a historical
    approval whose source REQ record is unavailable."""
    request_row = (
        session.get(IncomingPurchaseRequest, approval.source_request_id)
        if approval.source_request_id else None
    )
    if not request_row:
        return {"request": None, "request_items": [], "request_attachments": [], "technical_review": None}

    items = session.scalars(
        select(IncomingPurchaseRequestItem)
        .where(IncomingPurchaseRequestItem.request_id == request_row.id)
        .order_by(IncomingPurchaseRequestItem.position)
    ).all()
    item_attachments = {
        row.request_item_id: row for row in session.scalars(
            select(IncomingRequestAttachment).where(
                IncomingRequestAttachment.request_item_id.in_([item.id for item in items])
            )
        ).all()
    } if items else {}
    general_attachments = session.scalars(
        select(IncomingRequestGeneralAttachment).where(
            IncomingRequestGeneralAttachment.request_id == request_row.id
        )
    ).all()

    def _attachment_document(row) -> dict:
        return {
            "id": row.id, "original_filename": row.original_filename,
            "media_type": row.media_type, "size_bytes": row.size_bytes,
        }

    request = {
        "id": request_row.id, "request_number": request_row.request_number,
        "requester_name": request_row.requester_name,
        "requester_type": "site_portal" if request_row.requester_user_id else "public",
        "company_name": request_row.company_name, "phone_number": request_row.phone_number,
        "email": request_row.email, "whatsapp_number": request_row.whatsapp_number,
        "project_id": request_row.project_id, "project_name": request_row.project_name,
        "project_location": request_row.project_location,
        "delivery_location": request_row.delivery_location,
        "delivery_destination": request_row.delivery_destination,
        "required_delivery_date": request_row.required_delivery_date,
        "priority": request_row.priority, "notes": request_row.notes,
        "status": request_row.status, "created_at": request_row.created_at,
    }
    request_items = [
        {
            "id": item.id, "position": item.position,
            "item_id": item.item_id or "", "is_manual": not bool(item.item_id),
            "product_name": item.product_name, "specifications": item.specifications,
            "quantity": item.quantity, "unit": item.unit,
            "review_status": item.review_status, "review_reason": item.review_reason,
            "reviewed_by": item.reviewed_by, "reviewed_at": item.reviewed_at,
            "attachment": (
                _attachment_document(item_attachments[item.id])
                if item.id in item_attachments else None
            ),
        }
        for item in items
    ]
    request_attachments = [
        {**_attachment_document(row), "source": "general"} for row in general_attachments
    ] + [
        {**_attachment_document(row), "source": "item", "request_item_id": item_id}
        for item_id, row in item_attachments.items()
    ]
    reviewed_ats = [item.reviewed_at for item in items if item.reviewed_at]
    technical_review = {
        "reviewed": any(item.reviewed_by for item in items),
        "reviewed_by": next((item.reviewed_by for item in items if item.reviewed_by), ""),
        "reviewed_at": max(reviewed_ats) if reviewed_ats else "",
        "items": [
            {
                "id": item.id, "product_name": item.product_name,
                "review_status": item.review_status, "review_reason": item.review_reason,
                "reviewed_by": item.reviewed_by, "reviewed_at": item.reviewed_at,
                "hold_since": item.hold_since,
            }
            for item in items
        ],
    }
    return {
        "request": request, "request_items": request_items,
        "request_attachments": request_attachments, "technical_review": technical_review,
    }


def _review_workspace_rfq(session, request_id: str) -> dict:
    """RFQ + suppliers + supplier quotations for a REQ, or a neutral 'no RFQ
    yet' shape - a missing RFQ is expected for historical records, not an
    error."""
    rfq = session.scalar(
        select(RequestForQuotation).where(RequestForQuotation.source_request_id == request_id)
    ) if request_id else None
    if not rfq:
        return {"rfq": None, "supplier_quotations": []}

    rfq_suppliers = session.scalars(
        select(RFQSupplier).where(RFQSupplier.rfq_id == rfq.id)
    ).all()
    quotations = session.scalars(
        select(SupplierQuotation).where(SupplierQuotation.rfq_id == rfq.id)
    ).all()
    rfq_data = {
        "id": rfq.id, "rfq_number": rfq.rfq_number, "rfq_date": rfq.rfq_date,
        "deadline": rfq.deadline, "notes": rfq.notes,
        "supplier_count": len(rfq_suppliers),
        "suppliers": [
            {"supplier_id": row.supplier_id or "", "supplier_name": row.supplier_name}
            for row in rfq_suppliers
        ],
        "received_quotation_count": sum(1 for row in quotations if row.status == "received"),
    }
    supplier_quotations = []
    for quotation in quotations:
        lines = session.scalars(
            select(SupplierQuotationLine)
            .where(SupplierQuotationLine.quotation_id == quotation.id)
            .order_by(SupplierQuotationLine.position)
        ).all()
        attachments = session.scalars(
            select(SupplierQuotationAttachment).where(
                SupplierQuotationAttachment.quotation_id == quotation.id
            )
        ).all()
        supplier_quotations.append({
            "id": quotation.id, "supplier_id": quotation.supplier_id or "",
            "supplier_name": quotation.supplier_name, "quotation_ref": quotation.quotation_ref,
            "status": quotation.status, "quotation_date": quotation.quotation_date,
            "valid_until": quotation.valid_until, "payment_terms": quotation.payment_terms,
            "delivery_terms": quotation.delivery_terms, "currency": quotation.currency,
            "notes": quotation.notes,
            "lines": [
                {
                    "rfq_item_id": line.rfq_item_id or "", "product_name": line.product_name,
                    "quantity": line.quantity, "unit": line.unit, "unit_price": line.unit_price,
                    "discount_pct": line.discount_pct, "tax_pct": line.tax_pct,
                    "availability": line.availability, "remark": line.remark,
                }
                for line in lines
            ],
            "attachments": [
                {
                    "id": row.id, "original_filename": row.original_filename,
                    "media_type": row.media_type, "size_bytes": row.size_bytes,
                }
                for row in attachments
            ],
        })
    return {"rfq": rfq_data, "supplier_quotations": supplier_quotations}


def _review_workspace_comparison(session, approval: EngineerApproval) -> dict | None:
    """The same PriceComparison rows/summaries CMP itself shows - reuses
    calculate_comparison(), never recomputed with new logic."""
    if not approval.comparison_id:
        return None
    comparison = session.get(PriceComparison, approval.comparison_id)
    if not comparison:
        return None
    rows = session.scalars(
        select(PriceComparisonRow)
        .where(PriceComparisonRow.comparison_id == comparison.id)
        .order_by(PriceComparisonRow.position)
    ).all()
    calculations = calculate_comparison(
        comparison.comparison_date, [_comparison_row_document(row) for row in rows],
    )
    return {
        "id": comparison.id, "comparison_number": comparison.comparison_number,
        "comparison_date": comparison.comparison_date, "notes": comparison.notes,
        "rows": calculations["rows"],
        "product_summaries": calculations["product_summaries"],
        "scenario_summary": calculations["scenario_summary"],
    }


def _review_workspace_detail(session, approval: EngineerApproval) -> dict:
    request_section = _review_workspace_request(session, approval)
    rfq_section = _review_workspace_rfq(session, approval.source_request_id)
    return {
        "approval": _approval_detail(session, approval, include_token=False),
        **request_section,
        **rfq_section,
        "comparison": _review_workspace_comparison(session, approval),
    }


@internal_workflow_router.get("/approvals/{approval_id}/review-workspace")
def approval_review_workspace(
    approval_id: str, current_user: User = Depends(require_erp_role()),
):
    """Read-only aggregation of REQ -> technical review -> RFQ -> supplier
    quotations -> CMP for one approval, so a reviewer can see the full
    procurement file without navigating across screens. Aggregates existing
    records only; creates nothing, changes nothing."""
    with SessionLocal() as session:
        approval = session.get(EngineerApproval, approval_id)
        if not approval:
            raise HTTPException(404, "الاعتماد غير موجود")
        return _review_workspace_detail(session, approval)


class ActorIn(BaseModel):
    actor: str = ""


class InternalApprovalDecisionIn(BaseModel):
    decision: Literal["approved", "rejected", "revision_requested"]
    actor: str = ""
    note: str = Field(default="", max_length=2000)


@internal_workflow_router.post("/approvals/{approval_id}/decision")
def internal_approval_decision(
    approval_id: str, body: InternalApprovalDecisionIn,
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal.begin() as session:
        approval = session.get(EngineerApproval, approval_id)
        if not approval:
            raise HTTPException(404, "الاعتماد غير موجود")
        if approval.approval_type != "comparison_workflow":
            raise HTTPException(409, "هذا الاعتماد يستخدم مسار المراجعة الخارجية القديم")
        # The role required at this specific stage is a workflow-state value
        # (approval.responsible_role), not a fixed role - only the identity
        # source changed: the authenticated user's own DB role, never a
        # client-supplied one. Admin always passes (require_erp_role above).
        if current_user.role != "admin" and current_user.role != approval.responsible_role:
            raise HTTPException(403, "هذا الإجراء متاح للدور المسؤول في المرحلة الحالية فقط")
        if approval.status != "pending_approval":
            if approval.status == body.decision:
                return {"ok": True, "already_recorded": True, "approval": _approval_detail(session, approval, include_token=False)}
            raise HTTPException(409, "لا يمكن اتخاذ قرار من الحالة الحالية")
        timestamp = now_iso()
        approval.decision_note = body.note.strip()
        approval.updated_at = timestamp
        if body.decision == "approved" and approval.approval_stage == APPROVAL_STAGE_COMPARISON_TECHNICAL:
            approval.approval_stage = APPROVAL_STAGE_EXPENDITURE_APPROVAL
            approval.responsible_role = "commercial_manager"
            _audit(session, entity_type="approval", entity_id=approval.id,
                   event_type="comparison_technically_approved", project_id=approval.project_id,
                   actor_name=current_user.username, message="اعتمد مهندس المشتريات مقارنة الأسعار")
            return {"ok": True, "already_recorded": False, "approval": _approval_detail(session, approval, include_token=False)}
        if body.decision == "approved" and approval.approval_stage == APPROVAL_STAGE_EXPENDITURE_APPROVAL:
            approval.approval_stage = APPROVAL_STAGE_FUNDS_AVAILABILITY
            approval.responsible_role = "commercial_manager"
            _audit(session, entity_type="approval", entity_id=approval.id,
                   event_type="expenditure_approved", project_id=approval.project_id,
                   actor_name=current_user.username, message="اعتمد المدير التجاري الصرف؛ بانتظار إتاحة المبلغ",
                   metadata={"amount": approval.final_total, "actor_role": current_user.role})
            return {"ok": True, "already_recorded": False, "approval": _approval_detail(session, approval, include_token=False)}
        if body.decision == "approved" and approval.approval_stage == APPROVAL_STAGE_FUNDS_AVAILABILITY:
            raise HTTPException(409, "استخدم إجراء إتاحة المبلغ بعد اعتماد الصرف")
        approval.status = body.decision
        if body.decision == "approved":
            approval.approved_at = timestamp
            event_type, message = "fund_release_approved", "اعتمد المدير التجاري الصرف"
        elif body.decision == "rejected":
            approval.rejected_at = timestamp
            event_type, message = "approval_rejected", "تم رفض الاعتماد"
        else:
            approval.revision_requested_at = timestamp
            event_type, message = "approval_revision_requested", "تم طلب تعديل المقارنة"
        _audit(session, entity_type="approval", entity_id=approval.id, event_type=event_type,
               project_id=approval.project_id, actor_name=current_user.username, message=message,
               metadata={"approval_stage": approval.approval_stage, "actor_role": current_user.role})
        return {"ok": True, "already_recorded": False, "approval": _approval_detail(session, approval, include_token=False)}


class FundsReleaseIn(BaseModel):
    actor: str = ""
    note: str = Field(default="", max_length=2000)
    method: Literal["", "cash", "transfer", "custody", "other"] = ""


@internal_workflow_router.post("/approvals/{approval_id}/funds-release")
def confirm_funds_release(
    approval_id: str, body: FundsReleaseIn,
    current_user: User = Depends(require_erp_role("commercial_manager")),
):
    with SessionLocal.begin() as session:
        approval = session.get(EngineerApproval, approval_id)
        if not approval:
            raise HTTPException(404, "الاعتماد غير موجود")
        if approval.approval_type != "comparison_workflow":
            raise HTTPException(409, "إتاحة المبلغ متاحة لمسار المشتريات الداخلي فقط")
        if approval.status == "approved" and approval.approval_stage == APPROVAL_STAGE_PO_READY:
            return {"ok": True, "already_recorded": True, "approval": _approval_detail(session, approval, include_token=False)}
        if (
            approval.status != "pending_approval"
            or approval.approval_stage != APPROVAL_STAGE_FUNDS_AVAILABILITY
        ):
            raise HTTPException(409, "يجب اعتماد الصرف أولاً قبل إتاحة المبلغ")
        if approval.responsible_role != "commercial_manager":
            raise HTTPException(403, "هذا الإجراء متاح للدور المسؤول فقط")
        timestamp = now_iso()
        approval.status = "approved"
        approval.approval_stage = APPROVAL_STAGE_PO_READY
        approval.responsible_role = "procurement_officer"
        approval.approved_at = timestamp
        approval.updated_at = timestamp
        _audit(session, entity_type="approval", entity_id=approval.id,
               event_type="funds_released", project_id=approval.project_id,
               actor_name=current_user.username, message="أكد المدير التجاري إتاحة المبلغ لمسؤول المشتريات",
               metadata={
                   "amount": approval.final_total, "release_method": body.method,
                   "note": body.note.strip(), "actor_role": current_user.role,
               })
        advance_request_milestone(
            session,
            approval.source_request_id,
            "approved",
            actor=current_user.username,
            note=f"Approvals and funds completed for {approval.approval_number}",
        )
        return {"ok": True, "already_recorded": False, "approval": _approval_detail(session, approval, include_token=False)}


class TechnicalDecisionIn(BaseModel):
    decision: Literal["approved_for_pricing", "revision_required", "rejected", "hold"]
    actor: str = ""
    note: str = Field(default="", max_length=2000)


@internal_workflow_router.post("/incoming-purchase-requests/{request_id}/technical-decision")
def request_technical_decision(
    request_id: str, body: TechnicalDecisionIn,
    current_user: User = Depends(require_erp_role("procurement_engineer")),
):
    if body.decision == "revision_required" and not body.note.strip():
        raise HTTPException(422, "سبب طلب التوضيح مطلوب")
    mapping = {
        "approved_for_pricing": ("pricing", "request_technically_approved", "تم اعتماد الطلب فنيًا وأصبح جاهزًا للمقارنة"),
        "revision_required": ("need_clarification", "request_revision_required", "طلب مهندس المشتريات تعديل الطلب"),
        "rejected": ("rejected", "request_technically_rejected", "رفض مهندس المشتريات الطلب فنيًا"),
        "hold": ("hold", "request_technically_held", "علّق مهندس المشتريات الطلب"),
    }
    new_status, event_type, message = mapping[body.decision]
    with SessionLocal.begin() as session:
        request_row = session.get(IncomingPurchaseRequest, request_id)
        if not request_row:
            raise HTTPException(404, "طلب الشراء غير موجود")
        if request_row.status in {"completed", "cancelled"}:
            raise HTTPException(409, "لا يمكن مراجعة طلب مكتمل أو ملغي")
        if request_row.status == new_status:
            return {"ok": True, "already_recorded": True, "status": request_row.status}
        if body.decision == "approved_for_pricing":
            project = session.get(Project, request_row.project_id) if request_row.project_id else None
            if not project:
                raise HTTPException(409, "يجب ربط طلب الشراء بمشروع صحيح قبل اعتماده للتسعير")
            items = session.scalars(select(IncomingPurchaseRequestItem).where(
                IncomingPurchaseRequestItem.request_id == request_row.id
            )).all()
            incomplete = [item for item in items if item.review_status != "approved"]
            if incomplete:
                raise HTTPException(409, "اعتمد جميع أصناف الطلب فنيًا قبل اعتماده للتسعير")
        previous = request_row.status
        timestamp = now_iso()
        request_row.status = new_status
        request_row.updated_at = timestamp
        session.add(IncomingRequestStatusHistory(
            id=str(uuid.uuid4()), request_id=request_row.id, from_status=previous,
            to_status=new_status, changed_by=current_user.username, note=body.note.strip(),
            created_at=timestamp,
        ))
        _audit(session, entity_type="incoming_request", entity_id=request_row.id,
               event_type=event_type, project_id=request_row.project_id,
               actor_name=current_user.username, message=message,
               metadata={"actor_role": current_user.role})
        return {"ok": True, "already_recorded": False, "status": new_status}


@internal_workflow_router.post("/approvals/{approval_id}/ready")
def mark_approval_ready(
    approval_id: str, body: ActorIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    with SessionLocal.begin() as session:
        approval = session.get(EngineerApproval, approval_id)
        if not approval:
            raise HTTPException(404, "الاعتماد غير موجود")
        if approval.status == "ready_to_send":
            return _approval_detail(session, approval, include_token=True)
        if approval.status != "draft":
            raise HTTPException(409, "لا يمكن تجهيز الاعتماد من حالته الحالية")
        if not approval.engineer_name and not approval.engineer_email and not approval.engineer_phone:
            raise HTTPException(422, "أدخل اسم المهندس أو وسيلة تواصل واحدة على الأقل")
        approval.status = "ready_to_send"
        approval.updated_at = now_iso()
        _audit(session, entity_type="approval", entity_id=approval.id, event_type="approval_ready",
               project_id=approval.project_id, actor_name=current_user.username, message="أصبح الاعتماد جاهزًا للإرسال")
        return _approval_detail(session, approval, include_token=True)


@internal_workflow_router.post("/approvals/{approval_id}/sent")
def mark_approval_sent(
    approval_id: str, body: ActorIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    with SessionLocal.begin() as session:
        approval = session.get(EngineerApproval, approval_id)
        if not approval:
            raise HTTPException(404, "الاعتماد غير موجود")
        if approval.status == "sent":
            return _approval_detail(session, approval, include_token=True)
        if approval.status != "ready_to_send":
            raise HTTPException(409, "جهّز الاعتماد أولاً قبل تسجيل الإرسال")
        approval.status = "sent"
        approval.sent_at = now_iso()
        approval.updated_at = approval.sent_at
        _audit(session, entity_type="approval", entity_id=approval.id, event_type="approval_marked_sent",
               project_id=approval.project_id, actor_name=current_user.username,
               message="سجّل المستخدم أنه فتح وسيلة المشاركة؛ لا يمثل ذلك تأكيد تسليم")
        return _approval_detail(session, approval, include_token=True)


class ShareEventIn(BaseModel):
    channel: Literal["whatsapp", "gmail", "copy"]
    actor: str = ""


@internal_workflow_router.post("/approvals/{approval_id}/share-event")
def record_share_event(
    approval_id: str, body: ShareEventIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    with SessionLocal.begin() as session:
        approval = session.get(EngineerApproval, approval_id)
        if not approval:
            raise HTTPException(404, "الاعتماد غير موجود")
        if approval.status not in {"ready_to_send", "sent", "pending_approval"}:
            raise HTTPException(409, "الاعتماد ليس جاهزًا للمشاركة")
        _audit(session, entity_type="approval", entity_id=approval.id,
               event_type=f"share_{body.channel}_opened", project_id=approval.project_id,
               actor_name=current_user.username, message=f"تم فتح مشاركة {body.channel}؛ لم يتم تأكيد التسليم")
        return {"ok": True, "delivery_confirmed": False}


@internal_workflow_router.post("/approvals/{approval_id}/revision", status_code=201)
def create_approval_revision(
    approval_id: str, body: ActorIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    with SessionLocal.begin() as session:
        previous = session.get(EngineerApproval, approval_id)
        if not previous:
            raise HTTPException(404, "الاعتماد غير موجود")
        if previous.status != "revision_requested":
            raise HTTPException(409, "يمكن إنشاء إصدار جديد بعد طلب تعديل فقط")
        next_revision = previous.revision_number + 1
        duplicate = session.scalar(select(EngineerApproval).where(
            EngineerApproval.comparison_id == previous.comparison_id,
            EngineerApproval.revision_number == next_revision,
        ))
        if duplicate:
            raise HTTPException(409, {"message": "تم إنشاء الإصدار التالي من قبل", "approval_id": duplicate.id})
        comparison = session.get(PriceComparison, previous.comparison_id)
        lines = session.scalars(select(EngineerApprovalLine).where(
            EngineerApprovalLine.approval_id == previous.id
        ).order_by(EngineerApprovalLine.position)).all()
        snapshot_rows = [{
            "item_id": x.item_id, "item_code": x.item_code, "product_name": x.product_name,
            "brand": x.brand, "specifications": x.specifications, "quantity": x.quantity,
            "unit": x.unit, "supplier_id": x.supplier_id, "supplier_name": x.supplier_name,
            "unit_price": x.unit_price, "discount_pct": x.discount_pct, "tax_pct": x.tax_pct,
            "shipping_cost": x.shipping_cost, "other_cost": x.other_cost,
            "final_total": x.line_total, "delivery_days": x.delivery_days,
            "payment_terms": x.payment_terms, "price_valid_until": x.price_valid_until,
            "notes": x.notes,
            "subtotal": x.quantity * x.unit_price,
            "discount_value": x.quantity * x.unit_price * x.discount_pct / 100,
            "tax_value": (x.quantity * x.unit_price * (1 - x.discount_pct / 100)) * x.tax_pct / 100,
        } for x in lines]
        if not comparison:
            raise HTTPException(409, "تعذر العثور على المقارنة المصدر")
        if previous.approval_type == "comparison_workflow":
            snapshot_rows = _calculated_selected_rows(session, comparison)
        create_body = ApprovalCreateIn(
            comparison_id=comparison.id, engineer_name=previous.engineer_name,
            engineer_email=previous.engineer_email, engineer_phone=previous.engineer_phone,
            expiry_at=previous.expiry_at, created_by=current_user.username,
            approval_type=previous.approval_type,
        )
        new_approval = _create_approval(session, comparison, snapshot_rows, create_body,
                                        revision=next_revision, previous_id=previous.id)
        return {"ok": True, "approval": _approval_detail(session, new_approval, include_token=True)}


def _public_approval(session, token: str) -> EngineerApproval:
    if len(token) < 30:
        raise HTTPException(404, "رابط الاعتماد غير صحيح")
    approval = session.scalar(select(EngineerApproval).where(EngineerApproval.secure_token == token))
    if not approval:
        raise HTTPException(404, "رابط الاعتماد غير صحيح")
    if approval.approval_type == "comparison_workflow":
        raise HTTPException(404, "هذا الاعتماد متاح داخل ProcureX فقط")
    return approval


def _friendly_public(session, approval: EngineerApproval) -> dict:
    detail = _approval_detail(session, approval, include_token=False)
    detail.pop("id", None)
    detail.pop("comparison_id", None)
    detail.pop("source_request_id", None)
    detail.pop("previous_revision_id", None)
    for line in detail["lines"]:
        line.pop("approval_id", None)
        line.pop("id", None)
    detail.pop("timeline", None)
    detail["company_name"] = os.getenv("PUBLIC_COMPANY_NAME", "RE DECOR & MORE")
    detail["payment_accounts"] = {
        "vodafone_cash": os.getenv("VODAFONE_CASH_RECEIVING_ACCOUNT", "غير مُعد بعد"),
        "instapay": os.getenv("INSTAPAY_RECEIVING_ACCOUNT", "غير مُعد بعد"),
    }
    return detail


@public_approval_router.get("/{token}")
def public_approval(token: str):
    with SessionLocal.begin() as session:
        approval = _public_approval(session, token)
        timestamp = now_iso()
        if not approval.first_opened_at:
            approval.first_opened_at = timestamp
            _audit(session, entity_type="approval", entity_id=approval.id,
                   event_type="approval_first_opened", project_id=approval.project_id,
                   actor_type="public", message="تم فتح رابط الاعتماد لأول مرة")
        approval.last_opened_at = timestamp
        if approval.status == "sent":
            approval.status = "pending_approval"
        approval.updated_at = timestamp
        return _friendly_public(session, approval)


class PublicDecisionIn(BaseModel):
    decision: Literal["approved", "rejected", "revision_requested"]
    note: str = Field(default="", max_length=2000)


@public_approval_router.post("/{token}/decision")
def public_decision(token: str, body: PublicDecisionIn):
    with SessionLocal.begin() as session:
        approval = _public_approval(session, token)
        if approval.status == body.decision:
            return {"ok": True, "already_recorded": True, "status": approval.status}
        if approval.status in {"approved", "rejected", "revision_requested"}:
            raise HTTPException(409, "تم تسجيل قرار مختلف لهذا الاعتماد بالفعل")
        if approval.status not in {"sent", "pending_approval"}:
            raise HTTPException(409, "هذا الاعتماد غير متاح لاتخاذ قرار")
        timestamp = now_iso()
        approval.status = body.decision
        approval.decision_note = body.note.strip()
        approval.updated_at = timestamp
        if body.decision == "approved":
            approval.approved_at = timestamp
        elif body.decision == "rejected":
            approval.rejected_at = timestamp
        else:
            approval.revision_requested_at = timestamp
        event = {"approved": "engineer_approved", "rejected": "engineer_rejected",
                 "revision_requested": "engineer_revision_requested"}[body.decision]
        _audit(session, entity_type="approval", entity_id=approval.id, event_type=event,
               project_id=approval.project_id, actor_type="public", actor_name=approval.engineer_name,
               message={"approved": "اعتمد المهندس العرض", "rejected": "رفض المهندس العرض",
                        "revision_requested": "طلب المهندس تعديل العرض"}[body.decision])
        return {"ok": True, "already_recorded": False, "status": approval.status}


class PaymentIntentIn(BaseModel):
    method: Literal["vodafone_cash", "instapay", "cash"]
    external_reference: str = Field(default="", max_length=160)
    note: str = Field(default="", max_length=2000)


def _cash_reference(session) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(10):
        candidate = "CASH-" + "".join(secrets.choice(alphabet) for _ in range(6))
        if not session.scalar(select(ApprovalPayment.id).where(ApprovalPayment.cash_reference == candidate)):
            return candidate
    raise RuntimeError("Could not allocate a cash reference")


@public_approval_router.post("/{token}/payments", status_code=201)
def create_payment_intent(token: str, body: PaymentIntentIn):
    with SessionLocal.begin() as session:
        approval = _public_approval(session, token)
        if approval.status != "approved":
            raise HTTPException(409, "يجب اعتماد العرض أولاً")
        existing = session.scalar(select(ApprovalPayment).where(
            ApprovalPayment.approval_id == approval.id,
            ApprovalPayment.status.notin_(["cancelled", "rejected"]),
        ).order_by(ApprovalPayment.created_at.desc()))
        if existing:
            if existing.method == body.method:
                return {"ok": True, "already_exists": True, "payment": _row(existing, exclude={"proof_storage_key", "proof_sha256"})}
            raise HTTPException(409, "يوجد اختيار دفع نشط بالفعل")
        timestamp = now_iso()
        payment = ApprovalPayment(
            id=str(uuid.uuid4()), approval_id=approval.id, method=body.method,
            amount=approval.final_total, currency="EGP", status="pending",
            payment_reference=f"PAY-{approval.approval_number}",
            external_reference=body.external_reference.strip(), payer_note=body.note.strip(),
            cash_reference=_cash_reference(session) if body.method == "cash" else "",
            created_at=timestamp, updated_at=timestamp,
        )
        session.add(payment)
        session.flush()
        _audit(session, entity_type="approval", entity_id=approval.id,
               event_type="cash_reference_generated" if body.method == "cash" else "payment_method_selected",
               project_id=approval.project_id, actor_type="public", actor_name=approval.engineer_name,
               message="تم إنشاء مرجع دفع نقدي" if body.method == "cash" else "تم اختيار طريقة الدفع",
               metadata={"method": body.method, "payment_id": payment.id})
        return {"ok": True, "already_exists": False, "payment": _row(payment, exclude={"proof_storage_key", "proof_sha256"})}


@public_approval_router.post("/{token}/payments/{payment_id}/proof")
async def upload_payment_proof(
    token: str, payment_id: str, proof: UploadFile = File(...),
    external_reference: str = Form(default=""), note: str = Form(default=""),
):
    media_type = (proof.content_type or "").lower()
    if media_type not in PROOF_MEDIA:
        raise HTTPException(422, "ارفع صورة JPG أو PNG أو WebP فقط")
    content = await proof.read(MAX_PROOF_BYTES + 1)
    if not content or len(content) > MAX_PROOF_BYTES:
        raise HTTPException(422, "حجم صورة إثبات الدفع يجب ألا يتجاوز 5 ميجابايت")
    digest = hashlib.sha256(content).hexdigest()
    key = f"approval_payments/{payment_id}/{uuid.uuid4().hex}{PROOF_MEDIA[media_type]}"
    storage = get_attachment_storage()
    stored = False
    try:
        with SessionLocal.begin() as session:
            approval = _public_approval(session, token)
            payment = session.get(ApprovalPayment, payment_id)
            if not payment or payment.approval_id != approval.id:
                raise HTTPException(404, "عملية الدفع غير موجودة")
            if payment.method == "cash":
                raise HTTPException(409, "الدفع النقدي لا يحتاج صورة إثبات")
            if payment.status in {"verified", "cancelled"}:
                raise HTTPException(409, "لا يمكن رفع إثبات لهذه العملية")
            storage.put(key, content, media_type, digest)
            stored = True
            old_key = payment.proof_storage_key
            payment.proof_storage_key = key
            payment.proof_original_name = Path(proof.filename or "proof").name[:240]
            payment.proof_media_type = media_type
            payment.proof_size = len(content)
            payment.proof_sha256 = digest
            payment.proof_uploaded_at = now_iso()
            payment.external_reference = external_reference.strip()[:160]
            payment.payer_note = note.strip()[:2000]
            payment.status = "under_review"
            payment.updated_at = now_iso()
            _audit(session, entity_type="approval", entity_id=approval.id,
                   event_type="payment_proof_uploaded", project_id=approval.project_id,
                   actor_type="public", actor_name=approval.engineer_name,
                   message="تم رفع إثبات دفع وأصبح تحت المراجعة",
                   metadata={"payment_id": payment.id, "media_type": media_type, "size": len(content)})
        if old_key and old_key != key:
            storage.delete(old_key)
        return {"ok": True, "status": "under_review", "paid": False}
    except Exception:
        if stored:
            storage.delete(key)
        raise


class PaymentReviewIn(BaseModel):
    actor: str = ""
    note: str = ""


@internal_workflow_router.get("/payments/{payment_id}/proof")
def get_payment_proof(payment_id: str):
    with SessionLocal() as session:
        payment = session.get(ApprovalPayment, payment_id)
        if not payment or not payment.proof_storage_key:
            raise HTTPException(404, "صورة الإثبات غير موجودة")
        stored = get_attachment_storage().get(payment.proof_storage_key)
        return StreamingResponse(stored.body, media_type=payment.proof_media_type,
                                 headers={"Content-Length": str(stored.content_length),
                                          "Cache-Control": "private, no-store"})


@internal_workflow_router.post("/payments/{payment_id}/verify")
def verify_payment(
    payment_id: str, body: PaymentReviewIn,
    # Business owner for payment-proof verification is not clearly assigned
    # by the existing code (no actor_role field, no role-specific check) -
    # per this sprint's instructions this is left unassigned rather than
    # guessed. Any authenticated ERP role may act; admin as always.
    current_user: User = Depends(require_erp_role()),
):
    with SessionLocal.begin() as session:
        payment = session.get(ApprovalPayment, payment_id)
        if not payment:
            raise HTTPException(404, "عملية الدفع غير موجودة")
        if payment.status == "verified":
            return {"ok": True, "already_verified": True, "payment": _row(payment, exclude={"proof_storage_key", "proof_sha256"})}
        if payment.method == "cash" or payment.status != "under_review" or not payment.proof_storage_key:
            raise HTTPException(409, "لا يوجد إثبات دفع جاهز للتحقق")
        timestamp = now_iso()
        payment.status = "verified"
        payment.reviewed_by = current_user.username
        payment.reviewed_at = timestamp
        payment.paid_at = timestamp
        payment.updated_at = timestamp
        approval = session.get(EngineerApproval, payment.approval_id)
        _audit(session, entity_type="approval", entity_id=approval.id,
               event_type="payment_verified", project_id=approval.project_id,
               actor_name=current_user.username, message="تم التحقق من الدفع يدويًا",
               metadata={"payment_id": payment.id})
        return {"ok": True, "already_verified": False, "payment": _row(payment, exclude={"proof_storage_key", "proof_sha256"})}


@internal_workflow_router.post("/payments/{payment_id}/reject")
def reject_payment(
    payment_id: str, body: PaymentReviewIn,
    current_user: User = Depends(require_erp_role()),  # see verify_payment - ownership unassigned, not guessed
):
    with SessionLocal.begin() as session:
        payment = session.get(ApprovalPayment, payment_id)
        if not payment:
            raise HTTPException(404, "عملية الدفع غير موجودة")
        if payment.status != "under_review":
            raise HTTPException(409, "لا يمكن رفض عملية الدفع من حالتها الحالية")
        timestamp = now_iso()
        payment.status = "rejected"
        payment.reviewed_by = current_user.username
        payment.reviewed_at = timestamp
        payment.payer_note = (payment.payer_note + "\n" + body.note.strip()).strip()
        payment.updated_at = timestamp
        approval = session.get(EngineerApproval, payment.approval_id)
        _audit(session, entity_type="approval", entity_id=approval.id,
               event_type="payment_proof_rejected", project_id=approval.project_id,
               actor_name=current_user.username, message="تم رفض إثبات الدفع",
               metadata={"payment_id": payment.id})
        return {"ok": True, "paid": False, "payment": _row(payment, exclude={"proof_storage_key", "proof_sha256"})}


class CashConfirmIn(BaseModel):
    cash_reference: str
    actor: str = ""


@internal_workflow_router.post("/payments/{payment_id}/confirm-cash")
def confirm_cash(
    payment_id: str, body: CashConfirmIn,
    current_user: User = Depends(require_erp_role()),  # see verify_payment - ownership unassigned, not guessed
):
    with SessionLocal.begin() as session:
        payment = session.get(ApprovalPayment, payment_id)
        if not payment:
            raise HTTPException(404, "عملية الدفع غير موجودة")
        if payment.method != "cash" or not secrets.compare_digest(payment.cash_reference, body.cash_reference.strip().upper()):
            raise HTTPException(409, "مرجع الدفع النقدي غير صحيح")
        if payment.status == "verified" or payment.cash_consumed_at:
            raise HTTPException(409, "تم استخدام مرجع الدفع النقدي من قبل")
        if payment.status in {"cancelled", "rejected"}:
            raise HTTPException(409, "عملية الدفع النقدي غير نشطة")
        timestamp = now_iso()
        payment.status = "verified"
        payment.cash_consumed_at = timestamp
        payment.reviewed_by = current_user.username
        payment.reviewed_at = timestamp
        payment.paid_at = timestamp
        payment.updated_at = timestamp
        approval = session.get(EngineerApproval, payment.approval_id)
        _audit(session, entity_type="approval", entity_id=approval.id,
               event_type="cash_received", project_id=approval.project_id,
               actor_name=current_user.username, message="تم استلام النقد واستهلاك المرجع لمرة واحدة",
               metadata={"payment_id": payment.id})
        return {"ok": True, "payment": _row(payment, exclude={"proof_storage_key", "proof_sha256"})}


@internal_workflow_router.get("/projects/{project_id}/procurement-hub")
def project_procurement_hub(project_id: str):
    with SessionLocal() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(404, "المشروع غير موجود")
        requests = session.scalars(select(IncomingPurchaseRequest).where(
            IncomingPurchaseRequest.project_id == project_id
        ).order_by(IncomingPurchaseRequest.created_at.desc())).all()
        comparisons = session.scalars(select(PriceComparison).where(
            PriceComparison.project_id == project_id
        ).order_by(PriceComparison.updated_at.desc())).all()
        approvals = session.scalars(select(EngineerApproval).where(
            EngineerApproval.project_id == project_id
        ).order_by(EngineerApproval.updated_at.desc())).all()
        orders = session.scalars(select(PurchaseOrder).where(
            PurchaseOrder.project_id == project_id
        ).order_by(PurchaseOrder.po_number.desc())).all()
        purchases = session.scalars(select(Purchase).where(
            Purchase.project_id == project_id
        ).order_by(Purchase.purchase_date.desc())).all()
        approval_ids = [a.id for a in approvals]
        workflow_payments = session.scalars(select(ApprovalPayment).where(
            ApprovalPayment.approval_id.in_(approval_ids)
        ).order_by(ApprovalPayment.created_at.desc())).all() if approval_ids else []
        purchase_ids = [p.purchase_id for p in purchases]
        historical_payments = session.scalars(select(Payment).where(
            Payment.purchase_id.in_(purchase_ids)
        ).order_by(Payment.payment_date.desc())).all() if purchase_ids else []
        timeline = session.scalars(select(WorkflowAuditEvent).where(
            WorkflowAuditEvent.project_id == project_id
        ).order_by(WorkflowAuditEvent.created_at.desc()).limit(100)).all()
        order_ids = [order.id for order in orders]
        formal_payments = session.scalars(select(PurchaseOrderPayment).where(
            PurchaseOrderPayment.purchase_order_id.in_(order_ids),
            PurchaseOrderPayment.status == "recorded",
        ).order_by(PurchaseOrderPayment.payment_date.desc())).all() if order_ids else []
        formal_paid_by_order = {}
        for payment in formal_payments:
            formal_paid_by_order[payment.purchase_order_id] = (
                formal_paid_by_order.get(payment.purchase_order_id, 0.0)
                + float(payment.amount or 0)
            )
        order_items = session.scalars(select(PurchaseOrderItem).where(
            PurchaseOrderItem.purchase_order_id.in_(order_ids)
        )).all() if order_ids else []
        receipts = session.scalars(select(PurchaseOrderReceipt).where(
            PurchaseOrderReceipt.purchase_order_id.in_(order_ids)
        ).order_by(PurchaseOrderReceipt.received_at.desc())).all() if order_ids else []
        successful_receipt_ids = [
            receipt.id for receipt in receipts if receipt.receipt_type in {"full", "partial"}
        ]
        receipt_lines = session.scalars(select(PurchaseOrderReceiptLine).where(
            PurchaseOrderReceiptLine.receipt_id.in_(successful_receipt_ids)
        )).all() if successful_receipt_ids else []
        receipt_order_by_id = {receipt.id: receipt.purchase_order_id for receipt in receipts}
        received_by_order = {}
        for line in receipt_lines:
            order_id = receipt_order_by_id.get(line.receipt_id)
            received_by_order[order_id] = received_by_order.get(order_id, 0.0) + float(line.received_quantity or 0)
        ordered_by_order = {}
        for item in order_items:
            ordered_by_order[item.purchase_order_id] = ordered_by_order.get(item.purchase_order_id, 0.0) + float(item.quantity or 0)
        order_documents = []
        for order in orders:
            document = _row(order)
            ordered = ordered_by_order.get(order.id, 0.0)
            received = min(ordered, received_by_order.get(order.id, 0.0))
            document["receipt_summary"] = {
                "ordered_quantity": round(ordered, 6),
                "received_quantity": round(received, 6),
                "remaining_quantity": round(max(0.0, ordered - received), 6),
            }
            document["receipt_count"] = sum(1 for receipt in receipts if receipt.purchase_order_id == order.id)
            paid_amount = min(float(order.final_total or 0), formal_paid_by_order.get(order.id, 0.0))
            document["payment_summary"] = {
                "paid_amount": round(paid_amount, 2),
                "outstanding_amount": round(max(0.0, float(order.final_total or 0) - paid_amount), 2),
            }
            order_documents.append(document)
        orders_by_approval = {}
        for order in order_documents:
            if order.get("approval_id"):
                orders_by_approval.setdefault(order["approval_id"], []).append(order)
        approvals_by_comparison = {}
        for approval in approvals:
            approvals_by_comparison.setdefault(approval.comparison_id, []).append(approval)
        comparisons_by_request = {}
        for comparison in comparisons:
            if comparison.source_request_id:
                comparisons_by_request.setdefault(comparison.source_request_id, []).append(comparison)
        traceability = []
        for request_row in requests:
            comparison_nodes = []
            for comparison in comparisons_by_request.get(request_row.id, []):
                approval_nodes = []
                for approval in approvals_by_comparison.get(comparison.id, []):
                    approval_nodes.append({
                        "id": approval.id,
                        "approval_number": approval.approval_number,
                        "status": approval.status,
                        "approval_stage": approval.approval_stage,
                        "revision_number": approval.revision_number,
                        "purchase_orders": [{
                            "id": order["id"],
                            "po_number": order["po_number"],
                            "supplier_name": order.get("supplier_name") or "",
                            "status": order.get("status") or "",
                            "receipt_summary": order["receipt_summary"],
                            "receipt_count": order["receipt_count"],
                        } for order in orders_by_approval.get(approval.id, [])],
                    })
                comparison_nodes.append({
                    "id": comparison.id,
                    "comparison_number": comparison.comparison_number,
                    "comparison_date": comparison.comparison_date,
                    "approvals": approval_nodes,
                })
            traceability.append({
                "request": {
                    "id": request_row.id,
                    "request_number": request_row.request_number,
                    "status": request_row.status,
                },
                "comparisons": comparison_nodes,
            })
        kpis = calculate_procurement_kpis(
            requests=requests,
            comparisons=comparisons,
            approvals=approvals,
            purchase_orders=orders,
            purchases=purchases,
            direct_payments=historical_payments,
            approval_payments=workflow_payments,
        )
        kpis.update({
            "under_review": sum(
                1 for x in requests
                if x.status in {"new", "under_review", "need_clarification"}
            ),
            "pending_approval": sum(
                1 for x in approvals
                if x.status in {"ready_to_send", "sent", "pending_approval"}
            ),
            "active_request_count": sum(
                1 for x in requests if x.status not in {"completed", "rejected", "cancelled"}
            ),
            "active_po_count": sum(
                1 for x in orders if x.status not in {"completed", "cancelled"}
            ),
            "formal_paid_amount": round(sum(
                formal_paid_by_order.get(x.id, 0.0)
                for x in orders if x.status != "cancelled"
            ), 2),
            "formal_outstanding_amount": round(sum(
                max(0.0, float(x.final_total or 0) - formal_paid_by_order.get(x.id, 0.0))
                for x in orders if x.status != "cancelled"
            ), 2),
            "receiving_problem_count": sum(
                1 for x in orders if x.status in {"partial_received", "delivery_problem"}
            ),
        })
        return {
            "project": _row(project),
            "kpis": kpis,
            "requests": [_row(x) for x in requests],
            "comparisons": [_row(x) for x in comparisons],
            "approvals": [_row(x, exclude={"secure_token"}) for x in approvals],
            "purchase_orders": order_documents,
            "traceability": traceability,
            "purchases": [_row(x) for x in purchases],
            "payments": [_row(x, exclude={"proof_storage_key", "proof_sha256"}) for x in workflow_payments],
            "formal_payments": [_row(x) for x in formal_payments],
            "historical_payments": [_row(x) for x in historical_payments],
            "timeline": [_row(x) for x in timeline],
            "receipts": [_row(x) for x in receipts],
            "receiving_supported": True,
        }
