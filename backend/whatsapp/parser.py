"""Deterministic parsing of a simple Arabic/free-text WhatsApp purchase
request. No AI/LLM involved — this is intentionally a small set of regexes,
per the V1 product rule ("simple structured/free-text pattern... not a large
AI chatbot")."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, timedelta

ARABIC_INDIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

CONFIRM_WORDS = {"تاكيد", "تأكيد", "confirm", "confirmed", "yes", "ok"}
CANCEL_WORDS = {"الغاء", "إلغاء", "cancel", "cancelled"}

PROJECT_PREFIX_RE = re.compile(r"^(مشروع|project)\s*[:\-]?\s*", re.IGNORECASE)

ITEM_NAME_FIRST_RE = re.compile(
    r"^(?P<name>.+?)\s*[-–]\s*(?P<qty>\d+(?:[.,]\d+)?)\s+(?P<unit>\S+)\s*$"
)
ITEM_QTY_FIRST_RE = re.compile(
    r"^(?P<qty>\d+(?:[.,]\d+)?)\s+(?P<unit>\S+)\s+(?P<name>.+)$"
)
BARE_QTY_UNIT_RE = re.compile(r"^(?P<qty>\d+(?:[.,]\d+)?)\s+(?P<unit>\S+)$")
BARE_NUMBER_RE = re.compile(r"^(?P<num>\d+)$")

DELIVERY_KEYWORD_RE = re.compile(
    r"^(?:مطلوب|التسليم|الاحتياج|needed|required)\b\s*[:\-]?\s*(?P<rest>.+)$",
    re.IGNORECASE,
)
DATE_NUMERIC_RE = re.compile(r"^(?P<day>\d{1,2})[/\-](?P<month>\d{1,2})(?:[/\-](?P<year>\d{2,4}))?$")
DATE_ARABIC_RE = re.compile(r"^(?P<day>\d{1,2})\s+(?P<month>\S+)$")

ARABIC_MONTHS = {
    "يناير": 1, "فبراير": 2, "مارس": 3, "ابريل": 4, "أبريل": 4, "إبريل": 4,
    "مايو": 5, "يونيو": 6, "يوليو": 7, "اغسطس": 8, "أغسطس": 8,
    "سبتمبر": 9, "اكتوبر": 10, "أكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
}


def _normalize_word(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "").strip().casefold()
    text = re.sub(r"[ً-ٰٟ]", "", text)
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    return text


def _to_ascii_digits(text: str) -> str:
    return text.translate(ARABIC_INDIC_DIGITS)


def _to_float(raw: str) -> float:
    return float(raw.replace(",", "."))


@dataclass
class ParsedItem:
    product_name: str
    quantity: float | None = None
    unit: str | None = None


@dataclass
class ParsedMessage:
    project_name: str = ""
    items: list[ParsedItem] = field(default_factory=list)
    required_delivery_date: str = ""


def is_confirm(text: str) -> bool:
    return _normalize_word(text) in CONFIRM_WORDS


def is_cancel(text: str) -> bool:
    return _normalize_word(text) in CANCEL_WORDS


def parse_bare_number(text: str) -> int | None:
    stripped = _to_ascii_digits(text.strip())
    match = BARE_NUMBER_RE.match(stripped)
    return int(match.group("num")) if match else None


def parse_quantity_unit(text: str) -> tuple[float, str] | None:
    """Used only when asking a targeted follow-up ("what's the qty/unit for
    X?") — a bare "<qty> <unit>" reply, not a full item line."""
    stripped = _to_ascii_digits(text.strip())
    match = BARE_QTY_UNIT_RE.match(stripped)
    if not match:
        return None
    return _to_float(match.group("qty")), match.group("unit").strip()


def _resolve_year(day: int, month: int) -> str | None:
    today = date.today()
    for year in (today.year, today.year + 1):
        try:
            candidate = date(year, month, day)
        except ValueError:
            continue
        if candidate >= today - timedelta(days=1):
            return candidate.isoformat()
    return None


def _parse_date_text(rest: str) -> str:
    stripped = _to_ascii_digits(rest.strip())
    numeric = DATE_NUMERIC_RE.match(stripped)
    if numeric:
        day, month = int(numeric.group("day")), int(numeric.group("month"))
        year_text = numeric.group("year")
        if year_text:
            year = int(year_text) if len(year_text) == 4 else 2000 + int(year_text)
            try:
                return date(year, month, day).isoformat()
            except ValueError:
                return ""
        return _resolve_year(day, month) or ""
    arabic = DATE_ARABIC_RE.match(stripped)
    if arabic:
        month_key = _normalize_word(arabic.group("month"))
        month = ARABIC_MONTHS.get(month_key)
        if month:
            return _resolve_year(int(arabic.group("day")), month) or ""
    return ""


def _parse_item_line(line: str) -> ParsedItem | None:
    stripped = _to_ascii_digits(line.strip())
    name_first = ITEM_NAME_FIRST_RE.match(stripped)
    if name_first:
        return ParsedItem(
            product_name=name_first.group("name").strip(),
            quantity=_to_float(name_first.group("qty")),
            unit=name_first.group("unit").strip(),
        )
    qty_first = ITEM_QTY_FIRST_RE.match(stripped)
    if qty_first:
        return ParsedItem(
            product_name=qty_first.group("name").strip(),
            quantity=_to_float(qty_first.group("qty")),
            unit=qty_first.group("unit").strip(),
        )
    return None


def parse_date_reply(text: str) -> str:
    """A standalone date reply (no "مطلوب" keyword), used when the draft is
    specifically waiting on a required delivery date."""
    return _parse_date_text(text)


def parse_message(text: str) -> ParsedMessage:
    """The first non-empty line is always the project name (matches both
    forms in the spec: "مشروع رويال هيلز" and a bare "رويال هيلز"). Every
    line after that is either the delivery-date line or an item line — and
    an item line with no recognizable "<qty> <unit>" is kept as an
    *incomplete* item (quantity/unit left None) rather than dropped, so the
    caller can ask a targeted follow-up instead of silently losing it."""
    result = ParsedMessage()
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    if not lines:
        return result
    result.project_name = PROJECT_PREFIX_RE.sub("", lines[0]).strip()
    for line in lines[1:]:
        delivery_match = DELIVERY_KEYWORD_RE.match(_to_ascii_digits(line))
        if delivery_match and not result.required_delivery_date:
            result.required_delivery_date = _parse_date_text(delivery_match.group("rest"))
            continue
        item = _parse_item_line(line)
        result.items.append(item or ParsedItem(product_name=line))
    return result
