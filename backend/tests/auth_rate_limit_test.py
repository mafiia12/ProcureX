"""Focused tests for the login brute-force throttle (see backend/auth/router.py
and backend/rate_limit.py).

Self-contained: runs standalone against its own temp SQLite DB, and also runs
as part of the full suite (reusing backend_test.py's shared DB/app when that
module has already been imported in the same pytest session - see the
`_STANDALONE` guard below, same pattern as whatsapp_intake_test.py).
"""

from __future__ import annotations

import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_STANDALONE = "database" not in sys.modules
if _STANDALONE:
    _TEST_DIR = tempfile.TemporaryDirectory(prefix="procurex-auth-rate-limit-tests-")
    _TEST_DB = Path(_TEST_DIR.name) / "auth-rate-limit-test.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
    os.environ.setdefault("INTERNAL_REQUEST_TOKEN", "test-internal-token")
    os.environ.setdefault("PUBLIC_REQUEST_RATE_LIMIT", "100")
    os.environ.setdefault("INCOMING_REQUEST_UPLOAD_DIR", str(Path(_TEST_DIR.name) / "uploads"))
    os.environ.setdefault("PROCUREX_BACKUP_DIR", str(Path(_TEST_DIR.name) / "backups"))
    os.environ.setdefault("PROCUREX_LOG_DIR", str(Path(_TEST_DIR.name) / "logs"))

from fastapi.testclient import TestClient  # noqa: E402

from database import SessionLocal, init_db  # noqa: E402
from server import app  # noqa: E402
from auth.models import User  # noqa: E402
from auth.security import hash_password  # noqa: E402
import auth.router as auth_router  # noqa: E402

if _STANDALONE:
    init_db()

client = TestClient(app)
PASSWORD = "correct-horse-battery-9"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _create_user(username: str) -> None:
    now = _now()
    with SessionLocal() as session:
        session.add(User(
            id=str(uuid.uuid4()), username=username, display_name=username,
            password_hash=hash_password(PASSWORD), account_type="erp",
            role="admin", active=True, created_at=now, updated_at=now,
        ))
        session.commit()


@pytest.fixture(autouse=True)
def _isolated_limiters():
    """Every test gets a clean slate and its own limit, regardless of what
    ran before it in the same process/session."""
    original_username_max = auth_router._username_limiter.max_events
    original_ip_max = auth_router._ip_limiter.max_events
    original_trust = os.environ.get("TRUST_PROXY_HEADERS")
    auth_router._username_limiter.clear()
    auth_router._ip_limiter.clear()
    yield
    auth_router._username_limiter.max_events = original_username_max
    auth_router._ip_limiter.max_events = original_ip_max
    if original_trust is None:
        os.environ.pop("TRUST_PROXY_HEADERS", None)
    else:
        os.environ["TRUST_PROXY_HEADERS"] = original_trust
    auth_router._username_limiter.clear()
    auth_router._ip_limiter.clear()


def test_locked_out_after_n_failed_attempts():
    os.environ.pop("TRUST_PROXY_HEADERS", None)
    auth_router._username_limiter.max_events = 3
    username = f"lockout-{uuid.uuid4().hex[:8]}"
    _create_user(username)

    for _ in range(3):
        response = client.post("/api/auth/login", json={"username": username, "password": "wrong"})
        assert response.status_code == 401

    locked = client.post("/api/auth/login", json={"username": username, "password": "wrong"})
    assert locked.status_code == 429


def test_429_response_carries_retry_after_header():
    os.environ.pop("TRUST_PROXY_HEADERS", None)
    auth_router._username_limiter.max_events = 1
    username = f"retry-after-{uuid.uuid4().hex[:8]}"
    _create_user(username)

    client.post("/api/auth/login", json={"username": username, "password": "wrong"})
    locked = client.post("/api/auth/login", json={"username": username, "password": "wrong"})

    assert locked.status_code == 429
    assert locked.headers.get("Retry-After") == str(auth_router.AUTH_LOGIN_RATE_WINDOW_SECONDS)


def test_successful_login_resets_the_username_counter():
    os.environ.pop("TRUST_PROXY_HEADERS", None)
    auth_router._username_limiter.max_events = 3
    username = f"reset-{uuid.uuid4().hex[:8]}"
    _create_user(username)

    for _ in range(2):
        response = client.post("/api/auth/login", json={"username": username, "password": "wrong"})
        assert response.status_code == 401

    success = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert success.status_code == 200

    # If the counter had not been reset, only one more failed attempt would
    # be needed to reach the limit (2 pre-success + 1 more = 3). Confirm it
    # instead takes a full fresh round of 3 attempts to lock out again.
    for _ in range(3):
        response = client.post("/api/auth/login", json={"username": username, "password": "wrong"})
        assert response.status_code == 401
    locked = client.post("/api/auth/login", json={"username": username, "password": "wrong"})
    assert locked.status_code == 429


def test_two_usernames_throttle_independently_when_proxy_headers_are_untrusted():
    """Regression test: with TRUST_PROXY_HEADERS not "true", _client_ip falls
    back to request.client.host, which TestClient (and, behind an
    unconfigured reverse proxy, real deployments) presents as the SAME value
    for every request. If the IP-keyed limiter did not disable itself in
    that case, username B's very first attempt below would already be
    locked out by username A's failed attempts, despite being a distinct
    account with no failed attempts of its own."""
    os.environ.pop("TRUST_PROXY_HEADERS", None)
    auth_router._username_limiter.max_events = 2
    auth_router._ip_limiter.max_events = 100  # would still be plenty if mistakenly active

    username_a = f"indep-a-{uuid.uuid4().hex[:8]}"
    username_b = f"indep-b-{uuid.uuid4().hex[:8]}"
    _create_user(username_a)
    _create_user(username_b)

    for _ in range(2):
        response = client.post("/api/auth/login", json={"username": username_a, "password": "wrong"})
        assert response.status_code == 401
    locked_a = client.post("/api/auth/login", json={"username": username_a, "password": "wrong"})
    assert locked_a.status_code == 429

    # Username B has made no attempts of its own and must not be affected by
    # A's lockout, even though both requests share the same client IP.
    response_b = client.post("/api/auth/login", json={"username": username_b, "password": "wrong"})
    assert response_b.status_code == 401
