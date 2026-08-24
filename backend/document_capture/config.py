"""Configuration and replaceable provider composition."""

from __future__ import annotations

import os

from .domain import DocumentProcessingConfigurationError
from .providers.azure import AzureDocumentIntelligenceOCR
from .providers.openai import OpenAIStructuredExtraction


def extraction_enabled() -> bool:
    return os.getenv("DOCUMENT_EXTRACTION_ENABLED", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def capability() -> dict:
    missing = []
    if not os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "").strip():
        missing.append("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
    if not os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY", "").strip():
        missing.append("AZURE_DOCUMENT_INTELLIGENCE_KEY")
    if not os.getenv("OPENAI_API_KEY", "").strip():
        missing.append("OPENAI_API_KEY")
    if not os.getenv("OPENAI_DOCUMENT_EXTRACTION_MODEL", "").strip():
        missing.append("OPENAI_DOCUMENT_EXTRACTION_MODEL")
    enabled = extraction_enabled()
    available = enabled and not missing
    return {
        "enabled": enabled,
        "available": available,
        "status": (
            "available"
            if available
            else ("configuration_required" if enabled else "disabled")
        ),
        "missing": missing if enabled else [],
        "manual_entry_available": True,
        "accepted_types": ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    }


def build_providers():
    state = capability()
    if not state["available"]:
        raise DocumentProcessingConfigurationError(state["status"])
    return AzureDocumentIntelligenceOCR(), OpenAIStructuredExtraction()
