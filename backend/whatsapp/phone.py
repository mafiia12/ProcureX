"""E.164 phone-number normalization shared by the admin API and the webhook."""

from __future__ import annotations

import re


def normalize_e164(raw: str) -> str:
    """Best-effort normalization to "+<countrycode><number>".

    Meta always sends `wa_id` as digits only (no "+"), already in
    international format (e.g. "201012345678"). Admin-entered numbers may
    include "+", spaces, dashes, or a leading "00". Returns "" if the input
    doesn't look like a plausible phone number.
    """
    text = (raw or "").strip()
    if not text:
        return ""
    text = re.sub(r"[\s\-()]", "", text)
    if text.startswith("00"):
        text = "+" + text[2:]
    elif not text.startswith("+"):
        text = "+" + text
    digits = text[1:]
    if not digits.isdigit() or not (8 <= len(digits) <= 15):
        return ""
    return "+" + digits


def mask_phone(phone_e164: str) -> str:
    """For audit/history text a human might casually read — never the raw
    number. Keeps enough to recognize a number, hides the rest: "+2010****678"."""
    digits = phone_e164.lstrip("+")
    if len(digits) <= 7:
        return "+" + "*" * len(digits)
    visible_head, visible_tail = digits[:4], digits[-3:]
    masked_middle = "*" * (len(digits) - len(visible_head) - len(visible_tail))
    return f"+{visible_head}{masked_middle}{visible_tail}"
