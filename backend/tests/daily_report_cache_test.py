"""Closed daily-report cache stays correct across workers/instances.

Each worker keeps its own in-process cache, so a reopen handled by another
worker never invalidates this one. The cache is therefore keyed by the
report's closed_at: a re-close elsewhere stamps a new closed_at and this
worker must rebuild instead of serving its pre-reopen body. Self-contained
(own temp SQLite DB), also runs inside the full suite.
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
    _TEST_DIR = tempfile.TemporaryDirectory(prefix="procurex-daily-cache-tests-")
    _TEST_DB = Path(_TEST_DIR.name) / "daily-cache-test.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
    os.environ.setdefault("INTERNAL_REQUEST_TOKEN", "test-internal-token")
    os.environ.setdefault("INCOMING_REQUEST_UPLOAD_DIR", str(Path(_TEST_DIR.name) / "uploads"))
    os.environ.setdefault("PROCUREX_BACKUP_DIR", str(Path(_TEST_DIR.name) / "backups"))
    os.environ.setdefault("PROCUREX_LOG_DIR", str(Path(_TEST_DIR.name) / "logs"))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

import daily_report  # noqa: E402
from auth.models import User  # noqa: E402
from auth.security import hash_password  # noqa: E402
from database import SessionLocal, engine  # noqa: E402
from server import app  # noqa: E402

PASSWORD = "DailyCachePassw0rd!"


@pytest.fixture(scope="module")
def admin_client():
    username = f"daily-cache-admin-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    with SessionLocal() as session:
        session.add(User(
            id=str(uuid.uuid4()), username=username, display_name=username,
            password_hash=hash_password(PASSWORD), account_type="erp", role="admin",
            active=True, created_at=now, updated_at=now,
        ))
        session.commit()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
        assert login.status_code == 200, login.text
        client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
        yield client
    if _STANDALONE:
        engine.dispose()  # lets Windows delete the temp SQLite file


def test_reclose_by_another_worker_is_not_served_from_a_stale_cache(admin_client, monkeypatch):
    report_date = "2026-01-15"
    closed = admin_client.post(f"/api/reports/daily/{report_date}/close")
    assert closed.status_code == 200, closed.text

    builds = []
    real_build = daily_report._build_report

    async def counting_build(*args, **kwargs):
        builds.append(args[1])
        return await real_build(*args, **kwargs)

    monkeypatch.setattr(daily_report, "_build_report", counting_build)

    assert admin_client.get(f"/api/reports/daily?date={report_date}").status_code == 200
    assert builds == []  # close warmed this worker's cache

    # Another worker reopens and closes the date again. This process's dict
    # never hears about it; only the database row changes.
    with SessionLocal() as session:
        row = session.scalar(
            select(daily_report.DailyReport).where(daily_report.DailyReport.report_date == report_date)
        )
        row.closed_at = datetime.now(timezone.utc).isoformat()
        session.commit()

    assert admin_client.get(f"/api/reports/daily?date={report_date}").status_code == 200
    assert builds == [report_date]  # rebuilt, not the pre-reopen body

    assert admin_client.get(f"/api/reports/daily?date={report_date}").status_code == 200
    assert builds == [report_date]  # and cached again under the new close
