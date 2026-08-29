"""Meta WhatsApp Business Cloud API outbound adapter."""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("whatsapp.provider.meta")

GRAPH_API_VERSION = "v20.0"
REQUEST_TIMEOUT_SECONDS = 15


class MetaWhatsAppProvider:
    name = "meta"

    def __init__(self, phone_number_id: str, access_token: str) -> None:
        self._phone_number_id = phone_number_id
        self._access_token = access_token

    def send_text(self, to_e164: str, body: str) -> str:
        url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{self._phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "to": to_e164.lstrip("+"),
            "type": "text",
            "text": {"body": body, "preview_url": False},
        }
        # Never log the access token; only the recipient/id on failure.
        response = httpx.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {self._access_token}"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        if response.status_code >= 400:
            logger.error("WhatsApp send failed (status=%s) to=%s", response.status_code, to_e164)
            response.raise_for_status()
        data = response.json()
        messages = data.get("messages") or [{}]
        return messages[0].get("id", "")

    def get_phone_number_info(self) -> dict:
        """The lightest read-only Graph call available: fetch the configured
        phone number's own metadata. Used only for "Test Connection" — never
        sends a message, never touches a conversation."""
        url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{self._phone_number_id}"
        response = httpx.get(
            url,
            params={"fields": "display_phone_number,verified_name"},
            headers={"Authorization": f"Bearer {self._access_token}"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
        return {
            "display_phone_number": data.get("display_phone_number", ""),
            "verified_name": data.get("verified_name", ""),
        }
