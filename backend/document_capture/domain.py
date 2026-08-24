"""Provider-neutral document extraction value objects."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


DOCUMENT_TYPES = {
    "handwritten_request",
    "printed_request",
    "supplier_quotation",
    "supplier_invoice",
    "supply_order",
}
EXTRACTABLE_DOCUMENT_TYPES = {"handwritten_request", "printed_request"}
DOCUMENT_STATUSES = {
    "uploaded",
    "processing",
    "review_required",
    "confirmed",
    "failed",
    "cancelled",
}
MATCH_STATES = {"high_confidence", "suggested", "no_match", "ambiguous"}


@dataclass(frozen=True)
class DocumentFileInput:
    filename: str
    media_type: str
    content: bytes


@dataclass(frozen=True)
class OCRResult:
    raw_text: str
    confidence: float | None = None
    page_count: int = 1
    provider_data: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ExtractedLineItem:
    raw_line_text: str = ""
    product_name: str = ""
    brand: str = ""
    specification: str = ""
    size: str = ""
    quantity: float | None = None
    unit: str = ""
    notes: str = ""
    extraction_confidence: float | None = None


class DocumentProcessingError(RuntimeError):
    code = "document_processing_failed"


class DocumentProcessingConfigurationError(DocumentProcessingError):
    code = "document_processing_not_configured"


class DocumentProcessingCancelled(DocumentProcessingError):
    code = "document_processing_cancelled"
