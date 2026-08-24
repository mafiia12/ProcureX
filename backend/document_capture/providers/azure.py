"""Azure Document Intelligence OCR/layout adapter."""

from __future__ import annotations

import os
import time
from statistics import mean
from typing import Sequence

import httpx

from ..domain import (
    DocumentFileInput,
    DocumentProcessingConfigurationError,
    DocumentProcessingError,
    OCRResult,
)


class AzureDocumentIntelligenceOCR:
    name = "azure_document_intelligence"

    def __init__(self) -> None:
        self.endpoint = (
            os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "").strip().rstrip("/")
        )
        self.key = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY", "").strip()
        self.api_version = os.getenv(
            "AZURE_DOCUMENT_INTELLIGENCE_API_VERSION", "2024-11-30"
        ).strip()
        self.model = os.getenv(
            "AZURE_DOCUMENT_INTELLIGENCE_MODEL", "prebuilt-layout"
        ).strip()
        self.timeout = float(os.getenv("DOCUMENT_PROVIDER_TIMEOUT_SECONDS", "120"))
        if not self.endpoint or not self.key:
            raise DocumentProcessingConfigurationError(
                "Azure Document Intelligence endpoint/key are required"
            )

    def _analyze_one(self, file: DocumentFileInput) -> dict:
        url = (
            f"{self.endpoint}/documentintelligence/documentModels/{self.model}:analyze"
            f"?api-version={self.api_version}"
        )
        headers = {
            "Ocp-Apim-Subscription-Key": self.key,
            "Content-Type": file.media_type,
        }
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(url, headers=headers, content=file.content)
            if response.status_code not in {200, 202}:
                raise DocumentProcessingError(
                    f"Azure analysis request failed with status {response.status_code}"
                )
            if response.status_code == 200:
                return response.json()
            operation_url = response.headers.get("operation-location", "")
            if not operation_url:
                raise DocumentProcessingError(
                    "Azure did not return an operation location"
                )
            deadline = time.monotonic() + self.timeout
            while time.monotonic() < deadline:
                poll = client.get(
                    operation_url,
                    headers={"Ocp-Apim-Subscription-Key": self.key},
                )
                poll.raise_for_status()
                payload = poll.json()
                status = payload.get("status", "").lower()
                if status == "succeeded":
                    return payload
                if status in {"failed", "cancelled"}:
                    raise DocumentProcessingError(
                        f"Azure document analysis ended with status {status}"
                    )
                time.sleep(0.75)
        raise DocumentProcessingError("Azure document analysis timed out")

    def extract(self, files: Sequence[DocumentFileInput]) -> OCRResult:
        texts: list[str] = []
        confidences: list[float] = []
        pages = 0
        provider_files = []
        for file in files:
            payload = self._analyze_one(file)
            result = payload.get("analyzeResult") or payload
            texts.append(str(result.get("content") or "").strip())
            result_pages = result.get("pages") or []
            pages += len(result_pages) or 1
            for page in result_pages:
                for word in page.get("words") or []:
                    confidence = word.get("confidence")
                    if isinstance(confidence, (int, float)):
                        confidences.append(float(confidence))
            provider_files.append(
                {
                    "filename": file.filename,
                    "page_count": len(result_pages) or 1,
                    "styles": result.get("styles") or [],
                }
            )
        return OCRResult(
            raw_text="\n\n".join(text for text in texts if text),
            confidence=round(mean(confidences), 4) if confidences else None,
            page_count=pages,
            provider_data={"files": provider_files},
        )
