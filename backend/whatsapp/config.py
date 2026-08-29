"""Configuration and provider composition for the WhatsApp intake channel.

WHATSAPP_ENABLED is intentionally NOT read here as a behavioral gate anymore
(see whatsapp/router.py and whatsapp/settings_service.py) — whether the
service actively drafts/creates requests is now an Admin-controlled runtime
toggle stored in whatsapp_settings, changeable from Settings without a
redeploy. env_enabled_default() is read exactly once, to seed that row's
initial value the first time it's created, so a deployment that already set
WHATSAPP_ENABLED=true keeps working unchanged.
"""

from __future__ import annotations

import os


def env_enabled_default() -> bool:
    return os.getenv("WHATSAPP_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


def capability() -> dict:
    """Which Meta credential env vars are missing. Independent of the
    Admin on/off toggle — these are the one-time server-side setup, not the
    daily switch."""
    missing = []
    if not os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip():
        missing.append("WHATSAPP_PHONE_NUMBER_ID")
    if not os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip():
        missing.append("WHATSAPP_ACCESS_TOKEN")
    if not os.getenv("WHATSAPP_VERIFY_TOKEN", "").strip():
        missing.append("WHATSAPP_VERIFY_TOKEN")
    if not os.getenv("WHATSAPP_APP_SECRET", "").strip():
        missing.append("WHATSAPP_APP_SECRET")
    return {"available": not missing, "missing": missing}


def verify_token() -> str:
    return os.getenv("WHATSAPP_VERIFY_TOKEN", "")


def app_secret() -> str:
    return os.getenv("WHATSAPP_APP_SECRET", "")


def phone_number_id() -> str:
    return os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")


def access_token() -> str:
    return os.getenv("WHATSAPP_ACCESS_TOKEN", "")


def build_provider():
    """Real Meta provider when credentials are configured; a safe no-op
    otherwise (used automatically in dev/tests so nothing ever tries a live
    network call without explicit configuration)."""
    if capability()["available"]:
        from .providers.meta import MetaWhatsAppProvider

        return MetaWhatsAppProvider(phone_number_id(), access_token())
    from .providers.disabled import DisabledWhatsAppProvider

    return DisabledWhatsAppProvider()
