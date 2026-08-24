"""Safe adapters used when document extraction is disabled or unconfigured."""

from __future__ import annotations

from ..domain import DocumentProcessingConfigurationError


class DisabledOCRProvider:
    name = "disabled"

    def extract(self, _files):
        raise DocumentProcessingConfigurationError(
            "Azure Document Intelligence is not configured"
        )


class DisabledStructuredExtractionProvider:
    name = "disabled"

    def extract_items(self, _raw_text, _document_type):
        raise DocumentProcessingConfigurationError(
            "OpenAI structured extraction is not configured"
        )
