"""Boot the real app against whatever DATABASE_URL is configured and hit a
couple of real endpoints.

This is deliberately NOT the pytest suite: backend/tests/backend_test.py
hardcodes its own throwaway SQLite database at import time (see its
DATABASE_URL assignment), so it never actually exercises PostgreSQL no
matter what environment variables CI sets. Making the full suite honour an
externally-provided DATABASE_URL is a separate, larger change (every test's
fixtures/cleanup would need auditing for SQLite-specific assumptions) and is
intentionally out of scope here.

What this script actually proves: `alembic upgrade head` produces a schema
PostgreSQL accepts, `init_db()`'s non-SQLite table-presence check passes,
and a real query round-trips through the `users` table on PostgreSQL.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))


def main() -> int:
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url.startswith(("postgres://", "postgresql://", "postgresql+psycopg://")):
        print(f"DATABASE_URL must point at PostgreSQL for this smoke test, got: {database_url!r}")
        return 1

    from fastapi.testclient import TestClient
    from server import create_app

    app = create_app()
    client = TestClient(app)

    health = client.get("/api/public/purchase-requests/health")
    if health.status_code != 200 or health.json() != {"ok": True}:
        print(f"Health check failed: status={health.status_code} body={health.text}")
        return 1

    login = client.post(
        "/api/auth/login", json={"username": "no-such-user", "password": "wrong"},
    )
    if login.status_code != 401:
        print(f"Expected 401 for an unknown login against PostgreSQL, got {login.status_code}: {login.text}")
        return 1

    print("PostgreSQL smoke test passed: app booted, schema check passed, users table round-tripped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
