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
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse
from sqlalchemy.exc import IntegrityError

try:
    from ..database import SessionLocal
    from . import config, security, settings_service
    from .models import WhatsAppProcessedMessage
    from .phone import normalize_e164
    from .session_service import UNKNOWN_PHONE_TEXT, handle_inbound, resolve_engineer
except ImportError:  # pragma: no cover - direct backend execution
    from database import SessionLocal
    from whatsapp import config, security, settings_service
    from whatsapp.models import WhatsAppProcessedMessage
    from whatsapp.phone import normalize_e164
    from whatsapp.session_service import UNKNOWN_PHONE_TEXT, handle_inbound, resolve_engineer

logger = logging.getLogger("whatsapp.router")

router = APIRouter(prefix="/api/integrations/whatsapp", tags=["whatsapp"])

NON_TEXT_MESSAGE_TEXT = (
    "حاليًا لا يمكن استقبال الصور أو الملفات عبر واتساب. "
    "برجاء إرسال تفاصيل الطلب كنص."
)
PAUSED_TEXT = "خدمة طلبات الشراء عبر واتساب متوقفة مؤقتًا."


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/webhook")
def verify_webhook(request: Request):
    """Meta's one-time (and any re-)subscription check. Deliberately NOT
    gated on the Admin enabled/disabled toggle — that switch only affects
    whether an inbound message drafts/creates a request (see
    receive_webhook below), never whether the subscription itself stays
    healthy. An unrecognized token still gets 403, same as before."""
    mode = request.query_params.get("hub.mode", "")
    token = request.query_params.get("hub.verify_token", "")
    challenge = request.query_params.get("hub.challenge", "")
    if not security.verify_subscription(mode, token, config.verify_token()):
        raise HTTPException(403, "Verification failed")
    with SessionLocal() as session:
        settings_service.touch_webhook_verified(session)
    return PlainTextResponse(challenge)


def _handle_message(session, service_enabled: bool, message: dict) -> tuple[str, str] | None:
    """DB-only: decides the reply and records the message as processed, but
    does not send it. The actual outbound Graph API call is a blocking
    httpx.post (see providers/meta.py) with up to a 15s timeout; running it
    here, inline in this async route, would stall the whole single-worker
    event loop - and therefore every other concurrent ProcureX request -
    for up to 15s per inbound WhatsApp message (see performance audit,
    docs/performance-reliability-audit.md). The caller sends it via
    run_in_threadpool instead."""
    message_id = message.get("id", "")
    if not message_id:
        return None
    if session.get(WhatsAppProcessedMessage, message_id) is not None:
        return None  # Meta redelivered a message we already acted on.
    # Claim the message id BEFORE any side effect. handle_inbound commits
    # part-way (e.g. the new REQ), so recording the id afterwards let two
    # concurrent deliveries of one message both create a REQ (measured on
    # PostgreSQL: 8 concurrent deliveries -> 2-3 REQs). A second worker's
    # insert now waits on the primary key until this transaction commits,
    # then fails here and skips the message - no reply, no second REQ.
    session.add(WhatsAppProcessedMessage(message_id=message_id, processed_at=_now()))
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        return None

    message_type = message.get("type", "")
    from_number = message.get("from", "")
    phone = normalize_e164(from_number)

    if not service_enabled:
        reply = PAUSED_TEXT
    else:
        user = resolve_engineer(session, phone) if phone else None
        if user is None:
            reply = UNKNOWN_PHONE_TEXT
        elif message_type != "text":
            reply = NON_TEXT_MESSAGE_TEXT
        else:
            text = (message.get("text") or {}).get("body", "")
            reply = handle_inbound(session, user, phone, text)

    session.commit()

    return (phone, reply) if phone else None


@router.post("/webhook")
async def receive_webhook(request: Request):
    """Always reachable when the signature checks out — including while the
    Admin has WhatsApp Requests turned off (spec: Meta verification must
    keep working, and a disabled service must reply safely, not disappear).
    Disabled only skips drafting/REQ creation, per _handle_message above."""
    raw_body = await request.body()
    signature = request.headers.get("x-hub-signature-256", "")
    if not security.verify_signature(raw_body, signature, config.app_secret()):
        raise HTTPException(403, "Invalid signature")

    try:
        payload = json.loads(raw_body)
    except ValueError:
        raise HTTPException(400, "Invalid payload")

    messages = [
        message
        for entry in payload.get("entry", [])
        for change in entry.get("changes", [])
        for message in (change.get("value") or {}).get("messages", [])
    ]
    if messages:
        provider = config.build_provider()
        with SessionLocal() as session:
            settings_service.touch_webhook_event(session)
            service_enabled = settings_service.is_enabled(session)
            replies = [
                result
                for message in messages
                if (result := _handle_message(session, service_enabled, message)) is not None
            ]
        # Sent after the DB session closes, off the event loop thread - a
        # slow/hanging Meta API call must not hold this SQLAlchemy session
        # open, and must not block other requests (see _handle_message).
        for phone, reply in replies:
            try:
                await run_in_threadpool(provider.send_text, phone, reply)
            except Exception:
                logger.exception("Failed to send WhatsApp reply")

    return {"status": "received"}
