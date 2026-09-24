"""The WhatsApp draft conversation state machine.

This module owns everything between "a message arrived from a known Site
Engineer" and "a real Incoming Purchase Request exists" (or the engineer
cancelled). It never constructs an IncomingPurchaseRequest itself — creation
always goes through site_portal.create_incoming_request, the exact function
the authenticated Site Portal uses.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

try:
    from ..database import Item, Project
    from ..site_portal import _assigned_projects, create_incoming_request
    from . import parser
    from .matching import match_item_master, match_project
    from .models import WhatsAppDraft
    from .phone import mask_phone
except ImportError:  # pragma: no cover - direct backend execution
    from database import Item, Project
    from site_portal import _assigned_projects, create_incoming_request
    from whatsapp import parser
    from whatsapp.matching import match_item_master, match_project
    from whatsapp.models import WhatsAppDraft
    from whatsapp.phone import mask_phone

logger = logging.getLogger("whatsapp.session")

DRAFT_EXPIRY_HOURS = 24
IN_PROGRESS_STATUSES = {
    "collecting", "awaiting_project_choice", "awaiting_item_info", "awaiting_delivery_date",
}

UNKNOWN_PHONE_TEXT = "رقمك غير مسجل على ProcureX. برجاء التواصل مع مسؤول النظام."
NO_PROJECT_ASSIGNED_TEXT = "لا يوجد مشروع مخصص لحسابك حاليًا. برجاء التواصل مع مسؤول النظام."
NO_ITEMS_RECOGNIZED_TEXT = (
    "لم أتعرف على أي أصناف في رسالتك. برجاء إرسال الطلب بصيغة مشابهة لـ:\n\n"
    "اسم المشروع\n20 شيكارة معجون\n10 جردل سيلر\n\nمطلوب 2 سبتمبر"
)
NOTHING_TO_CONFIRM_TEXT = "لا يوجد طلب قيد الانتظار للتأكيد. أرسل تفاصيل الطلب أولاً."
NOTHING_TO_CANCEL_TEXT = "لا يوجد طلب لإلغائه حاليًا."
CANCEL_ACK_TEXT = "تم إلغاء الطلب."
FAILURE_TEXT = "تعذر تسجيل الطلب حاليًا. لم يتم إنشاء طلب شراء. حاول مرة أخرى بعد قليل."
BAD_QTY_UNIT_TEXT = "من فضلك أرسل الكمية والوحدة لـ {name} بهذا الشكل: 20 شيكارة"
BAD_DATE_TEXT = "لم أفهم تاريخ الاحتياج. من فضلك أرسل التاريخ مثل 02/09 أو 2 سبتمبر"
BAD_PROJECT_CHOICE_TEXT = "من فضلك أرسل رقم المشروع من القائمة."


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _display_date(iso_date: str) -> str:
    try:
        return datetime.strptime(iso_date, "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return iso_date


def _project_choice_text(candidates: list[dict]) -> str:
    lines = ["اختر المشروع:", ""]
    lines.extend(f"{index}- {row['name']}" for index, row in enumerate(candidates, 1))
    return "\n".join(lines)


def _ask_item_info_text(product_name: str) -> str:
    return f"ما هي الكمية والوحدة ل{product_name}؟"


def _ask_delivery_date_text() -> str:
    return "ما هو تاريخ الاحتياج المطلوب؟ (مثال: 2 سبتمبر)"


def _summary_text(draft: WhatsAppDraft) -> str:
    lines = ["طلب شراء جديد", "", f"المشروع: {draft.project_name}", ""]
    for index, item in enumerate(draft.items_json, 1):
        lines.append(f"{index}. {item['product_name']}")
        lines.append(f"{_format_quantity(item['quantity'])} {item['unit']}")
        lines.append("")
    lines.append(f"تاريخ الاحتياج: {_display_date(draft.required_delivery_date)}")
    lines.append("")
    lines.append("للتأكيد اكتب:")
    lines.append("تأكيد")
    lines.append("")
    lines.append("لإلغاء الطلب:")
    lines.append("إلغاء")
    return "\n".join(lines)


def _success_text(request_number: str, project_name: str) -> str:
    return (
        "تم تسجيل طلب الشراء بنجاح ✅\n\n"
        "رقم الطلب:\n"
        f"{request_number}\n\n"
        "المشروع:\n"
        f"{project_name}\n\n"
        "تم إرساله للمراجعة."
    )


def _format_quantity(quantity: float) -> str:
    if quantity is None:
        return ""
    return str(int(quantity)) if float(quantity).is_integer() else str(quantity)


def resolve_engineer(session, phone_e164: str):
    """Active site_portal User for a normalized phone, or None."""
    try:
        from ..auth.models import User
    except ImportError:  # pragma: no cover
        from auth.models import User
    if not phone_e164:
        return None
    return session.scalar(
        select(User).where(
            User.account_type == "site_portal",
            User.active.is_(True),
            User.phone_e164 == phone_e164,
        )
    )


def _load_latest_draft(session, phone_e164: str) -> WhatsAppDraft | None:
    return session.scalar(
        select(WhatsAppDraft)
        .where(WhatsAppDraft.phone_e164 == phone_e164)
        .order_by(WhatsAppDraft.created_at.desc())
    )


def _is_expired(draft: WhatsAppDraft) -> bool:
    try:
        expires_at = datetime.fromisoformat(draft.expires_at)
    except ValueError:
        return False
    return datetime.now(timezone.utc) >= expires_at


def _incomplete_item_index(items: list[dict]) -> int | None:
    for index, item in enumerate(items):
        if item.get("quantity") is None or not item.get("unit"):
            return index
    return None


def _advance(draft: WhatsAppDraft) -> str:
    """Recompute what's still missing and move the draft to the right
    status, returning the reply text for that state."""
    incomplete_index = _incomplete_item_index(draft.items_json)
    if incomplete_index is not None:
        draft.pending_item_index = incomplete_index
        draft.status = "awaiting_item_info"
        return _ask_item_info_text(draft.items_json[incomplete_index]["product_name"])
    if not draft.required_delivery_date:
        draft.status = "awaiting_delivery_date"
        return _ask_delivery_date_text()
    draft.status = "collecting"
    return _summary_text(draft)


def _start_new_draft(session, user, phone_e164: str, text: str) -> str:
    parsed = parser.parse_message(text)
    if not parsed.items:
        return NO_ITEMS_RECOGNIZED_TEXT

    projects = _assigned_projects(session, user.id)
    if not projects:
        return NO_PROJECT_ASSIGNED_TEXT
    if len(projects) == 1:
        project = projects[0]
    else:
        project = match_project(parsed.project_name, projects)

    item_master_rows = session.scalars(select(Item)).all()
    items = [{
        "item_id": match_item_master(item.product_name, item_master_rows) if item_master_rows else "",
        "product_name": item.product_name,
        "quantity": item.quantity,
        "unit": item.unit,
    } for item in parsed.items]

    now = _now()
    draft = WhatsAppDraft(
        id=str(uuid.uuid4()), phone_e164=phone_e164, user_id=user.id,
        project_id=project.id if project else "",
        project_name=project.name if project else parsed.project_name,
        candidate_projects_json=[], items_json=items, pending_item_index=-1,
        required_delivery_date=parsed.required_delivery_date,
        status="collecting", created_at=now, updated_at=now,
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=DRAFT_EXPIRY_HOURS)).isoformat(),
    )
    session.add(draft)

    if project is None:
        draft.status = "awaiting_project_choice"
        draft.candidate_projects_json = [{"id": p.id, "name": p.name} for p in projects]
        session.commit()
        return _project_choice_text(draft.candidate_projects_json)

    reply = _advance(draft)
    session.commit()
    return reply


def _continue_draft(session, draft: WhatsAppDraft, text: str) -> str:
    if draft.status == "awaiting_project_choice":
        choice = parser.parse_bare_number(text)
        candidates = draft.candidate_projects_json or []
        if choice is None or not (1 <= choice <= len(candidates)):
            return BAD_PROJECT_CHOICE_TEXT + "\n\n" + _project_choice_text(candidates)
        chosen = candidates[choice - 1]
        draft.project_id, draft.project_name = chosen["id"], chosen["name"]
        draft.candidate_projects_json = []
        reply = _advance(draft)
        session.commit()
        return reply

    if draft.status == "awaiting_item_info":
        parsed_qty_unit = parser.parse_quantity_unit(text)
        if parsed_qty_unit is None:
            product_name = draft.items_json[draft.pending_item_index]["product_name"]
            return BAD_QTY_UNIT_TEXT.format(name=product_name)
        quantity, unit = parsed_qty_unit
        items = list(draft.items_json)
        items[draft.pending_item_index] = {**items[draft.pending_item_index], "quantity": quantity, "unit": unit}
        draft.items_json = items
        reply = _advance(draft)
        session.commit()
        return reply

    if draft.status == "awaiting_delivery_date":
        parsed_date = parser.parse_date_reply(text)
        if not parsed_date:
            return BAD_DATE_TEXT
        draft.required_delivery_date = parsed_date
        reply = _advance(draft)
        session.commit()
        return reply

    # status == "collecting": already fully ready, only تأكيد/إلغاء are
    # expected — anything else just gets the summary resent.
    return _summary_text(draft)


def _is_ready(draft: WhatsAppDraft) -> bool:
    return (
        bool(draft.project_id)
        and _incomplete_item_index(draft.items_json) is None
        and bool(draft.required_delivery_date)
    )


def _confirm_and_create(session, user, draft: WhatsAppDraft) -> str:
    try:
        project = session.get(Project, draft.project_id)
        if project is None:
            raise ValueError(f"draft {draft.id} references a missing project")
        resolved_items = [{
            "item_id": item["item_id"], "product_name": item["product_name"],
            "preferred_brand": "", "main_category": "", "subcategory": "",
            "specifications": "", "quantity": item["quantity"], "unit": item["unit"],
        } for item in draft.items_json]
        engineer_name = user.display_name or user.username
        request_id, request_number = create_incoming_request(
            session, user=user, project=project, items=resolved_items,
            required_delivery_date=draft.required_delivery_date,
            priority="normal", delivery_destination="site", notes="",
            prepared_attachments=[],
            intake_note=(
                f"تم تسجيل طلب الشراء عبر واتساب — المهندس: {engineer_name}"
                f" — الهاتف: {mask_phone(draft.phone_e164)}"
            ),
            source="whatsapp",
        )
        draft.status = "confirmed"
        draft.confirmed_request_id = request_id
        draft.confirmed_request_number = request_number
        draft.updated_at = _now()
        session.commit()
        return _success_text(request_number, project.name)
    except Exception:
        session.rollback()
        logger.exception("WhatsApp draft %s failed to create a purchase request", draft.id)
        return FAILURE_TEXT


def handle_inbound(session, user, phone_e164: str, text: str) -> str:
    """Advance (or start) the conversation for one already-deduplicated
    inbound text message. Returns the reply to send back."""
    draft = _load_latest_draft(session, phone_e164)
    if draft is not None and draft.status in IN_PROGRESS_STATUSES and _is_expired(draft):
        draft.status = "cancelled"
        session.commit()
        draft = None

    in_progress = draft is not None and draft.status in IN_PROGRESS_STATUSES

    if parser.is_cancel(text):
        if in_progress:
            draft.status = "cancelled"
            draft.updated_at = _now()
            session.commit()
            return CANCEL_ACK_TEXT
        if draft is not None and draft.status == "confirmed":
            return (
                f"تم بالفعل تسجيل هذا الطلب برقم {draft.confirmed_request_number}. "
                "لإلغائه يرجى التواصل مع مسؤول المشتريات."
            )
        return NOTHING_TO_CANCEL_TEXT

    if parser.is_confirm(text):
        if draft is not None and draft.status == "confirmed":
            return _success_text(draft.confirmed_request_number, draft.project_name)
        if in_progress:
            if _is_ready(draft):
                return _confirm_and_create(session, user, draft)
            reply = _advance(draft)  # re-ask whatever is still missing
            session.commit()
            return reply
        return NOTHING_TO_CONFIRM_TEXT

    if in_progress:
        return _continue_draft(session, draft, text)

    return _start_new_draft(session, user, phone_e164, text)
