"""OpenAI Structured Outputs adapter for OCR text normalization."""

from __future__ import annotations

import json
import os

import httpx

from ..domain import (
    DocumentProcessingConfigurationError,
    DocumentProcessingError,
    ExtractedLineItem,
)


LINE_ITEM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["items"],
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "raw_line_text",
                    "product_name",
                    "brand",
                    "specification",
                    "size",
                    "quantity",
                    "unit",
                    "notes",
                    "extraction_confidence",
                ],
                "properties": {
                    "raw_line_text": {"type": "string"},
                    "product_name": {"type": "string"},
                    "brand": {"type": "string"},
                    "specification": {"type": "string"},
                    "size": {"type": "string"},
                    "quantity": {"type": ["number", "null"]},
                    "unit": {"type": "string"},
                    "notes": {"type": "string"},
                    "extraction_confidence": {
                        "type": ["number", "null"],
                        "minimum": 0,
                        "maximum": 1,
                    },
                },
            },
        },
    },
}


class OpenAIStructuredExtraction:
    name = "openai_structured_outputs"

    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.model = os.getenv("OPENAI_DOCUMENT_EXTRACTION_MODEL", "").strip()
        self.base_url = os.getenv(
            "OPENAI_API_BASE_URL", "https://api.openai.com/v1"
        ).rstrip("/")
        self.timeout = float(os.getenv("DOCUMENT_PROVIDER_TIMEOUT_SECONDS", "120"))
        if not self.api_key or not self.model:
            raise DocumentProcessingConfigurationError(
                "OpenAI API key and document extraction model are required"
            )

    @staticmethod
    def _output_text(payload: dict) -> str:
        for output in payload.get("output") or []:
            for content in output.get("content") or []:
                if content.get("type") == "output_text" and content.get("text"):
                    return content["text"]
        raise DocumentProcessingError(
            "OpenAI response did not contain structured output"
        )

    def extract_items(self, raw_text: str, document_type: str):
        instructions = (
            "Extract purchase-request line items from OCR text. Preserve Arabic and English "
            "product wording. Do not invent quantities, units, brands, or specifications. "
            "Use null/empty values when absent. Return one object per actual requested item."
        )
        body = {
            "model": self.model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": f"Document type: {document_type}\n\nOCR text:\n{raw_text}",
                        }
                    ],
                }
            ],
            "instructions": instructions,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "purchase_request_items",
                    "strict": True,
                    "schema": LINE_ITEM_SCHEMA,
                },
            },
        }
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(
                f"{self.base_url}/responses",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        if response.status_code >= 400:
            raise DocumentProcessingError(
                f"OpenAI extraction failed with status {response.status_code}"
            )
        payload = response.json()
        try:
            structured = json.loads(self._output_text(payload))
        except (TypeError, ValueError) as exc:
            raise DocumentProcessingError(
                "OpenAI returned invalid structured output"
            ) from exc
        items = []
        for row in structured.get("items") or []:
            items.append(
                ExtractedLineItem(
                    raw_line_text=str(row.get("raw_line_text") or "").strip(),
                    product_name=str(row.get("product_name") or "").strip(),
                    brand=str(row.get("brand") or "").strip(),
                    specification=str(row.get("specification") or "").strip(),
                    size=str(row.get("size") or "").strip(),
                    quantity=row.get("quantity"),
                    unit=str(row.get("unit") or "").strip(),
                    notes=str(row.get("notes") or "").strip(),
                    extraction_confidence=row.get("extraction_confidence"),
                )
            )
        return items, {
            "response_id": payload.get("id", ""),
            "model": payload.get("model", self.model),
        }
