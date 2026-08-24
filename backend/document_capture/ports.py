"""Replaceable provider ports for OCR and structured extraction."""

from __future__ import annotations

from typing import Protocol, Sequence

from .domain import DocumentFileInput, ExtractedLineItem, OCRResult


class OCRProvider(Protocol):
    name: str

    def extract(self, files: Sequence[DocumentFileInput]) -> OCRResult:
        """Extract text/layout from one PDF or an ordered image collection."""


class StructuredExtractionProvider(Protocol):
    name: str

    def extract_items(
        self,
        raw_text: str,
        document_type: str,
    ) -> tuple[list[ExtractedLineItem], dict]:
        """Convert OCR text into the provider-neutral line-item structure."""
