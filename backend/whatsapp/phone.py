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
