"""Safe adapter used when WhatsApp is disabled or not fully configured.

Inbound webhook processing (parsing, draft state, REQ creation) still runs
normally — only the outbound reply is skipped, so local development and
tests never depend on real Meta credentials.
"""

from __future__ import annotations

import logging
import uuid

logger = logging.getLogger("whatsapp.provider.disabled")


class DisabledWhatsAppProvider:
    name = "disabled"

    def send_text(self, to_e164: str, body: str) -> str:
        logger.info("WhatsApp provider disabled; not sending to %s", to_e164)
        return f"disabled-{uuid.uuid4().hex}"
