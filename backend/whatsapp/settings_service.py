"""The Admin-controlled WhatsApp Settings singleton row and its small
read/update operations. Kept separate from router.py (webhook mechanics)
and admin_router.py (the HTTP surface) so both can share the same
persistence helpers without duplicating them."""

from __future__ import annotations

from datetime import datetime, timezone

try:
    from .config import env_enabled_default
    from .models import WHATSAPP_SETTINGS_ID, WhatsAppSettings
except ImportError:  # pragma: no cover - direct backend execution
    from whatsapp.config import env_enabled_default
    from whatsapp.models import WHATSAPP_SETTINGS_ID, WhatsAppSettings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_or_create_settings(session) -> WhatsAppSettings:
    row = session.get(WhatsAppSettings, WHATSAPP_SETTINGS_ID)
    if row is None:
        row = WhatsAppSettings(
            id=WHATSAPP_SETTINGS_ID, enabled=env_enabled_default(),
            updated_at=_now(),
        )
        session.add(row)
        session.commit()
    return row


def is_enabled(session) -> bool:
    return get_or_create_settings(session).enabled


def set_enabled(session, enabled: bool, actor: str) -> WhatsAppSettings:
    row = get_or_create_settings(session)
    row.enabled = enabled
    row.updated_by = actor
    row.updated_at = _now()
    session.commit()
    return row


def touch_webhook_verified(session) -> None:
    row = get_or_create_settings(session)
    row.last_webhook_verified_at = _now()
    session.commit()


def touch_webhook_event(session) -> None:
    row = get_or_create_settings(session)
    row.last_webhook_event_at = _now()
    session.commit()


def record_connection_result(
    session, *, status: str, error: str = "", business_number: str = "", business_name: str = "",
) -> WhatsAppSettings:
    row = get_or_create_settings(session)
    row.connection_status = status
    row.connection_error = error
    row.last_checked_at = _now()
    if business_number:
        row.business_number = business_number
    if business_name:
        row.business_name = business_name
    session.commit()
    return row
