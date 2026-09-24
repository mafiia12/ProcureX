"""Restart-safe persistent document job worker."""

from __future__ import annotations

import os
import socket
import threading
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

try:
    from ..database import SessionLocal
except ImportError:  # pragma: no cover
    from database import SessionLocal

from .config import extraction_enabled
from .domain import DocumentProcessingConfigurationError, DocumentProcessingError
from .models import DocumentProcessingJob, PurchaseRequestDocument, RequestAuditEvent
from .service import now_iso, process_document

_stop = threading.Event()
_thread: threading.Thread | None = None
_worker_id = f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"


def _claim() -> str | None:
    now = now_iso()
    stale = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    with SessionLocal() as session:
        # One conditional UPDATE, not read-then-write: PostgreSQL re-checks
        # the WHERE against the committed row, so a job another worker has
        # just re-claimed (fresh locked_at) is left alone. Loading the stale
        # rows and assigning fields let a second worker's reset overwrite the
        # first worker's new claim (measured: 2-3 of 60 recovered jobs were
        # processed twice per run).
        session.execute(
            update(DocumentProcessingJob)
            .where(
                DocumentProcessingJob.status == "processing",
                DocumentProcessingJob.locked_at < stale,
            )
            .values(status="queued", locked_at="", locked_by="")
            .execution_options(synchronize_session=False)
        )
        job = session.scalars(
            select(DocumentProcessingJob)
            .where(
                DocumentProcessingJob.status == "queued",
                DocumentProcessingJob.available_at <= now,
            )
            .order_by(DocumentProcessingJob.created_at)
            .limit(1)
            # Every web worker process runs its own copy of this loop. Without
            # the row lock, two workers read the same queued job and both
            # processed it (measured on PostgreSQL: 60 jobs -> 219 claims).
            # SKIP LOCKED hands each worker a different job instead of making
            # it wait. Ignored on SQLite (single desktop process).
            .with_for_update(skip_locked=True)
        ).first()
        if not job:
            session.commit()
            return None
        job.status = "processing"
        job.attempts += 1
        job.locked_at = now
        job.locked_by = _worker_id
        job.updated_at = now
        document_id = job.document_id
        session.commit()
        return document_id


def _finish(document_id: str, error: Exception | None = None) -> None:
    with SessionLocal() as session:
        job = session.scalars(
            select(DocumentProcessingJob)
            .where(
                DocumentProcessingJob.document_id == document_id,
                DocumentProcessingJob.status == "processing",
                DocumentProcessingJob.locked_by == _worker_id,
            )
            .order_by(DocumentProcessingJob.created_at.desc())
        ).first()
        document = session.get(PurchaseRequestDocument, document_id)
        if not job:
            return
        timestamp = now_iso()
        if error is None:
            job.status = "completed"
        else:
            code = getattr(error, "code", "document_processing_failed")
            safe_message = str(error)[:500]
            retryable = not isinstance(error, DocumentProcessingConfigurationError)
            if retryable and job.attempts < job.max_attempts:
                job.status = "queued"
                job.available_at = (
                    datetime.now(timezone.utc)
                    + timedelta(seconds=min(300, 5 * 2**job.attempts))
                ).isoformat()
                if document:
                    document.status = "uploaded"
            else:
                job.status = "failed"
                if document:
                    document.status = "failed"
            job.last_error_code = code
            job.last_error_message = safe_message
            if document:
                document.failure_code = code
                document.failure_message = safe_message
                document.updated_at = timestamp
                session.add(
                    RequestAuditEvent(
                        id=str(uuid.uuid4()),
                        request_id=document.request_id,
                        document_id=document.id,
                        event_type="document_processing_failed",
                        actor="system",
                        details={"code": code, "attempt": job.attempts},
                        created_at=timestamp,
                    )
                )
        job.locked_at = ""
        job.locked_by = ""
        job.updated_at = timestamp
        session.commit()


def run_once() -> bool:
    document_id = _claim()
    if not document_id:
        return False
    try:
        process_document(document_id)
    except (DocumentProcessingError, Exception) as exc:  # sanitized before persistence
        _finish(document_id, exc)
    else:
        _finish(document_id)
    return True


def _loop() -> None:
    interval = max(0.25, float(os.getenv("DOCUMENT_WORKER_POLL_SECONDS", "2")))
    while not _stop.is_set():
        if not run_once():
            _stop.wait(interval)


def start_document_worker() -> None:
    global _thread
    if not extraction_enabled() or (_thread and _thread.is_alive()):
        return
    _stop.clear()
    _thread = threading.Thread(
        target=_loop, name="document-extraction-worker", daemon=True
    )
    _thread.start()


def stop_document_worker() -> None:
    _stop.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=5)
