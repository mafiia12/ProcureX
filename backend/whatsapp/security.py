"""Meta webhook authenticity checks: GET subscription verification and POST
X-Hub-Signature-256 validation. Never trusts an arbitrary POST body."""

from __future__ import annotations

import hashlib
import hmac


def verify_subscription(mode: str, token: str, expected_token: str) -> bool:
    return mode == "subscribe" and bool(expected_token) and hmac.compare_digest(token, expected_token)


def verify_signature(raw_body: bytes, signature_header: str, app_secret: str) -> bool:
    """`signature_header` is the raw "X-Hub-Signature-256" value, e.g.
    "sha256=<hex>". Constant-time comparison; rejects anything malformed."""
    if not signature_header or not app_secret:
        return False
    prefix = "sha256="
    if not signature_header.startswith(prefix):
        return False
    expected = hmac.new(app_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature_header[len(prefix):], expected)
