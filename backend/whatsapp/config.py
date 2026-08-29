"""Configuration and provider composition for the WhatsApp intake channel."""

from __future__ import annotations

import os


def enabled() -> bool:
    return os.getenv("WHATSAPP_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


def capability() -> dict:
    missing = []
    if not os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip():
        missing.append("WHATSAPP_PHONE_NUMBER_ID")
    if not os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip():
        missing.append("WHATSAPP_ACCESS_TOKEN")
    if not os.getenv("WHATSAPP_VERIFY_TOKEN", "").strip():
        missing.append("WHATSAPP_VERIFY_TOKEN")
    if not os.getenv("WHATSAPP_APP_SECRET", "").strip():
        missing.append("WHATSAPP_APP_SECRET")
    is_enabled = enabled()
    available = is_enabled and not missing
    return {
        "enabled": is_enabled,
        "available": available,
        "status": "available" if available else ("configuration_required" if is_enabled else "disabled"),
        "missing": missing if is_enabled else [],
    }


def verify_token() -> str:
    return os.getenv("WHATSAPP_VERIFY_TOKEN", "")


def app_secret() -> str:
    return os.getenv("WHATSAPP_APP_SECRET", "")


def phone_number_id() -> str:
    return os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")


def access_token() -> str:
    return os.getenv("WHATSAPP_ACCESS_TOKEN", "")


def build_provider():
    """Real Meta provider when fully configured; a safe no-op otherwise
    (used automatically in dev/tests so nothing ever tries a live network
    call without explicit configuration)."""
    if capability()["available"]:
        from .providers.meta import MetaWhatsAppProvider

        return MetaWhatsAppProvider(phone_number_id(), access_token())
    from .providers.disabled import DisabledWhatsAppProvider

    return DisabledWhatsAppProvider()
