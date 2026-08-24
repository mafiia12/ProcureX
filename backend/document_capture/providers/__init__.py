"""Document extraction provider adapters."""

from .azure import AzureDocumentIntelligenceOCR
from .disabled import DisabledOCRProvider, DisabledStructuredExtractionProvider
from .openai import OpenAIStructuredExtraction

__all__ = [
    "AzureDocumentIntelligenceOCR",
    "DisabledOCRProvider",
    "DisabledStructuredExtractionProvider",
    "OpenAIStructuredExtraction",
]
