"""Focused tests for the S3/R2 attachment-storage blocking-I/O fix (see
backend/attachment_storage.py, backend/incoming_requests.py,
docs/performance-reliability-audit.md, "S3/R2 Attachment Storage").

Self-contained: runs standalone against its own temp SQLite DB, and also
runs as part of the full suite (same pattern as auth_rate_limit_test.py /
whatsapp_intake_test.py). Uses a monkeypatched LocalAttachmentStorage
(never real S3/R2 credentials or network calls) to stand in for slow
storage I/O - what matters for these tests is that storage.put/get take
measurable time, not where that time comes from.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from unittest.mock import Mock

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_STANDALONE = "database" not in sys.modules
if _STANDALONE:
    _TEST_DIR = tempfile.TemporaryDirectory(prefix="procurex-attachment-offload-tests-")
    _TEST_DB = Path(_TEST_DIR.name) / "attachment-offload-test.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
    os.environ.setdefault("INTERNAL_REQUEST_TOKEN", "test-internal-token")
    os.environ.setdefault("PUBLIC_REQUEST_RATE_LIMIT", "1000")
    os.environ.setdefault("INCOMING_REQUEST_UPLOAD_DIR", str(Path(_TEST_DIR.name) / "uploads"))
    os.environ.setdefault("PROCUREX_BACKUP_DIR", str(Path(_TEST_DIR.name) / "backups"))
    os.environ.setdefault("PROCUREX_LOG_DIR", str(Path(_TEST_DIR.name) / "logs"))

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session as SqlAlchemySession  # noqa: E402

import attachment_storage  # noqa: E402
from database import SessionLocal, init_db  # noqa: E402
from server import app  # noqa: E402
import incoming_requests as incoming_requests_module  # noqa: E402
from auth.models import User  # noqa: E402
from auth.security import hash_password  # noqa: E402

if _STANDALONE:
    init_db()

client = TestClient(app)
INTERNAL_HEADERS = {"X-Internal-Token": "test-internal-token"}


def _admin_headers() -> dict:
    username = f"attachment-offload-admin-{uuid.uuid4().hex[:8]}"
    password = "AttachmentOffload1!"
    now = datetime.now(timezone.utc).isoformat()
    with SessionLocal() as session:
        session.add(User(
            id=str(uuid.uuid4()), username=username, display_name=username,
            password_hash=hash_password(password), account_type="erp",
            role="admin", active=True, created_at=now, updated_at=now,
        ))
        session.commit()
    login = client.post("/api/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


ADMIN_HEADERS = _admin_headers()
AUTH_HEADERS = {**INTERNAL_HEADERS, **ADMIN_HEADERS}


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    incoming_requests_module._rate_limiter.clear()
    yield
    incoming_requests_module._rate_limiter.clear()


def _public_payload(unique: str) -> dict:
    return {
        "requester_name": f"Attachment Offload Tester {unique[:8]}",
        "company_name": "Test Co",
        "phone_number": "01000000000",
        "project_name": "Attachment Offload Project",
        "project_location": "Cairo",
        "delivery_location": "Warehouse",
        "required_delivery_date": "2026-12-01",
        "priority": "normal",
        "notes": "",
        "submission_token": unique,
        "items": [{
            "product_name": "Test Item", "quantity": 1, "unit": "pcs",
            "attachment_index": 0,
        }],
    }


def _submit_with_attachment(unique: str | None = None):
    unique = unique or uuid.uuid4().hex
    payload = _public_payload(unique)
    files = {
        "attachments": (
            "proof.jpg", b"\xff\xd8\xff\xe0" + unique.encode() + b"0" * 500, "image/jpeg",
        ),
    }
    return client.post(
        "/api/public/purchase-requests",
        data={"payload": json.dumps(payload)}, files=files,
    )


def _patch_slow_put(monkeypatch, delay: float):
    original = attachment_storage.LocalAttachmentStorage.put

    def _slow_put(self, *args, **kwargs):
        time.sleep(delay)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(attachment_storage.LocalAttachmentStorage, "put", _slow_put)


def _patch_slow_get(monkeypatch, delay: float):
    original = attachment_storage.LocalAttachmentStorage.get

    def _slow_get(self, *args, **kwargs):
        time.sleep(delay)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(attachment_storage.LocalAttachmentStorage, "get", _slow_get)


def test_slow_upload_does_not_block_concurrent_unrelated_request(monkeypatch):
    """The core fix: storage.put() runs off the event loop thread, so a slow
    upload must not stall an unrelated concurrent request."""
    _patch_slow_put(monkeypatch, delay=1.5)

    slow_result = {}

    def _do_slow_upload():
        t0 = time.perf_counter()
        resp = _submit_with_attachment()
        slow_result["status"] = resp.status_code
        slow_result["duration"] = time.perf_counter() - t0

    thread = threading.Thread(target=_do_slow_upload)
    thread.start()
    time.sleep(0.3)  # let the slow upload's storage.put() start sleeping first

    t0 = time.perf_counter()
    unrelated = client.get("/api/public/purchase-requests/health")
    unrelated_duration = time.perf_counter() - t0
    thread.join(timeout=10)

    assert slow_result["status"] == 200
    assert slow_result["duration"] >= 1.5
    assert unrelated.status_code == 200
    # Generous bound (10x the fix's measured ~15ms in the audit's real
    # reproduction) to keep this robust on a loaded CI box, while still
    # being far below the 1.5s delay a blocked event loop would show.
    assert unrelated_duration < 0.5, (
        f"unrelated request took {unrelated_duration:.3f}s while a slow "
        "upload was in flight - the event loop appears blocked"
    )


def test_slow_download_does_not_block_concurrent_unrelated_request(monkeypatch):
    """Same property for the download path (storage.get())."""
    upload = _submit_with_attachment()
    assert upload.status_code == 200
    request_number = upload.json()["request_number"]

    listing = client.get(
        "/api/internal/incoming-purchase-requests",
        headers=AUTH_HEADERS,
        params={"search": request_number},
    ).json()
    request_id = listing[0]["id"]
    detail = client.get(
        f"/api/internal/incoming-purchase-requests/{request_id}",
        headers=AUTH_HEADERS,
    ).json()
    attachment_id = detail["items"][0]["attachment"]["id"]

    _patch_slow_get(monkeypatch, delay=1.5)

    slow_result = {}

    def _do_slow_download():
        t0 = time.perf_counter()
        resp = client.get(
            f"/api/internal/incoming-purchase-requests/{request_id}/attachments/{attachment_id}",
            headers=AUTH_HEADERS,
        )
        slow_result["status"] = resp.status_code
        slow_result["duration"] = time.perf_counter() - t0

    thread = threading.Thread(target=_do_slow_download)
    thread.start()
    time.sleep(0.3)

    t0 = time.perf_counter()
    unrelated = client.get("/api/public/purchase-requests/health")
    unrelated_duration = time.perf_counter() - t0
    thread.join(timeout=10)

    assert slow_result["status"] == 200
    assert slow_result["duration"] >= 1.5
    assert unrelated.status_code == 200
    assert unrelated_duration < 0.5


def test_storage_failure_after_partial_upload_cleans_up_and_returns_error(monkeypatch):
    """If the DB write fails after a successful storage.put(), the already-
    written object must be deleted (no orphaned attachment bytes), and the
    request must fail cleanly rather than hang or 500 with a stack trace."""
    delete_calls = []
    original_delete = attachment_storage.LocalAttachmentStorage.delete

    def _tracking_delete(self, key):
        delete_calls.append(key)
        return original_delete(self, key)

    monkeypatch.setattr(attachment_storage.LocalAttachmentStorage, "delete", _tracking_delete)

    # submit_public_request opens SessionLocal() twice: once for the
    # duplicate check (before storage.put()), once for the write (after).
    # Let the first through untouched; fail the second, after the upload
    # already succeeded - mirrors a real "S3 succeeded, DB commit failed".
    # SessionLocal is a sessionmaker; `with SessionLocal() as session`
    # creates a real Session first, then enters it - patch Session.__enter__
    # itself (shared by every Session instance) rather than the factory.
    real_enter = SqlAlchemySession.__enter__
    call_count = {"n": 0}

    def _enter(self):
        call_count["n"] += 1
        if call_count["n"] >= 2:
            raise RuntimeError("simulated DB failure after upload")
        return real_enter(self)

    monkeypatch.setattr(SqlAlchemySession, "__enter__", _enter)

    with pytest.raises(Exception):
        _submit_with_attachment()

    assert len(delete_calls) == 1, "orphaned attachment was not cleaned up"


def test_missing_stored_object_returns_404_not_a_500(monkeypatch):
    upload = _submit_with_attachment()
    assert upload.status_code == 200
    request_number = upload.json()["request_number"]
    listing = client.get(
        "/api/internal/incoming-purchase-requests",
        headers=AUTH_HEADERS,
        params={"search": request_number},
    ).json()
    request_id = listing[0]["id"]
    detail = client.get(
        f"/api/internal/incoming-purchase-requests/{request_id}",
        headers=AUTH_HEADERS,
    ).json()
    attachment_id = detail["items"][0]["attachment"]["id"]

    def _raise_not_found(self, key):
        raise FileNotFoundError(key)

    monkeypatch.setattr(attachment_storage.LocalAttachmentStorage, "get", _raise_not_found)

    resp = client.get(
        f"/api/internal/incoming-purchase-requests/{request_id}/attachments/{attachment_id}",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


def test_s3_client_has_bounded_timeouts_pool_and_retry_policy(monkeypatch):
    """Config regression guard - botocore's bare defaults (60s/60s connect+
    read, max_pool_connections=10, retries mode 'legacy') were never
    reviewed for this app; this locks in the explicit, bounded values."""
    from types import SimpleNamespace

    client_factory = Mock(return_value=Mock())
    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace(client=client_factory))
    monkeypatch.setenv("R2_ENDPOINT_URL", "https://example.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_BUCKET_NAME", "test-bucket")

    attachment_storage.S3AttachmentStorage()

    config = client_factory.call_args.kwargs["config"]
    assert config.connect_timeout == 5
    assert config.read_timeout == 30
    assert config.max_pool_connections == 10
    assert config.retries == {"mode": "standard", "max_attempts": 3}


def test_local_backend_still_round_trips_content_unaffected_by_offload():
    """Regression guard: the offload/reorder changes must not alter what
    gets stored or returned for the (unaffected-by-S3-concerns) local
    filesystem backend used in desktop/dev deployments."""
    unique = uuid.uuid4().hex
    content = b"\xff\xd8\xff\xe0" + unique.encode() + b"local-fs-check"
    payload = _public_payload(unique)
    upload = client.post(
        "/api/public/purchase-requests",
        data={"payload": json.dumps(payload)},
        files={"attachments": ("proof.jpg", content, "image/jpeg")},
    )
    assert upload.status_code == 200
    request_number = upload.json()["request_number"]
    listing = client.get(
        "/api/internal/incoming-purchase-requests",
        headers=AUTH_HEADERS,
        params={"search": request_number},
    ).json()
    request_id = listing[0]["id"]
    detail = client.get(
        f"/api/internal/incoming-purchase-requests/{request_id}",
        headers=AUTH_HEADERS,
    ).json()
    attachment_id = detail["items"][0]["attachment"]["id"]
    download = client.get(
        f"/api/internal/incoming-purchase-requests/{request_id}/attachments/{attachment_id}",
        headers=AUTH_HEADERS,
    )
    assert download.status_code == 200
    assert download.content == content
