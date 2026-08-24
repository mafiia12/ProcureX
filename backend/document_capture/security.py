"""Strict, provider-independent upload validation for document capture."""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .domain import DocumentFileInput


MAX_FILE_BYTES = min(
    int(os.getenv("DOCUMENT_MAX_FILE_BYTES", str(10 * 1024 * 1024))), 20 * 1024 * 1024
)
MAX_TOTAL_BYTES = min(
    int(os.getenv("DOCUMENT_MAX_TOTAL_BYTES", str(30 * 1024 * 1024))), 60 * 1024 * 1024
)
MAX_FILES = min(int(os.getenv("DOCUMENT_MAX_FILES", "10")), 20)


def detect_media_type(content: bytes) -> tuple[str, str] | None:
    if content.startswith(b"%PDF-") and b"%%EOF" in content[-2048:]:
        return "application/pdf", ".pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n") and b"IEND" in content[-64:]:
        return "image/png", ".png"
    if content.startswith(b"\xff\xd8\xff") and content.rstrip().endswith(b"\xff\xd9"):
        return "image/jpeg", ".jpg"
    if len(content) >= 16 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


def safe_filename(value: str, extension: str) -> str:
    name = Path(value or f"document{extension}").name[:200]
    name = re.sub(r"[\x00-\x1f<>:\"/\\|?*]", "_", name).strip(" .")
    return name or f"document{extension}"


async def validate_document_uploads(files: list[UploadFile]) -> list[DocumentFileInput]:
    if not files:
        raise HTTPException(422, "At least one document file is required")
    if len(files) > MAX_FILES:
        raise HTTPException(413, f"No more than {MAX_FILES} files are allowed")
    prepared: list[DocumentFileInput] = []
    total = 0
    for upload in files:
        content = await upload.read(MAX_FILE_BYTES + 1)
        if not content:
            raise HTTPException(422, "Empty files are not allowed")
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(
                413, "A document file exceeds the configured size limit"
            )
        detected = detect_media_type(content)
        if not detected:
            raise HTTPException(
                422, "Only valid PDF, JPG, PNG, and WebP documents are allowed"
            )
        media_type, extension = detected
        total += len(content)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(
                413, "The combined document size exceeds the configured limit"
            )
        prepared.append(
            DocumentFileInput(
                filename=safe_filename(upload.filename or "", extension),
                media_type=media_type,
                content=content,
            )
        )
    return prepared
