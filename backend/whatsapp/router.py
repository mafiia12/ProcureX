"""WhatsApp Cloud API webhook: the only HTTP surface this module adds.

Deliberately not a new ProcureX page — this is a public, unauthenticated
webhook endpoint (Meta cannot log in), protected instead by the GET
verify-token challenge and the POST X-Hub-Signature-256 check. Every inbound
message either results in a normal Incoming Purchase Request (via
site_portal.create_incoming_request, through session_service) or a rejection
reply; nothing here bypasses any existing validation or workflow step.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

try:
    from ..database import SessionLocal
    from . import config, security
    from .models import WhatsAppProcessedMessage
    from .phone import normalize_e164
    from .session_service import UNKNOWN_PHONE_TEXT, handle_inbound, resolve_engineer
except ImportError:  # pragma: no cover - direct backend execution
    from database import SessionLocal
    from whatsapp import config, security
    from whatsapp.models import WhatsAppProcessedMessage
    from whatsapp.phone import normalize_e164
    from whatsapp.session_service import UNKNOWN_PHONE_TEXT, handle_inbound, resolve_engineer

logger = logging.getLogger("whatsapp.router")

router = APIRouter(prefix="/api/integrations/whatsapp", tags=["whatsapp"])

NON_TEXT_MESSAGE_TEXT = (
    "حاليًا لا يمكن استقبال الصور أو الملفات عبر واتساب. "
    "برجاء إرسال تفاصيل الطلب كنص."
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_enabled() -> None:
    if not config.enabled():
        raise HTTPException(404, "WhatsApp intake is not enabled")


@router.get("/webhook")
def verify_webhook(request: Request):
    _require_enabled()
    mode = request.query_params.get("hub.mode", "")
    token = request.query_params.get("hub.verify_token", "")
    challenge = request.query_params.get("hub.challenge", "")
    if not security.verify_subscription(mode, token, config.verify_token()):
        raise HTTPException(403, "Verification failed")
    return PlainTextResponse(challenge)


def _handle_message(provider, message: dict) -> None:
    message_id = message.get("id", "")
    if not message_id:
        return
    message_type = message.get("type", "")
    from_number = message.get("from", "")
    phone = normalize_e164(from_number)

    with SessionLocal() as session:
        if session.get(WhatsAppProcessedMessage, message_id) is not None:
            return  # Meta redelivered a message we already acted on.

        user = resolve_engineer(session, phone) if phone else None
        if user is None:
            reply = UNKNOWN_PHONE_TEXT
        elif message_type != "text":
            reply = NON_TEXT_MESSAGE_TEXT
        else:
            text = (message.get("text") or {}).get("body", "")
            reply = handle_inbound(session, user, phone, text)

        session.add(WhatsAppProcessedMessage(message_id=message_id, processed_at=_now()))
        session.commit()

    if not phone:
        return
    try:
        provider.send_text(phone, reply)
    except Exception:
        logger.exception("Failed to send WhatsApp reply")


@router.post("/webhook")
async def receive_webhook(request: Request):
    _require_enabled()
    raw_body = await request.body()
    signature = request.headers.get("x-hub-signature-256", "")
    if not security.verify_signature(raw_body, signature, config.app_secret()):
        raise HTTPException(403, "Invalid signature")

    try:
        payload = json.loads(raw_body)
    except ValueError:
        raise HTTPException(400, "Invalid payload")

    provider = config.build_provider()
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            for message in (change.get("value") or {}).get("messages", []):
                _handle_message(provider, message)

    return {"status": "received"}
