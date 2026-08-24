"""Purge expired document binaries while retaining append-only audit metadata."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from attachment_storage import get_attachment_storage
from database import SessionLocal
from document_capture.models import DocumentFile, PurchaseRequestDocument
from document_capture.service import audit, now_iso


def purge_expired() -> int:
    storage = get_attachment_storage()
    deleted = 0
    cutoff = datetime.now(timezone.utc).isoformat()
    with SessionLocal() as session:
        documents = session.scalars(
            select(PurchaseRequestDocument).where(
                PurchaseRequestDocument.retention_expires_at != "",
                PurchaseRequestDocument.retention_expires_at <= cutoff,
            )
        ).all()
        for document in documents:
            files = session.scalars(
                select(DocumentFile).where(DocumentFile.document_id == document.id)
            ).all()
            for file in files:
                storage.delete(file.stored_filename)
                session.delete(file)
                deleted += 1
            document.raw_text = ""
            document.provider_metadata = {"purged_at": now_iso()}
            audit(
                session,
                document.request_id,
                "document_content_purged",
                document_id=document.id,
                actor="retention-job",
                details={"files": len(files)},
            )
        session.commit()
    return deleted


if __name__ == "__main__":
    print(purge_expired())
