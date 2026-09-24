"""Client-address resolution behind a proxy, and the staging diagnostic.

Rate limiting keys on _client_ip(). With TRUST_PROXY_HEADERS=true it used to
take the LEFTMOST X-Forwarded-For entry, which the client controls - so any
visitor could pick their own rate-limit identity. It now takes the entry
appended by our own proxy (rightmost TRUSTED_PROXY_HOPS). Self-contained
(own temp SQLite DB), also runs inside the full suite.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_STANDALONE = "database" not in sys.modules
if _STANDALONE:
    _TEST_DIR = tempfile.TemporaryDirectory(prefix="procurex-client-ip-tests-")
    _TEST_DB = Path(_TEST_DIR.name) / "client-ip-test.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
    os.environ.setdefault("INCOMING_REQUEST_UPLOAD_DIR", str(Path(_TEST_DIR.name) / "uploads"))
    os.environ.setdefault("PROCUREX_BACKUP_DIR", str(Path(_TEST_DIR.name) / "backups"))
    os.environ.setdefault("PROCUREX_LOG_DIR", str(Path(_TEST_DIR.name) / "logs"))

from fastapi.testclient import TestClient  # noqa: E402
from starlette.requests import Request  # noqa: E402

from database import engine  # noqa: E402
from incoming_requests import _client_ip  # noqa: E402
from server import create_app  # noqa: E402

if _STANDALONE:
    @pytest.fixture(scope="module", autouse=True)
    def _release_temp_database():
        yield
        engine.dispose()  # lets Windows delete the temp SQLite file


def _request(peer: str, forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "client": (peer, 5000)})


@pytest.fixture
def trusted(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    return monkeypatch


def test_untrusted_headers_use_the_tcp_peer(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    assert _client_ip(_request("10.0.0.7", "203.0.113.9")) == "10.0.0.7"


def test_trusted_proxy_entry_wins_over_a_client_supplied_prefix(trusted):
    # The visitor sent "X-Forwarded-For: 198.51.100.66"; our proxy appended
    # the address it actually saw.
    assert _client_ip(_request("10.0.0.7", "198.51.100.66, 203.0.113.9")) == "203.0.113.9"


def test_two_trusted_hops_select_the_address_the_outer_proxy_saw(trusted):
    trusted.setenv("TRUSTED_PROXY_HOPS", "2")
    assert _client_ip(_request("10.0.0.7", "198.51.100.66, 203.0.113.9, 10.0.0.2")) == "203.0.113.9"


def test_too_few_forwarded_entries_fall_back_to_the_peer(trusted):
    trusted.setenv("TRUSTED_PROXY_HOPS", "2")
    assert _client_ip(_request("10.0.0.7", "203.0.113.9")) == "10.0.0.7"
    assert _client_ip(_request("10.0.0.7")) == "10.0.0.7"


def test_forged_loopback_cannot_open_internal_routes(trusted):
    trusted.delenv("INTERNAL_REQUEST_TOKEN", raising=False)
    trusted.setenv("APP_ENV", "development")
    with TestClient(create_app(initialize_database=False)) as client:
        response = client.get(
            "/api/internal/incoming-purchase-requests",
            headers={"X-Forwarded-For": "127.0.0.1, 203.0.113.9"},
        )
    assert response.status_code == 403


def test_diagnostic_is_absent_unless_enabled(monkeypatch):
    monkeypatch.delenv("CLIENT_IP_DIAGNOSTICS", raising=False)
    with TestClient(create_app(initialize_database=False)) as client:
        assert client.get("/api/diagnostics/client-ip").status_code == 404


def test_diagnostic_reports_kinds_and_fingerprints_never_addresses(trusted):
    trusted.setenv("CLIENT_IP_DIAGNOSTICS", "true")
    with TestClient(create_app(initialize_database=False)) as client:
        response = client.get(
            "/api/diagnostics/client-ip", headers={"X-Forwarded-For": "8.8.8.8, 1.1.1.1, 10.0.0.2"},
        )
    assert response.status_code == 200
    body = response.json()
    assert [entry["kind"] for entry in body["x_forwarded_for"]] == ["public", "public", "private"]
    assert body["rate_limit_identity"] == body["x_forwarded_for"][-1]
    assert not any(address in response.text for address in ("8.8.8.8", "1.1.1.1", "10.0.0.2"))


def test_production_refuses_the_diagnostic(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CLIENT_IP_DIAGNOSTICS", "true")
    with pytest.raises(RuntimeError, match="CLIENT_IP_DIAGNOSTICS"):
        create_app(surface="full", initialize_database=False)


def test_runtime_diagnostic_reports_this_worker(monkeypatch):
    monkeypatch.setenv("CLIENT_IP_DIAGNOSTICS", "true")
    with TestClient(create_app(initialize_database=False)) as client:
        body = client.get("/api/diagnostics/runtime").json()
    assert body["worker_pid"] == os.getpid()
    assert "pool" in body
