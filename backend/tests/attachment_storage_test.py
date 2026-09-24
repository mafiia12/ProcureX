"""Attachment storage: bounded R2/S3 calls that never block the event loop.

Two layers:

1. S3AttachmentStorage against a local fake S3 endpoint (real boto3 /
   botocore / urllib3 stack, no credentials, no network): timeouts,
   retries, 5xx/403/404, connection reset, and credential-free errors.
2. The ASGI app with a fake storage backend: slow storage must not stall
   unrelated routes, failures map to 503/404 without leaking internals,
   no DB connection is held across a storage call, a failed upload leaves
   no metadata row and no orphaned object, and storage threads are capped.

Self-contained (own temp SQLite DB when run alone), also runs inside the
full suite.
"""

from __future__ import annotations

import io
import json
import os
import socket
import struct
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_STANDALONE = "database" not in sys.modules
if _STANDALONE:
    _TEST_DIR = tempfile.TemporaryDirectory(prefix="procurex-attachment-storage-tests-")
    os.environ["DATABASE_URL"] = f"sqlite:///{(Path(_TEST_DIR.name) / 'storage-test.db').as_posix()}"
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
    os.environ.setdefault("INTERNAL_REQUEST_TOKEN", "test-internal-token")
    os.environ.setdefault("PUBLIC_REQUEST_RATE_LIMIT", "100")
    os.environ.setdefault("INCOMING_REQUEST_UPLOAD_DIR", str(Path(_TEST_DIR.name) / "uploads"))
    os.environ.setdefault("PROCUREX_BACKUP_DIR", str(Path(_TEST_DIR.name) / "backups"))
    os.environ.setdefault("PROCUREX_LOG_DIR", str(Path(_TEST_DIR.name) / "logs"))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

import attachment_storage  # noqa: E402
import incoming_requests  # noqa: E402
from attachment_storage import (  # noqa: E402
    AttachmentStorage, AttachmentStorageUnavailable, LocalAttachmentStorage,
    S3AttachmentStorage, StoredAttachment,
)
from auth.models import User  # noqa: E402
from auth.security import hash_password  # noqa: E402
from database import SessionLocal, engine  # noqa: E402
from incoming_requests import IncomingPurchaseRequest, IncomingRequestAttachment  # noqa: E402
from server import app  # noqa: E402

SECRET = "sk-test-SECRET-must-never-leak-0123456789"
PASSWORD = "StorageTestPassw0rd!"
PNG = b"\x89PNG\r\n\x1a\n" + b"attachment-storage-test" * 50


# ---------- 1. Real botocore client against a fake S3 endpoint ----------

class FakeS3:
    """Minimal path-style S3: PUT/GET/DELETE /bucket/key, with injectable
    status codes, response delay and TCP reset."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.status: int | None = None
        self.delay = 0.0
        self.reset = False
        self.requests = 0
        self.lock = threading.Lock()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def _key(self):
                return self.path.split("?", 1)[0].split("/", 2)[-1]

            def _fail_or_wait(self):
                with fake.lock:
                    fake.requests += 1
                if fake.reset:
                    self.connection.setsockopt(
                        socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0)
                    )
                    self.connection.close()
                    return True
                if fake.delay:
                    time.sleep(fake.delay)
                if fake.status:
                    code = {403: "AccessDenied", 500: "InternalError", 503: "SlowDown"}[fake.status]
                    self._send(fake.status, f"<Error><Code>{code}</Code><Message>x</Message></Error>".encode())
                    return True
                return False

            def _send(self, status, body=b"", content_type="application/xml"):
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if body and self.command != "HEAD":
                    self.wfile.write(body)

            def do_PUT(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                if self._fail_or_wait():
                    return
                fake.objects[self._key()] = body
                self._send(200)

            def do_GET(self):
                if self._fail_or_wait():
                    return
                body = fake.objects.get(self._key())
                if body is None:
                    self._send(404, b"<Error><Code>NoSuchKey</Code><Message>x</Message></Error>")
                    return
                self._send(200, body, "application/octet-stream")

            def do_DELETE(self):
                if self._fail_or_wait():
                    return
                fake.objects.pop(self._key(), None)
                self._send(204)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def fake_s3(monkeypatch):
    fake = FakeS3()
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("no_proxy", "127.0.0.1,localhost")
    monkeypatch.delenv("HTTP_PROXY", raising=False)
    monkeypatch.delenv("http_proxy", raising=False)
    monkeypatch.setenv("R2_ENDPOINT_URL", fake.url)
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-access-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", SECRET)
    monkeypatch.setenv("R2_BUCKET_NAME", "procurex-test")
    monkeypatch.setenv("R2_CONNECT_TIMEOUT_SECONDS", "0.5")
    monkeypatch.setenv("R2_READ_TIMEOUT_SECONDS", "0.5")
    monkeypatch.setenv("R2_MAX_ATTEMPTS", "3")
    yield fake
    fake.close()


def _assert_credential_free(text: str):
    assert SECRET not in text
    assert "test-access-key" not in text


def test_s3_round_trip_uses_bounded_client(fake_s3):
    storage = S3AttachmentStorage()
    config = storage.client.meta.config
    assert (config.connect_timeout, config.read_timeout) == (0.5, 0.5)
    assert config.retries == {"mode": "standard", "total_max_attempts": 3}
    assert config.max_pool_connections >= 10

    storage.put("a/b.png", PNG, "image/png", "digest")
    stored = storage.get("a/b.png")
    assert stored.content_length == len(PNG)
    assert stored.body.read(10) + stored.body.read() == PNG
    stored.body.close()
    storage.delete("a/b.png")
    with pytest.raises(FileNotFoundError):
        storage.get("a/b.png")


def test_s3_missing_object_is_file_not_found_without_retry(fake_s3):
    storage = S3AttachmentStorage()
    with pytest.raises(FileNotFoundError):
        storage.get("missing/key.png")
    assert fake_s3.requests == 1


@pytest.mark.parametrize("status, expected_attempts", [(500, 3), (503, 3), (403, 1)])
def test_s3_http_errors_are_bounded_and_credential_free(fake_s3, status, expected_attempts):
    storage = S3AttachmentStorage()
    fake_s3.status = status
    for call in (
        lambda: storage.put("k.png", PNG, "image/png", "d"),
        lambda: storage.get("k.png"),
        lambda: storage.delete("k.png"),
    ):
        fake_s3.requests = 0
        start = time.perf_counter()
        with pytest.raises(AttachmentStorageUnavailable) as caught:
            call()
        assert time.perf_counter() - start < 10
        # 5xx: standard-mode retries, capped at R2_MAX_ATTEMPTS. 403: not retried.
        assert fake_s3.requests == expected_attempts
        assert f"HTTP {status}" in str(caught.value)
        _assert_credential_free(str(caught.value))
        assert caught.value.__cause__ is None and caught.value.__suppress_context__


def test_s3_read_timeout_is_bounded(fake_s3):
    storage = S3AttachmentStorage()
    fake_s3.delay = 2.0  # > R2_READ_TIMEOUT_SECONDS (0.5)
    start = time.perf_counter()
    with pytest.raises(AttachmentStorageUnavailable) as caught:
        storage.get("k.png")
    elapsed = time.perf_counter() - start
    assert fake_s3.requests == 3
    assert elapsed < 6, elapsed  # 3 x 0.5s read timeout + backoff, not 3 x 60s
    assert "ReadTimeoutError" in str(caught.value)
    _assert_credential_free(str(caught.value))


def test_s3_connection_reset_is_bounded(fake_s3):
    storage = S3AttachmentStorage()
    fake_s3.reset = True
    with pytest.raises(AttachmentStorageUnavailable) as caught:
        storage.get("k.png")
    assert fake_s3.requests == 3
    _assert_credential_free(str(caught.value))


def test_s3_connect_timeout_is_bounded(fake_s3):
    from botocore.exceptions import ConnectTimeoutError

    storage = S3AttachmentStorage()
    attempts = []

    def refuse(request, **kwargs):
        attempts.append(1)
        raise ConnectTimeoutError(endpoint_url=fake_s3.url)

    storage.client.meta.events.register("before-send.s3.*", refuse)
    with pytest.raises(AttachmentStorageUnavailable) as caught:
        storage.put("k.png", PNG, "image/png", "d")
    assert len(attempts) == 3
    assert "ConnectTimeoutError" in str(caught.value)
    _assert_credential_free(str(caught.value))


# ---------- 2. The app with a fake storage backend ----------

class FakeStorage(AttachmentStorage):
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.delay = 0.0
        self.fail: dict[str, Exception] = {}
        self.fail_after_puts: int | None = None
        self.puts = 0
        self.active = 0
        self.peak = 0
        self.db_connections_seen: list[int] = []
        self.lock = threading.Lock()

    def _call(self, operation):
        with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            self.db_connections_seen.append(engine.pool.checkedout())
            time.sleep(self.delay)
            if operation in self.fail:
                raise self.fail[operation]
        finally:
            with self.lock:
                self.active -= 1

    def put(self, key, content, media_type, sha256):
        self._call("put")
        if self.fail_after_puts is not None and self.puts >= self.fail_after_puts:
            raise AttachmentStorageUnavailable("object storage put failed: SlowDown (HTTP 503)")
        self.puts += 1
        self.objects[key] = bytes(content)

    def get(self, key):
        self._call("get")
        if key not in self.objects:
            raise FileNotFoundError(key)
        return StoredAttachment(io.BytesIO(self.objects[key]), len(self.objects[key]))

    def delete(self, key):
        self._call("delete")
        self.objects.pop(key, None)


def _now():
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture(scope="module")
def client():
    username = f"storage-admin-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as session:
        session.add(User(
            id=str(uuid.uuid4()), username=username, display_name=username,
            password_hash=hash_password(PASSWORD), account_type="erp", role="admin",
            active=True, created_at=_now(), updated_at=_now(),
        ))
        session.commit()
    with TestClient(app) as test_client:
        login = test_client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
        assert login.status_code == 200, login.text
        test_client.headers.update({
            "Authorization": f"Bearer {login.json()['access_token']}",
            "X-Internal-Token": os.environ.get("INTERNAL_REQUEST_TOKEN", "test-internal-token"),
        })
        yield test_client
    if _STANDALONE:
        engine.dispose()


@pytest.fixture
def storage(monkeypatch):
    fake = FakeStorage()
    monkeypatch.setattr(attachment_storage, "_storage", fake)
    # These tests submit many public requests from one client address. The
    # shared (database-backed) limiter is covered by its own tests; counting
    # these submissions would exhaust the "testclient" bucket for every
    # module that runs after this one.
    monkeypatch.setattr(incoming_requests, "_check_rate_limit", lambda key: None)
    return fake


def _payload(n_items=1):
    token = f"storage-test-{uuid.uuid4().hex}"
    return {
        "requester_name": "Storage Test", "company_name": "Co", "phone_number": "+201001234567",
        "whatsapp_number": "+201001234567", "email": "storage@example.com",
        "project_name": f"Storage {token[-8:]}", "project_location": "Cairo",
        "delivery_location": "Gate", "required_delivery_date": "2099-12-31",
        "priority": "normal", "notes": "", "submission_token": token,
        "items": [{
            "product_name": f"storage item {n} {token[-8:]}", "preferred_brand": "",
            "main_category": "", "subcategory": "", "specifications": "", "quantity": 1,
            "unit": "pcs", "attachment_index": n,
        } for n in range(n_items)],
    }


def _submit(client, n_items=1):
    return client.post(
        "/api/public/purchase-requests",
        data={"payload": json.dumps(_payload(n_items)), "website": ""},
        files=[("attachments", (f"f{n}.png", PNG, "image/png")) for n in range(n_items)],
    )


def _row_counts():
    with SessionLocal() as session:
        return (
            session.scalar(select(func.count()).select_from(IncomingPurchaseRequest)),
            session.scalar(select(func.count()).select_from(IncomingRequestAttachment)),
        )


def _seed_download(client, storage) -> str:
    created = _submit(client)
    assert created.status_code == 200, created.text
    number = created.json()["request_number"]
    listing = client.get("/api/internal/incoming-purchase-requests", params={"search": number}).json()
    request_id = listing[0]["id"]
    detail = client.get(f"/api/internal/incoming-purchase-requests/{request_id}").json()
    attachment_id = detail["items"][0]["attachment"]["id"]
    return f"/api/internal/incoming-purchase-requests/{request_id}/attachments/{attachment_id}"


def _latency_while(client, busy_calls, probe_path="/api/"):
    """Runs busy_calls concurrently and probes probe_path while they run."""
    with ThreadPoolExecutor(max_workers=len(busy_calls) + 1) as pool:
        futures = [pool.submit(call) for call in busy_calls]
        time.sleep(0.3)  # let the slow storage calls start
        start = time.perf_counter()
        probe = client.get(probe_path)
        latency = time.perf_counter() - start
        results = [future.result() for future in futures]
    assert probe.status_code == 200
    return latency, results


def test_slow_storage_does_not_block_unrelated_requests(client, storage):
    path = _seed_download(client, storage)
    storage.delay = 1.5
    latency, results = _latency_while(client, [lambda: client.get(path)] * 3)
    assert all(r.status_code == 200 and r.content == PNG for r in results)
    assert latency < 0.5, f"unrelated request waited {latency:.2f}s behind storage"

    latency, results = _latency_while(client, [lambda: _submit(client)] * 3, "/api/suppliers")
    assert all(r.status_code == 200 for r in results)
    assert latency < 0.5, f"unrelated request waited {latency:.2f}s behind storage"


def test_storage_calls_hold_no_db_connection(client, storage):
    path = _seed_download(client, storage)
    storage.db_connections_seen.clear()
    assert client.get(path).status_code == 200
    assert _submit(client).status_code == 200
    assert storage.db_connections_seen and set(storage.db_connections_seen) == {0}


def test_storage_threads_are_capped(client, storage, monkeypatch):
    path = _seed_download(client, storage)
    storage.delay = 0.3
    storage.peak = 0
    threads_before = threading.active_count()
    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(lambda _: client.get(path), range(20)))
    assert all(r.status_code == 200 for r in results)
    assert storage.peak <= int(os.getenv("ATTACHMENT_STORAGE_MAX_THREADS", "10"))
    assert storage.peak > 1  # actually concurrent, not serialized on the loop
    # 20 client threads plus at most the capped storage threads.
    assert threading.active_count() - threads_before <= 20 + 10


def test_storage_outage_returns_503_without_leaking(client, storage):
    path = _seed_download(client, storage)
    storage.fail["get"] = AttachmentStorageUnavailable("object storage get failed: SlowDown (HTTP 503)")
    response = client.get(path)
    assert response.status_code == 503
    assert response.headers.get("retry-after") == "5"
    assert response.json()["detail"]["code"] == "storage_unavailable"
    assert "SlowDown" not in response.text and SECRET not in response.text
    assert engine.pool.checkedout() == 0
    assert client.get("/api/").status_code == 200


def test_missing_object_returns_404(client, storage):
    path = _seed_download(client, storage)
    storage.objects.clear()
    response = client.get(path)
    assert response.status_code == 404
    assert engine.pool.checkedout() == 0


def test_failed_upload_leaves_no_metadata_and_no_orphans(client, storage):
    before = _row_counts()
    storage.fail_after_puts = 1  # first object written, second fails
    response = _submit(client, n_items=2)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "storage_unavailable"
    assert _row_counts() == before
    assert storage.objects == {}  # the first object was cleaned up
    assert engine.pool.checkedout() == 0


def test_cleanup_failure_does_not_mask_original_error(client, storage):
    before = _row_counts()
    storage.fail_after_puts = 1
    storage.fail["delete"] = AttachmentStorageUnavailable("object storage delete failed: InternalError (HTTP 500)")
    response = _submit(client, n_items=2)
    assert response.status_code == 503
    assert _row_counts() == before


def test_retry_after_storage_failure_creates_exactly_one_request(client, storage):
    payload = _payload()
    body = {"payload": json.dumps(payload), "website": ""}
    files = [("attachments", ("f0.png", PNG, "image/png"))]
    storage.fail["put"] = AttachmentStorageUnavailable("object storage put failed: ReadTimeoutError")
    before = _row_counts()
    assert client.post("/api/public/purchase-requests", data=body, files=files).status_code == 503
    storage.fail.clear()
    assert client.post("/api/public/purchase-requests", data=body, files=files).status_code == 200
    again = client.post("/api/public/purchase-requests", data=body, files=files)
    assert again.status_code == 200 and again.json()["duplicate"] is True
    assert _row_counts() == (before[0] + 1, before[1] + 1)
    assert len(storage.objects) == 1


def test_local_backend_streams_in_chunks_and_closes(tmp_path):
    import asyncio

    storage = LocalAttachmentStorage(tmp_path)
    content = os.urandom(attachment_storage.STREAM_CHUNK_BYTES * 2 + 17)
    storage.put("r/x.bin", content, "application/octet-stream", "d")
    stored = storage.get("r/x.bin")

    async def collect():
        return [chunk async for chunk in attachment_storage.stream_attachment(stored)]

    chunks = asyncio.run(collect())
    assert b"".join(chunks) == content
    assert len(chunks) == 3
    assert stored.body.closed
