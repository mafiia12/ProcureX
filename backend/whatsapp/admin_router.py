"""Admin-only WhatsApp Settings: the on/off switch, connection status, and
Test Connection action shown in Settings -> "WhatsApp Purchase Requests".

Every endpoint requires an authenticated ERP admin (require_erp_role("admin"),
same as auth/admin_router.py). This never exposes a secret value — only
which credential CATEGORY is configured, plus the display-only business
number Meta itself returns on a successful Test Connection.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select

try:
    from ..auth.models import User
    from ..auth.service import require_erp_role
    from ..database import SessionLocal
    from . import config, settings_service
    from .providers.meta import MetaWhatsAppProvider
except ImportError:  # pragma: no cover - direct backend execution
    from auth.models import User
    from auth.service import require_erp_role
    from database import SessionLocal
    from whatsapp import config, settings_service
    from whatsapp.providers.meta import MetaWhatsAppProvider

router = APIRouter(prefix="/api/admin/whatsapp", tags=["whatsapp-admin"])

CONNECTION_ERROR_TEXT = "تعذر الاتصال بحساب WhatsApp Business."
WEBHOOK_RECENCY_HOURS = 24 * 30  # "ever seen in the last month" reads as connected; long enough not to flap


class EnabledUpdate(BaseModel):
    enabled: bool


def _local_backend_url(request: Request) -> str:
    """Diagnostic only - wherever the admin's own browser happens to be
    hitting the backend from. Never a valid Meta callback (Meta cannot
    reach 127.0.0.1/localhost), so this is never returned as webhook_url."""
    host = request.headers.get("host") or request.url.netloc
    return f"{request.url.scheme}://{host}/api/integrations/whatsapp/webhook"


def _webhook_urls(request: Request) -> dict:
    base = config.public_base_url()
    if base:
        return {
            "webhook_url": f"{base}/api/integrations/whatsapp/webhook",
            "webhook_url_configured": True,
            "local_backend_url": _local_backend_url(request),
        }
    return {
        "webhook_url": "",
        "webhook_url_configured": False,
        "local_backend_url": _local_backend_url(request),
    }


def _recent(iso_timestamp: str) -> bool:
    if not iso_timestamp:
        return False
    try:
        when = datetime.fromisoformat(iso_timestamp)
    except ValueError:
        return False
    return (datetime.now(timezone.utc) - when).total_seconds() < WEBHOOK_RECENCY_HOURS * 3600


def _engineer_counts(session) -> dict:
    rows = session.scalars(select(User).where(User.account_type == "site_portal")).all()
    with_phone = sum(1 for row in rows if row.phone_e164)
    return {"with_phone": with_phone, "total": len(rows)}


def _settings_payload(session, request: Request) -> dict:
    row = settings_service.get_or_create_settings(session)
    capability = config.capability()
    webhook_ready = _recent(row.last_webhook_verified_at) or _recent(row.last_webhook_event_at)

    if not capability["available"]:
        display_status = "not_configured"
    elif not row.enabled:
        display_status = "disabled"
    elif row.connection_status == "connected":
        display_status = "connected"
    elif row.connection_status == "error":
        display_status = "error"
    else:
        display_status = "not_configured"

    urls = _webhook_urls(request)
    return {
        "enabled": row.enabled,
        "setup_categories": [
            {"key": "meta_credentials", "label_ar": "بيانات اعتماد Meta", "ready": capability["available"]},
            {
                "key": "public_webhook", "label_ar": "الاتصال بالويب هوك العام",
                "ready": urls["webhook_url_configured"] and webhook_ready,
            },
        ],
        "connection_status": display_status,
        "connection_error": row.connection_error if display_status == "error" else "",
        "last_checked_at": row.last_checked_at,
        "business_number": row.business_number,
        "business_name": row.business_name,
        "webhook_status": "connected" if webhook_ready else "waiting",
        "engineers": _engineer_counts(session),
        **urls,
    }


@router.get("/settings")
def get_settings(request: Request, _admin: User = Depends(require_erp_role("admin"))) -> dict:
    with SessionLocal() as session:
        return _settings_payload(session, request)


@router.put("/settings")
def update_settings(
    body: EnabledUpdate, request: Request, admin: User = Depends(require_erp_role("admin")),
) -> dict:
    with SessionLocal() as session:
        settings_service.set_enabled(session, body.enabled, actor=admin.username)
        return _settings_payload(session, request)


@router.post("/settings/test-connection")
def test_connection(request: Request, _admin: User = Depends(require_erp_role("admin"))) -> dict:
    capability = config.capability()
    with SessionLocal() as session:
        if not capability["available"]:
            settings_service.record_connection_result(session, status="unknown")
            return _settings_payload(session, request)
        try:
            provider = MetaWhatsAppProvider(config.phone_number_id(), config.access_token())
            info = provider.get_phone_number_info()
        except Exception:
            settings_service.record_connection_result(session, status="error", error=CONNECTION_ERROR_TEXT)
            return _settings_payload(session, request)
        settings_service.record_connection_result(
            session, status="connected",
            business_number=info.get("display_phone_number", ""),
            business_name=info.get("verified_name", ""),
        )
        return _settings_payload(session, request)
