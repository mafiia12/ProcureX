"""GET /api/workflow/approvals: batched queries, unchanged semantics.

The list used to run one ApprovalPayment query per approval (N+3 queries,
203 at 200 approvals). It now runs a fixed number regardless of N. These
tests pin that, plus the rules the batching must preserve: newest payment
wins, the payment_status filter, and has_purchase_order ignoring cancelled
POs. Self-contained (own temp SQLite DB), also runs inside the full suite.
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
    _TEST_DIR = tempfile.TemporaryDirectory(prefix="procurex-approvals-list-tests-")
    _TEST_DB = Path(_TEST_DIR.name) / "approvals-list-test.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
    os.environ.setdefault("INTERNAL_REQUEST_TOKEN", "test-internal-token")
    os.environ.setdefault("INCOMING_REQUEST_UPLOAD_DIR", str(Path(_TEST_DIR.name) / "uploads"))
    os.environ.setdefault("PROCUREX_BACKUP_DIR", str(Path(_TEST_DIR.name) / "backups"))
    os.environ.setdefault("PROCUREX_LOG_DIR", str(Path(_TEST_DIR.name) / "logs"))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event  # noqa: E402

from auth.models import User  # noqa: E402
from auth.security import hash_password  # noqa: E402
from database import PurchaseOrder, SessionLocal, engine  # noqa: E402
from procurement_workflow import ApprovalPayment, EngineerApproval  # noqa: E402
from server import app  # noqa: E402

PASSWORD = "ApprovalsListPassw0rd!"
INTERNAL = {"X-Internal-Token": os.environ.get("INTERNAL_REQUEST_TOKEN", "test-internal-token")}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture(scope="module")
def client():
    username = f"approvals-list-admin-{uuid.uuid4().hex[:8]}"
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
        test_client.headers.update({"Authorization": f"Bearer {login.json()['access_token']}", **INTERNAL})
        yield test_client
    if _STANDALONE:
        engine.dispose()  # lets Windows delete the temp SQLite file


def _add_approvals(tag: str, count: int) -> list[str]:
    ids = []
    with SessionLocal() as session:
        for n in range(count):
            approval_id = str(uuid.uuid4())
            session.add(EngineerApproval(
                id=approval_id, approval_number=f"T-APRQ-{tag}-{n:03d}",
                secure_token=uuid.uuid4().hex + uuid.uuid4().hex, comparison_id=str(uuid.uuid4()),
                status="approved", created_at=_now(), updated_at=_now(),
            ))
            ids.append(approval_id)
        session.commit()
    return ids


def _add_payment(approval_id: str, status: str, created_at: str) -> str:
    payment_id = str(uuid.uuid4())
    with SessionLocal() as session:
        session.add(ApprovalPayment(
            id=payment_id, approval_id=approval_id, method="instapay", amount=100.0, status=status,
            cash_reference=f"T-{payment_id}", created_at=created_at, updated_at=created_at,
        ))
        session.commit()
    return payment_id


def _count_queries(client, url):
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        response = client.get(url)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert response.status_code == 200, response.text
    return len(statements), response.json()


def test_query_count_does_not_grow_with_the_number_of_approvals(client):
    small, large = f"s{uuid.uuid4().hex[:6]}", f"l{uuid.uuid4().hex[:6]}"
    for approval_id in _add_approvals(small, 3):
        _add_payment(approval_id, "pending", "2026-09-01T00:00:00+00:00")
    for approval_id in _add_approvals(large, 40):
        _add_payment(approval_id, "pending", "2026-09-01T00:00:00+00:00")

    small_queries, small_body = _count_queries(client, f"/api/workflow/approvals?search=T-APRQ-{small}")
    large_queries, large_body = _count_queries(client, f"/api/workflow/approvals?search=T-APRQ-{large}")

    assert (len(small_body["items"]), len(large_body["items"])) == (3, 40)
    assert large_queries == small_queries


def test_newest_payment_wins_and_payment_filter_uses_it(client):
    tag = f"p{uuid.uuid4().hex[:6]}"
    paid, unpaid, ordered = _add_approvals(tag, 3)
    _add_payment(paid, "pending", "2026-09-01T00:00:00+00:00")
    newest = _add_payment(paid, "verified", "2026-09-02T00:00:00+00:00")
    _add_payment(unpaid, "cancelled", "2026-09-01T00:00:00+00:00")
    with SessionLocal() as session:
        session.add(PurchaseOrder(id=str(uuid.uuid4()), po_number=f"T-PO-{tag}-1", approval_id=ordered, status="draft"))
        session.add(PurchaseOrder(id=str(uuid.uuid4()), po_number=f"T-PO-{tag}-2", approval_id=unpaid, status="cancelled"))
        session.commit()

    rows = {row["id"]: row for row in client.get(f"/api/workflow/approvals?search=T-APRQ-{tag}").json()["items"]}
    assert (rows[paid]["payment_status"], rows[paid]["payment_id"]) == ("verified", newest)
    assert rows[unpaid]["payment_status"] == "cancelled"
    assert (rows[ordered]["payment_status"], rows[ordered]["payment_id"]) == ("not_started", "")
    assert [rows[i]["has_purchase_order"] for i in (paid, unpaid, ordered)] == [False, False, True]

    verified = client.get(f"/api/workflow/approvals?search=T-APRQ-{tag}&payment_status=verified").json()
    assert [row["id"] for row in verified["items"]] == [paid]
    assert verified["payment_counts"]["verified"] == 1
    pending = client.get(f"/api/workflow/approvals?search=T-APRQ-{tag}&payment_status=pending").json()
    assert pending["items"] == []  # an older pending payment must not match
    not_started = client.get(f"/api/workflow/approvals?search=T-APRQ-{tag}&payment_status=not_started").json()
    assert [row["id"] for row in not_started["items"]] == [ordered]
