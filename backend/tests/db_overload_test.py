"""Bounded-database-wait behavior (see docs/production-capacity-plan.md).

Covers the PostgreSQL engine defaults (pool size/overflow/timeout plus the
server-side statement/lock timeouts), the 503 mapping for pool exhaustion
and statement/lock timeouts, and the 409 mapping for a concurrent duplicate
that loses the race to a unique constraint. Self-contained: runs standalone
against its own temp SQLite DB, and also as part of the full suite (same
pattern as attachment_offload_test.py). No PostgreSQL connection is made:
the option builder is pure and the error handlers are exercised with
synthetic SQLAlchemy exceptions.
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
    _TEST_DIR = tempfile.TemporaryDirectory(prefix="procurex-db-overload-tests-")
    _TEST_DB = Path(_TEST_DIR.name) / "db-overload-test.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
    os.environ.setdefault("INTERNAL_REQUEST_TOKEN", "test-internal-token")
    os.environ.setdefault("INCOMING_REQUEST_UPLOAD_DIR", str(Path(_TEST_DIR.name) / "uploads"))
    os.environ.setdefault("PROCUREX_BACKUP_DIR", str(Path(_TEST_DIR.name) / "backups"))
    os.environ.setdefault("PROCUREX_LOG_DIR", str(Path(_TEST_DIR.name) / "logs"))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.exc import IntegrityError, OperationalError, TimeoutError as PoolTimeoutError  # noqa: E402

from database import engine, postgres_engine_options  # noqa: E402
from server import create_app  # noqa: E402

if _STANDALONE:
    @pytest.fixture(scope="module", autouse=True)
    def _release_temp_database():
        yield
        engine.dispose()  # lets Windows delete the temp SQLite file


_POOL_ENV = (
    "DB_POOL_SIZE", "DB_POOL_MAX_OVERFLOW", "DB_POOL_TIMEOUT_SECONDS",
    "DB_POOL_RECYCLE_SECONDS", "DB_STATEMENT_TIMEOUT_MS", "DB_LOCK_TIMEOUT_MS",
)


@pytest.fixture
def clean_pool_env(monkeypatch):
    for name in _POOL_ENV:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_postgres_defaults_are_the_measured_launch_values(clean_pool_env):
    options = postgres_engine_options()

    assert options["pool_size"] == 5
    assert options["max_overflow"] == 2
    assert options["pool_timeout"] == 5
    assert options["pool_recycle"] == 1800
    assert options["connect_args"] == {
        "options": "-c statement_timeout=10000 -c lock_timeout=3000",
    }


def test_postgres_options_follow_environment(clean_pool_env):
    clean_pool_env.setenv("DB_POOL_SIZE", "3")
    clean_pool_env.setenv("DB_POOL_MAX_OVERFLOW", "0")
    clean_pool_env.setenv("DB_POOL_TIMEOUT_SECONDS", "2")
    clean_pool_env.setenv("DB_STATEMENT_TIMEOUT_MS", "7000")
    clean_pool_env.setenv("DB_LOCK_TIMEOUT_MS", "0")

    options = postgres_engine_options()

    assert (options["pool_size"], options["max_overflow"], options["pool_timeout"]) == (3, 0, 2)
    assert options["connect_args"] == {"options": "-c statement_timeout=7000"}


def test_postgres_server_timeouts_can_both_be_disabled(clean_pool_env):
    clean_pool_env.setenv("DB_STATEMENT_TIMEOUT_MS", "0")
    clean_pool_env.setenv("DB_LOCK_TIMEOUT_MS", "0")

    assert "connect_args" not in postgres_engine_options()


class _DriverError(Exception):
    def __init__(self, sqlstate):
        super().__init__(f"driver error {sqlstate}")
        self.sqlstate = sqlstate


@pytest.fixture(scope="module")
def overload_client():
    app = create_app(initialize_database=False)

    @app.get("/__test__/pool-timeout")
    def pool_timeout():
        raise PoolTimeoutError("QueuePool limit of size 5 overflow 5 reached")

    @app.get("/__test__/sqlstate/{sqlstate}")
    async def sqlstate_error(sqlstate: str):
        raise OperationalError("SELECT 1", {}, _DriverError(sqlstate))

    @app.post("/__test__/integrity/{sqlstate}")
    def integrity_error(sqlstate: str):
        raise IntegrityError("INSERT", {}, _DriverError(sqlstate))

    @app.post("/__test__/sqlite-unique")
    def sqlite_unique():
        raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed: rfqs.source_request_id"))

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def _assert_database_busy(response):
    assert response.status_code == 503, response.text
    assert response.headers["Retry-After"] == "5"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["detail"]["code"] == "database_busy"


def test_pool_exhaustion_returns_retryable_503(overload_client):
    _assert_database_busy(overload_client.get("/__test__/pool-timeout"))


@pytest.mark.parametrize("sqlstate", ["57014", "55P03"])  # statement / lock timeout
def test_statement_and_lock_timeouts_return_retryable_503(overload_client, sqlstate):
    _assert_database_busy(overload_client.get(f"/__test__/sqlstate/{sqlstate}"))


def test_other_operational_errors_stay_a_sanitized_500(overload_client):
    response = overload_client.get("/__test__/sqlstate/08006")  # connection failure

    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "internal_error"
    assert "Retry-After" not in response.headers


@pytest.mark.parametrize("path", ["/__test__/integrity/23505", "/__test__/sqlite-unique"])
def test_concurrent_unique_violation_returns_409(overload_client, path):
    response = overload_client.post(path)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "duplicate_request"


def test_other_integrity_errors_stay_a_sanitized_500(overload_client):
    response = overload_client.post("/__test__/integrity/23503")  # foreign key violation

    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "internal_error"
