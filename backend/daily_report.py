"""Daily Procurement Report - date-scoped operational and financial snapshot.

Every section is derived from the existing formal procurement workflow
records (REQ, RFQ/supplier quotations, CMP, approvals, PO, PO payments, PO
receiving) - never from the legacy Direct Purchase/Payment tables, matching
the rest of the formal-workflow reporting surface (see server.py's
_dashboard_procurement_intelligence, which this module reuses for the
"needs attention" section).

Only the top KPI summary is frozen into `snapshot_data` when a report is
closed (see close_daily_report); manual notes are simply locked (not
duplicated) once closed, and every detail section stays a live view even
for a closed date. This is a deliberate Phase-1 scope decision - see the
FEATURE GOAL notes for why a full immutable snapshot was not built.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import JSON, String, Text, func, select
from sqlalchemy.orm import Mapped, mapped_column

try:
    from .auth.models import User
    from .auth.service import require_erp_role
    from .commercial_totals import money, number
    from .database import (
        Base, PurchaseOrder, PurchaseOrderItem, PurchaseOrderPayment,
        PurchaseOrderReceipt, PurchaseOrderReceiptLine, SessionLocal,
    )
    from .incoming_requests import IncomingPurchaseRequest, IncomingPurchaseRequestItem
    from .price_comparisons import (
        PriceComparison, PriceComparisonRow, PriceComparisonSupplierOffer,
        _last_prices, _offer_document, _row_document, calculate_comparison,
    )
    from .procurement_workflow import EngineerApproval
    from .rfq import (
        RequestForQuotation, SupplierQuotation, SupplierQuotationAttachment,
        SupplierQuotationLine, _line_total as _quotation_line_total,
    )
except ImportError:  # pragma: no cover - direct backend execution
    from auth.models import User
    from auth.service import require_erp_role
    from commercial_totals import money, number
    from database import (
        Base, PurchaseOrder, PurchaseOrderItem, PurchaseOrderPayment,
        PurchaseOrderReceipt, PurchaseOrderReceiptLine, SessionLocal,
    )
    from incoming_requests import IncomingPurchaseRequest, IncomingPurchaseRequestItem
    from price_comparisons import (
        PriceComparison, PriceComparisonRow, PriceComparisonSupplierOffer,
        _last_prices, _offer_document, _row_document, calculate_comparison,
    )
    from procurement_workflow import EngineerApproval
    from rfq import (
        RequestForQuotation, SupplierQuotation, SupplierQuotationAttachment,
        SupplierQuotationLine, _line_total as _quotation_line_total,
    )


router = APIRouter(prefix="/reports/daily", tags=["daily-procurement-report"])

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PAYMENT_TOLERANCE = 0.01


class DailyReport(Base):
    """Persisted manual notes + close/reopen marker for one calendar date.

    One row per date (report_date is unique); rows are created lazily by
    the first notes save or close action, never by a plain GET, so simply
    browsing dates never accumulates empty rows.
    """

    __tablename__ = "daily_reports"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    report_date: Mapped[str] = mapped_column(String, unique=True, index=True)
    report_number: Mapped[str] = mapped_column(String, unique=True)
    general_notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    key_risks: Mapped[str] = mapped_column(Text, default="", server_default="")
    follow_up_notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    closed_at: Mapped[str] = mapped_column(String, default="", server_default="")
    closed_by: Mapped[str] = mapped_column(String, default="", server_default="")
    snapshot_data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_by: Mapped[str] = mapped_column(String, default="", server_default="")
    updated_by: Mapped[str] = mapped_column(String, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class NotesIn(BaseModel):
    general_notes: str = Field(default="", max_length=8000)
    key_risks: str = Field(default="", max_length=8000)
    follow_up_notes: str = Field(default="", max_length=8000)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _validate_date(value: str) -> str:
    if not DATE_RE.fullmatch(value or ""):
        raise HTTPException(422, "صيغة التاريخ يجب أن تكون YYYY-MM-DD")
    return value


def _report_number(report_date: str) -> str:
    return f"DPR-{report_date}"


def _display_name(user: User) -> str:
    return user.display_name or user.username


def _tri_state(total: float, paid: float) -> str:
    outstanding = max(0.0, money(total - paid))
    if outstanding <= PAYMENT_TOLERANCE:
        return "paid"
    if paid > PAYMENT_TOLERANCE:
        return "partially_paid"
    return "unpaid"


def _paid_amounts_by_order(
    session, order_ids: list[str], as_of_date: Optional[str],
) -> dict[str, float]:
    if not order_ids:
        return {}
    statement = select(
        PurchaseOrderPayment.purchase_order_id, PurchaseOrderPayment.amount,
    ).where(
        PurchaseOrderPayment.purchase_order_id.in_(order_ids),
        PurchaseOrderPayment.status == "recorded",
    )
    if as_of_date:
        statement = statement.where(PurchaseOrderPayment.payment_date <= as_of_date)
    totals: dict[str, float] = {}
    for order_id, amount in session.execute(statement).all():
        totals[order_id] = money(totals.get(order_id, 0.0) + number(amount))
    return totals


# ---------------- Section 1: Purchase requests received ----------------
def _requests_received(session, report_date: str) -> list[dict]:
    rows = session.scalars(
        select(IncomingPurchaseRequest)
        .where(IncomingPurchaseRequest.created_at.like(f"{report_date}%"))
        .order_by(IncomingPurchaseRequest.created_at)
    ).all()
    if not rows:
        return []
    items = session.scalars(
        select(IncomingPurchaseRequestItem)
        .where(IncomingPurchaseRequestItem.request_id.in_([row.id for row in rows]))
    ).all()
    items_by_request: dict[str, list] = {}
    for item in items:
        items_by_request.setdefault(item.request_id, []).append(item)
    result = []
    for row in rows:
        request_items = items_by_request.get(row.id, [])
        status_counts: dict[str, int] = {}
        for item in request_items:
            status_counts[item.review_status] = status_counts.get(item.review_status, 0) + 1
        result.append({
            "id": row.id,
            "request_number": row.request_number,
            "project_name": row.project_name,
            "requester_name": row.requester_name,
            "location": row.delivery_location or row.project_location,
            "created_at": row.created_at,
            "required_delivery_date": row.required_delivery_date,
            "item_count": len(request_items),
            "item_status_breakdown": status_counts,
            "priority": row.priority,
            "status": row.status,
        })
    return result


def _comparison_activity_by_id(session, comparisons: list) -> dict[str, dict]:
    """rows + supplier_summaries for each comparison, batched across all of
    them instead of one full price_comparisons._detail() call per
    comparison. _detail() also joins source-request attachments and RFQ
    quotations that this call site (the sourcing-activity section) never
    reads - skipped here entirely, not just batched."""
    if not comparisons:
        return {}
    comparison_ids = [comparison.id for comparison in comparisons]

    rows_by_comparison: dict[str, list] = {}
    for row in session.scalars(
        select(PriceComparisonRow)
        .where(PriceComparisonRow.comparison_id.in_(comparison_ids))
        .order_by(PriceComparisonRow.comparison_id, PriceComparisonRow.position)
    ).all():
        rows_by_comparison.setdefault(row.comparison_id, []).append(row)

    offers_by_comparison: dict[str, list] = {}
    for offer in session.scalars(
        select(PriceComparisonSupplierOffer)
        .where(PriceComparisonSupplierOffer.comparison_id.in_(comparison_ids))
        .order_by(PriceComparisonSupplierOffer.comparison_id, PriceComparisonSupplierOffer.supplier_name)
    ).all():
        offers_by_comparison.setdefault(offer.comparison_id, []).append(offer)

    all_item_codes = {row.item_code for rows in rows_by_comparison.values() for row in rows}
    last_prices = _last_prices(session, all_item_codes)

    activity_by_id: dict[str, dict] = {}
    for comparison in comparisons:
        rows = rows_by_comparison.get(comparison.id, [])
        offers = offers_by_comparison.get(comparison.id, [])
        row_documents = [_row_document(row) for row in rows]
        activity_by_id[comparison.id] = calculate_comparison(
            comparison.comparison_date,
            row_documents,
            {code: last_prices[code] for code in {row.item_code for row in rows} if code in last_prices},
            [_offer_document(offer) for offer in offers] or None,
        )
    return activity_by_id


# ---------------- Section 2: Supplier / sourcing activity ----------------
def _sourcing_activity(session, report_date: str) -> list[dict]:
    rows: list[dict] = []

    quotations = session.scalars(
        select(SupplierQuotation).where(
            (SupplierQuotation.quotation_date == report_date)
            | SupplierQuotation.created_at.like(f"{report_date}%")
            | SupplierQuotation.updated_at.like(f"{report_date}%")
        )
    ).all()
    if quotations:
        rfq_ids = {quotation.rfq_id for quotation in quotations}
        rfqs_by_id = {
            rfq.id: rfq for rfq in session.scalars(
                select(RequestForQuotation).where(RequestForQuotation.id.in_(rfq_ids))
            ).all()
        }
        quotation_ids = [quotation.id for quotation in quotations]
        lines = session.scalars(
            select(SupplierQuotationLine).where(SupplierQuotationLine.quotation_id.in_(quotation_ids))
        ).all()
        lines_by_quotation: dict[str, list] = {}
        for line in lines:
            lines_by_quotation.setdefault(line.quotation_id, []).append(line)
        attachment_counts: dict[str, int] = {}
        for quotation_id, count in session.execute(
            select(SupplierQuotationAttachment.quotation_id, func.count())
            .where(SupplierQuotationAttachment.quotation_id.in_(quotation_ids))
            .group_by(SupplierQuotationAttachment.quotation_id)
        ).all():
            attachment_counts[quotation_id] = count
        for quotation in quotations:
            rfq = rfqs_by_id.get(quotation.rfq_id)
            quotation_lines = lines_by_quotation.get(quotation.id, [])
            offer_total = round(sum(_quotation_line_total(line) for line in quotation_lines), 2)
            rows.append({
                "kind": "rfq_quotation",
                "reference": rfq.rfq_number if rfq else "",
                "project_name": rfq.project_name if rfq else "",
                "supplier_name": quotation.supplier_name,
                "status": quotation.status,
                "offer_total": offer_total,
                "is_complete": bool(quotation_lines) and quotation.status == "received",
                "selected": False,
                "attachment_count": attachment_counts.get(quotation.id, 0),
                "activity_at": max(quotation.updated_at, quotation.created_at),
            })

    comparisons = session.scalars(
        select(PriceComparison).where(
            (PriceComparison.comparison_date == report_date)
            | PriceComparison.updated_at.like(f"{report_date}%")
        )
    ).all()
    comparison_activity = _comparison_activity_by_id(session, comparisons)
    for comparison in comparisons:
        detail = comparison_activity[comparison.id]
        selected_supplier_ids = {
            row["supplier_id"] for row in detail["rows"] if row.get("selected_for_purchase")
        }
        for summary in detail["supplier_summaries"]:
            rows.append({
                "kind": "comparison",
                "reference": comparison.comparison_number,
                "project_name": comparison.project_name,
                "supplier_name": summary["supplier_name"],
                "status": "complete" if summary["is_complete"] else "incomplete",
                "offer_total": summary["final_offer_total"],
                "is_complete": summary["is_complete"],
                "selected": summary.get("supplier_id") in selected_supplier_ids,
                "attachment_count": None,
                "activity_at": comparison.updated_at,
            })

    rows.sort(key=lambda row: row["activity_at"], reverse=True)
    return rows


# ---------------- Section 3: Purchase orders issued ----------------
def _pos_issued(session, report_date: str) -> list[dict]:
    orders = session.scalars(
        select(PurchaseOrder)
        .where(PurchaseOrder.po_date == report_date)
        .order_by(PurchaseOrder.created_at)
    ).all()
    if not orders:
        return []
    order_ids = [order.id for order in orders]
    item_counts: dict[str, int] = {}
    for order_id, count in session.execute(
        select(PurchaseOrderItem.purchase_order_id, func.count())
        .where(PurchaseOrderItem.purchase_order_id.in_(order_ids))
        .group_by(PurchaseOrderItem.purchase_order_id)
    ).all():
        item_counts[order_id] = count
    paid_by_order = _paid_amounts_by_order(session, order_ids, as_of_date=None)
    result = []
    for order in orders:
        paid = paid_by_order.get(order.id, 0.0)
        total = number(order.final_total)
        outstanding = max(0.0, money(total - paid))
        result.append({
            "id": order.id,
            "po_number": order.po_number,
            "project_name": order.project_name,
            "supplier_name": order.supplier_name,
            "source_request_number": order.source_request_number,
            "comparison_number": order.comparison_number,
            "approval_number": order.approval_number,
            "item_count": item_counts.get(order.id, 0),
            "final_total": total,
            "paid_amount": paid,
            "outstanding_amount": outstanding,
            "payment_status": _tri_state(total, paid),
            "status": order.status,
        })
    return result


# ---------------- Section 4: Supplier financial position ----------------
def _supplier_financial_position(session, report_date: str) -> list[dict]:
    orders = session.scalars(
        select(PurchaseOrder).where(
            PurchaseOrder.po_date <= report_date,
            PurchaseOrder.status != "cancelled",
        )
    ).all()
    if not orders:
        return []
    order_ids = [order.id for order in orders]
    paid_by_order = _paid_amounts_by_order(session, order_ids, as_of_date=report_date)
    latest_payment_by_order: dict[str, str] = {}
    for order_id, payment_date in session.execute(
        select(PurchaseOrderPayment.purchase_order_id, func.max(PurchaseOrderPayment.payment_date))
        .where(
            PurchaseOrderPayment.purchase_order_id.in_(order_ids),
            PurchaseOrderPayment.status == "recorded",
            PurchaseOrderPayment.payment_date <= report_date,
        )
        .group_by(PurchaseOrderPayment.purchase_order_id)
    ).all():
        latest_payment_by_order[order_id] = payment_date

    suppliers: dict[str, dict] = {}
    for order in orders:
        key = order.supplier_id or order.supplier_name
        bucket = suppliers.setdefault(key, {
            "supplier_id": order.supplier_id, "supplier_name": order.supplier_name,
            "total_po_value": 0.0, "paid_amount": 0.0, "open_po_count": 0,
            "latest_payment_date": "", "latest_po_number": "", "latest_po_date": "",
        })
        paid = paid_by_order.get(order.id, 0.0)
        bucket["total_po_value"] = money(bucket["total_po_value"] + number(order.final_total))
        bucket["paid_amount"] = money(bucket["paid_amount"] + paid)
        if order.status != "completed":
            bucket["open_po_count"] += 1
        payment_date = latest_payment_by_order.get(order.id, "")
        if payment_date and payment_date > bucket["latest_payment_date"]:
            bucket["latest_payment_date"] = payment_date
        if order.po_date >= bucket["latest_po_date"]:
            bucket["latest_po_date"] = order.po_date
            bucket["latest_po_number"] = order.po_number

    result = []
    for bucket in suppliers.values():
        outstanding = max(0.0, money(bucket["total_po_value"] - bucket["paid_amount"]))
        result.append({
            **bucket,
            "outstanding_amount": outstanding,
            "payment_status": _tri_state(bucket["total_po_value"], bucket["paid_amount"]),
        })
    result.sort(key=lambda row: -row["outstanding_amount"])
    return result


# ---------------- Section 5: Payments made today ----------------
def _payments_today(session, report_date: str) -> list[dict]:
    payments = session.scalars(
        select(PurchaseOrderPayment)
        .where(
            PurchaseOrderPayment.payment_date == report_date,
            PurchaseOrderPayment.status == "recorded",
        )
        .order_by(PurchaseOrderPayment.created_at)
    ).all()
    if not payments:
        return []
    order_ids = list({payment.purchase_order_id for payment in payments})
    orders_by_id = {
        order.id: order for order in session.scalars(
            select(PurchaseOrder).where(PurchaseOrder.id.in_(order_ids))
        ).all()
    }
    # Deliberately the CURRENT outstanding balance (as of now), not a
    # reconstructed historical snapshot as of the payment - the PO Payment
    # Ledger keeps no per-payment running-balance history, so inventing one
    # here would misrepresent the record. See remaining_balance_is_current.
    current_paid = _paid_amounts_by_order(session, order_ids, as_of_date=None)
    result = []
    for payment in payments:
        order = orders_by_id.get(payment.purchase_order_id)
        current_outstanding = None
        if order:
            current_outstanding = max(
                0.0, money(number(order.final_total) - current_paid.get(order.id, 0.0)),
            )
        result.append({
            "id": payment.id,
            "payment_number": payment.payment_number,
            "supplier_name": order.supplier_name if order else "",
            "po_number": order.po_number if order else "",
            "project_name": order.project_name if order else "",
            "amount": number(payment.amount),
            "payment_method": payment.payment_method,
            "payment_reference": payment.payment_reference,
            "created_by": payment.created_by,
            "payment_date": payment.payment_date,
            "created_at": payment.created_at,
            "current_outstanding_amount": current_outstanding,
            "remaining_balance_is_current": True,
        })
    return result


# ---------------- Section 6: Receiving / delivery activity ----------------
def _receiving_activity(session, report_date: str) -> list[dict]:
    receipts = session.scalars(
        select(PurchaseOrderReceipt)
        .where(PurchaseOrderReceipt.received_at.like(f"{report_date}%"))
        .order_by(PurchaseOrderReceipt.received_at)
    ).all()
    if not receipts:
        return []
    receipt_ids = [receipt.id for receipt in receipts]
    line_stats: dict[str, dict] = {}
    for receipt_id, count, quantity in session.execute(
        select(
            PurchaseOrderReceiptLine.receipt_id,
            func.count(), func.sum(PurchaseOrderReceiptLine.received_quantity),
        )
        .where(PurchaseOrderReceiptLine.receipt_id.in_(receipt_ids))
        .group_by(PurchaseOrderReceiptLine.receipt_id)
    ).all():
        line_stats[receipt_id] = {"count": count, "quantity": number(quantity)}

    result = []
    for receipt in receipts:
        stats = line_stats.get(receipt.id, {"count": 0, "quantity": 0.0})
        result.append({
            "id": receipt.id,
            "po_number": receipt.po_number,
            "project_name": receipt.project_name,
            "supplier_name": receipt.supplier_name,
            "receipt_type": receipt.receipt_type,
            "line_count": stats["count"],
            "received_quantity": stats["quantity"],
            "actor_name": receipt.actor_name,
            "received_at": receipt.received_at,
            "note": receipt.note,
            "problem_reason": receipt.problem_reason,
        })
    return result


# ---------------- Section 7: Needs attention ----------------
async def _needs_attention(session, viewer_role: str) -> list[dict]:
    # Lazy import: server.py imports this module's router at load time, so
    # importing server.py back at daily_report.py's own module load time
    # would be circular. Deferring the import into this function body (only
    # executed once both modules have finished loading) is the same
    # established pattern rfq.py uses for its own cross-module helper.
    try:
        from .server import _dashboard_procurement_intelligence
        from .database import Payment, Purchase
        from .procurement_workflow import ApprovalPayment, calculate_procurement_kpis
    except ImportError:  # pragma: no cover - direct backend execution
        from server import _dashboard_procurement_intelligence
        from database import Payment, Purchase
        from procurement_workflow import ApprovalPayment, calculate_procurement_kpis

    requests = session.scalars(select(IncomingPurchaseRequest)).all()
    comparisons = session.scalars(select(PriceComparison)).all()
    approvals = session.scalars(select(EngineerApproval)).all()
    procurement_kpis = calculate_procurement_kpis(
        requests=requests, comparisons=comparisons, approvals=approvals,
        purchase_orders=session.scalars(select(PurchaseOrder)).all(),
        purchases=session.scalars(select(Purchase)).all(),
        direct_payments=session.scalars(select(Payment)).all(),
        approval_payments=session.scalars(select(ApprovalPayment)).all(),
    )
    intelligence = await _dashboard_procurement_intelligence(
        session, requests, comparisons, approvals, procurement_kpis, viewer_role=viewer_role,
    )
    return intelligence["attention_items"]


async def _build_report(session, report_date: str, viewer_role: str) -> dict:
    requests_received = _requests_received(session, report_date)
    sourcing_activity = _sourcing_activity(session, report_date)
    purchase_orders_issued = _pos_issued(session, report_date)
    supplier_financial_position = _supplier_financial_position(session, report_date)
    payments_today = _payments_today(session, report_date)
    receiving_activity = _receiving_activity(session, report_date)
    needs_attention = await _needs_attention(session, viewer_role)

    rfq_count = session.scalar(
        select(func.count()).select_from(RequestForQuotation).where(
            (RequestForQuotation.rfq_date == report_date)
            | RequestForQuotation.created_at.like(f"{report_date}%")
        )
    ) or 0
    approvals_completed = session.scalar(
        select(func.count()).select_from(EngineerApproval)
        .where(EngineerApproval.approved_at.like(f"{report_date}%"))
    ) or 0

    summary = {
        "new_requests_count": len(requests_received),
        "rfqs_created_count": rfq_count,
        "comparisons_active_count": len({
            row["reference"] for row in sourcing_activity if row["kind"] == "comparison"
        }),
        "approvals_completed_count": approvals_completed,
        "purchase_orders_issued_count": len(purchase_orders_issued),
        "purchase_orders_issued_value": money(sum(
            row["final_total"] for row in purchase_orders_issued if row["status"] != "cancelled"
        )),
        "payments_made_count": len(payments_today),
        "payments_made_value": money(sum(row["amount"] for row in payments_today)),
        "outstanding_supplier_balance": money(sum(
            row["outstanding_amount"] for row in supplier_financial_position
        )),
        "receipts_recorded_count": len(receiving_activity),
    }

    return {
        "summary": summary,
        "sections": {
            "requests_received": requests_received,
            "sourcing_activity": sourcing_activity,
            "purchase_orders_issued": purchase_orders_issued,
            "supplier_financial_position": supplier_financial_position,
            "payments_today": payments_today,
            "receiving_activity": receiving_activity,
            "needs_attention": needs_attention,
        },
    }


# In-process cache for CLOSED report dates only - a closed date's sections
# are logically frozen (this module's whole point is that only the summary
# is *stored* frozen; the detail sections were always recomputed live even
# for a closed date, which meant every repeat view of history redid every
# query in _build_report for no reason). The open/current-date report is
# never cached: it's still changing, and every existing test that reads
# "today" without closing anything expects a live recompute every time.
#
# Keyed by (report_date, viewer_role): _needs_attention() varies by the
# viewer's role, so a shared per-date cache would leak one role's view to
# another. Invalidated on both close and reopen - a closed report can be
# reopened, edited (implicitly, by new activity landing on that date) and
# closed again, and a stale cached body from before that round-trip would
# silently keep serving the old snapshot.
_closed_report_cache: dict[str, dict[str, dict]] = {}


def _invalidate_closed_report_cache(report_date: str) -> None:
    _closed_report_cache.pop(report_date, None)


@router.get("")
async def get_daily_report(
    date: str = "", current_user: User = Depends(require_erp_role()),
):
    report_date = _validate_date(date) if date else _today()
    with SessionLocal() as session:
        report_row = session.scalar(
            select(DailyReport).where(DailyReport.report_date == report_date)
        )
        is_closed = bool(report_row and report_row.closed_at)
        cached_body = (
            _closed_report_cache.get(report_date, {}).get(current_user.role)
            if is_closed else None
        )
        if cached_body is not None:
            body = cached_body
        else:
            body = await _build_report(session, report_date, current_user.role)
            if is_closed:
                _closed_report_cache.setdefault(report_date, {})[current_user.role] = body
    response = {
        "report_date": report_date,
        "report_number": report_row.report_number if report_row else _report_number(report_date),
        "generated_at": _now(),
        "is_closed": is_closed,
        "closed_at": report_row.closed_at if report_row else "",
        "closed_by": report_row.closed_by if report_row else "",
        "notes": {
            "general_notes": report_row.general_notes if report_row else "",
            "key_risks": report_row.key_risks if report_row else "",
            "follow_up_notes": report_row.follow_up_notes if report_row else "",
        },
        "sections": body["sections"],
    }
    if is_closed and report_row.snapshot_data:
        response["summary"] = report_row.snapshot_data.get("summary") or body["summary"]
        response["summary_frozen"] = True
    else:
        response["summary"] = body["summary"]
        response["summary_frozen"] = False
    return response


@router.put("/{report_date}/notes")
async def save_daily_report_notes(
    report_date: str, body: NotesIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    report_date = _validate_date(report_date)
    with SessionLocal() as session:
        row = session.scalar(select(DailyReport).where(DailyReport.report_date == report_date))
        if row and row.closed_at:
            raise HTTPException(409, "التقرير مغلق؛ يجب إعادة فتحه أولاً لتعديل الملاحظات")
        now = _now()
        if row is None:
            row = DailyReport(
                id=str(uuid.uuid4()), report_date=report_date,
                report_number=_report_number(report_date),
                created_by=_display_name(current_user), created_at=now, updated_at=now,
            )
            session.add(row)
        row.general_notes = body.general_notes.strip()
        row.key_risks = body.key_risks.strip()
        row.follow_up_notes = body.follow_up_notes.strip()
        row.updated_by = _display_name(current_user)
        row.updated_at = now
        session.commit()
        return {
            "report_date": row.report_date, "report_number": row.report_number,
            "notes": {
                "general_notes": row.general_notes, "key_risks": row.key_risks,
                "follow_up_notes": row.follow_up_notes,
            },
            "updated_at": row.updated_at, "updated_by": row.updated_by,
        }


@router.post("/{report_date}/close")
async def close_daily_report(
    report_date: str, current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    report_date = _validate_date(report_date)
    with SessionLocal() as session:
        row = session.scalar(select(DailyReport).where(DailyReport.report_date == report_date))
        if row and row.closed_at:
            raise HTTPException(409, "التقرير اليومي مغلق بالفعل")
        body = await _build_report(session, report_date, current_user.role)
        now = _now()
        if row is None:
            row = DailyReport(
                id=str(uuid.uuid4()), report_date=report_date,
                report_number=_report_number(report_date),
                created_by=_display_name(current_user), created_at=now, updated_at=now,
            )
            session.add(row)
        row.snapshot_data = {"summary": body["summary"]}
        row.closed_at = now
        row.closed_by = _display_name(current_user)
        row.updated_at = now
        session.commit()
        # This close already computed `body` for the snapshot above - warm
        # the cache with it for the closing user's role instead of throwing
        # that work away and recomputing on the very next GET.
        _closed_report_cache[report_date] = {current_user.role: body}
        return {
            "report_date": row.report_date, "report_number": row.report_number,
            "closed_at": row.closed_at, "closed_by": row.closed_by,
        }


@router.post("/{report_date}/reopen")
async def reopen_daily_report(
    report_date: str, current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    report_date = _validate_date(report_date)
    with SessionLocal() as session:
        row = session.scalar(select(DailyReport).where(DailyReport.report_date == report_date))
        if not row or not row.closed_at:
            raise HTTPException(409, "التقرير اليومي ليس مغلقًا")
        row.closed_at = ""
        row.closed_by = ""
        row.updated_by = _display_name(current_user)
        row.updated_at = _now()
        session.commit()
        _invalidate_closed_report_cache(report_date)
        return {"report_date": row.report_date, "closed_at": ""}
