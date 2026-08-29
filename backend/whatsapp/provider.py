"""Replaceable provider port for sending outbound WhatsApp messages."""

from __future__ import annotations

from typing import Protocol


class WhatsAppProvider(Protocol):
    name: str

    def send_text(self, to_e164: str, body: str) -> str:
        """Send a plain-text message; return the provider's message id."""
