"""Persistence for WhatsApp intake: nothing here is a purchase request.

These two tables exist only to (1) hold a conversation's in-progress draft
until the Site Engineer confirms it, and (2) guarantee a given Meta webhook
message is only ever acted on once. The moment a draft is confirmed, the
*real* record is created via incoming_requests.IncomingPurchaseRequest
through site_portal.create_incoming_request — these tables never duplicate
that data, they only reference it (confirmed_request_id/number).
"""

from __future__ import annotations

from sqlalchemy import JSON, Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

try:
    from ..database import Base
except ImportError:  # pragma: no cover - direct backend execution
    from database import Base


DRAFT_STATUSES = {
    "collecting",
    "awaiting_project_choice",
    "awaiting_item_info",
    "awaiting_delivery_date",
    "confirmed",
    "cancelled",
}


class WhatsAppProcessedMessage(Base):
    """One row per handled inbound Meta message id. Existence alone means
    "already processed" — the webhook handler checks this before doing
    anything else, in the same commit as whatever effect the message had."""

    __tablename__ = "whatsapp_processed_messages"
    message_id: Mapped[str] = mapped_column(String, primary_key=True)
    processed_at: Mapped[str] = mapped_column(String)


class WhatsAppDraft(Base):
    """One in-progress (or just-confirmed) purchase-request conversation for
    a phone number. items_json holds the parsed line items, including ones
    still missing quantity/unit; candidate_projects_json holds the numbered
    choices offered to the engineer when the project name is ambiguous."""

    __tablename__ = "whatsapp_drafts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    phone_e164: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, default="collecting", server_default="collecting")
    user_id: Mapped[str] = mapped_column(String, default="", server_default="")
    project_id: Mapped[str] = mapped_column(String, default="", server_default="")
    project_name: Mapped[str] = mapped_column(String, default="", server_default="")
    candidate_projects_json: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    items_json: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    pending_item_index: Mapped[int] = mapped_column(Integer, default=-1, server_default="-1")
    required_delivery_date: Mapped[str] = mapped_column(String, default="", server_default="")
    confirmed_request_id: Mapped[str] = mapped_column(String, default="", server_default="")
    confirmed_request_number: Mapped[str] = mapped_column(String, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)
    expires_at: Mapped[str] = mapped_column(String)


WHATSAPP_SETTINGS_ID = "whatsapp"


class WhatsAppSettings(Base):
    """Singleton row (fixed id "whatsapp") holding the Admin-controlled
    on/off switch and the last-known Meta connection/webhook state.

    Never holds secrets — access_token/app_secret/verify_token stay in the
    environment (see config.py) and are never written here. business_number/
    business_name are display-only values fetched from Meta on a successful
    Test Connection, not admin-editable text."""

    __tablename__ = "whatsapp_settings"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    business_number: Mapped[str] = mapped_column(String, default="", server_default="")
    business_name: Mapped[str] = mapped_column(String, default="", server_default="")
    connection_status: Mapped[str] = mapped_column(String, default="unknown", server_default="unknown")
    connection_error: Mapped[str] = mapped_column(String, default="", server_default="")
    last_checked_at: Mapped[str] = mapped_column(String, default="", server_default="")
    last_webhook_verified_at: Mapped[str] = mapped_column(String, default="", server_default="")
    last_webhook_event_at: Mapped[str] = mapped_column(String, default="", server_default="")
    updated_by: Mapped[str] = mapped_column(String, default="", server_default="")
    updated_at: Mapped[str] = mapped_column(String, default="", server_default="")
