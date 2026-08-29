"""Focused tests for the WhatsApp intake channel (see backend/whatsapp/).

Self-contained: runs standalone (`pytest backend/tests/whatsapp_intake_test.py`)
against its own temp SQLite DB, and also runs as part of the full suite
(reusing backend_test.py's shared DB/app when that module has already been
imported in the same pytest session — see the `_STANDALONE` guard below).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_STANDALONE = "database" not in sys.modules
if _STANDALONE:
    _TEST_DIR = tempfile.TemporaryDirectory(prefix="procurex-whatsapp-tests-")
    _TEST_DB = Path(_TEST_DIR.name) / "whatsapp-test.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
    os.environ.setdefault("INTERNAL_REQUEST_TOKEN", "test-internal-token")
    os.environ.setdefault("PUBLIC_REQUEST_RATE_LIMIT", "100")
    os.environ.setdefault("INCOMING_REQUEST_UPLOAD_DIR", str(Path(_TEST_DIR.name) / "uploads"))
    os.environ.setdefault("PROCUREX_BACKUP_DIR", str(Path(_TEST_DIR.name) / "backups"))
    os.environ.setdefault("PROCUREX_LOG_DIR", str(Path(_TEST_DIR.name) / "logs"))

# Unconditional, not setdefault: a developer's real backend/.env (e.g. from
# live Meta testing per WHATSAPP-INTAKE-CLOSURE) already has real
# WHATSAPP_* values by the time database.py's load_dotenv() runs during
# collection of an earlier test file - setdefault would then keep that real
# value instead of this suite's known-fake one. A later import of database.py
# (dotenv's own setdefault-like behavior) never overwrites what we set here.
os.environ["WHATSAPP_ENABLED"] = "true"
os.environ["WHATSAPP_PHONE_NUMBER_ID"] = "test-phone-number-id"
os.environ["WHATSAPP_ACCESS_TOKEN"] = "test-access-token"
os.environ["WHATSAPP_VERIFY_TOKEN"] = "test-verify-token"
os.environ["WHATSAPP_APP_SECRET"] = "test-app-secret"
os.environ.pop("PUBLIC_BASE_URL", None)
os.environ.pop("TRUSTED_HOSTS", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from database import Item, Project, SessionLocal, init_db  # noqa: E402
from server import app  # noqa: E402
from auth.models import User, UserProjectAccess  # noqa: E402
from auth.security import hash_password  # noqa: E402
from incoming_requests import IncomingPurchaseRequest, IncomingPurchaseRequestItem  # noqa: E402
import whatsapp.admin_router as wa_admin_router  # noqa: E402
import whatsapp.config as wa_config  # noqa: E402
import whatsapp.router as wa_router  # noqa: E402
from whatsapp import parser, session_service, settings_service  # noqa: E402
from whatsapp.models import WhatsAppDraft, WhatsAppProcessedMessage  # noqa: E402

if _STANDALONE:
    init_db()

API = "/api"
WEBHOOK_URL = "/api/integrations/whatsapp/webhook"
INTERNAL_HEADERS = {"X-Internal-Token": os.environ["INTERNAL_REQUEST_TOKEN"]}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session", autouse=True)
def _cleanup_standalone_database():
    yield
    if _STANDALONE:
        from database import engine
        engine.dispose()
        _TEST_DIR.cleanup()


@pytest.fixture(autouse=True)
def _reset_whatsapp_enabled():
    """whatsapp_settings is a singleton row shared by every test in this
    file — force it back to the default (enabled) after each test so a
    disabled-service test can never leak into an unrelated one."""
    yield
    with SessionLocal() as session:
        settings_service.set_enabled(session, True, actor="test-reset")


@pytest.fixture
def fake_provider(monkeypatch):
    """Records outbound replies instead of calling Meta. Every webhook test
    uses this — the suite must never depend on network access."""
    sent: list[tuple[str, str]] = []

    class _FakeProvider:
        name = "fake"

        def send_text(self, to_e164: str, body: str) -> str:
            sent.append((to_e164, body))
            return f"fake-{uuid.uuid4().hex}"

    monkeypatch.setattr(wa_config, "build_provider", lambda: _FakeProvider())
    return sent


def _sign(body: bytes) -> str:
    digest = hmac.new(os.environ["WHATSAPP_APP_SECRET"].encode(), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def _wa_payload(wa_id: str, message_id: str, text: str) -> dict:
    return {
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "entry-1",
            "changes": [{
                "field": "messages",
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {"phone_number_id": os.environ["WHATSAPP_PHONE_NUMBER_ID"]},
                    "contacts": [{"wa_id": wa_id}],
                    "messages": [{
                        "from": wa_id, "id": message_id, "timestamp": "1700000000",
                        "type": "text", "text": {"body": text},
                    }],
                },
            }],
        }],
    }


def _post_webhook(client, wa_id: str, message_id: str, text: str):
    body = json.dumps(_wa_payload(wa_id, message_id, text)).encode()
    return client.post(
        WEBHOOK_URL, content=body,
        headers={"content-type": "application/json", "x-hub-signature-256": _sign(body)},
    )


def _make_project(session, suffix: str, **overrides) -> str:
    project_id = f"T-WA-PROJECT-{suffix}"
    defaults = dict(id=project_id, code=f"T-WA-{suffix}", name=f"مشروع واتساب {suffix}")
    defaults.update(overrides)
    session.add(Project(**defaults))
    session.commit()
    return project_id


def _make_engineer(session, suffix: str, phone: str, project_ids=()) -> User:
    now = datetime.now(timezone.utc).isoformat()
    user = User(
        id=str(uuid.uuid4()), username=f"wa-eng-{suffix}", display_name=f"مهندس {suffix}",
        password_hash=hash_password("Sprint21Passw0rd!"), account_type="site_portal",
        role="site_engineer", active=True, phone_e164=phone, created_at=now, updated_at=now,
    )
    session.add(user)
    session.flush()
    for project_id in project_ids:
        session.add(UserProjectAccess(
            id=str(uuid.uuid4()), user_id=user.id, project_id=project_id, created_at=now,
        ))
    session.commit()
    session.refresh(user)
    return user


def _make_item(session, suffix: str, product_name: str, unit: str = "قطعة") -> str:
    item_id = f"T-WA-ITEM-{suffix}"
    session.add(Item(id=item_id, code=f"T-WA-ITM-{suffix}", name=product_name, product_name=product_name, unit=unit))
    session.commit()
    return item_id


def _make_admin_headers(client, suffix: str) -> dict:
    with SessionLocal() as session:
        now = datetime.now(timezone.utc).isoformat()
        username = f"wa-admin-{suffix}"
        session.add(User(
            id=str(uuid.uuid4()), username=username, display_name=username,
            password_hash=hash_password("Sprint21Passw0rd!"), account_type="erp",
            role="admin", active=True, created_at=now, updated_at=now,
        ))
        session.commit()
    login = client.post(f"{API}/auth/login", json={"username": username, "password": "Sprint21Passw0rd!"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _wa_id(phone_e164: str) -> str:
    return phone_e164.lstrip("+")


def _phone_suffix() -> str:
    """Digits only — unlike the uuid4().hex suffix used elsewhere for names/
    ids, a phone number must normalize via whatsapp.phone.normalize_e164,
    which rejects non-digit characters (hex a-f included)."""
    return str(uuid.uuid4().int)[:9]


# ---------- Webhook security (spec item 15) ----------

def test_webhook_get_verification_succeeds_with_correct_token(client):
    response = client.get(WEBHOOK_URL, params={
        "hub.mode": "subscribe", "hub.verify_token": "test-verify-token", "hub.challenge": "echo-me",
    })
    assert response.status_code == 200
    assert response.text == "echo-me"


def test_webhook_get_verification_rejects_wrong_token(client):
    response = client.get(WEBHOOK_URL, params={
        "hub.mode": "subscribe", "hub.verify_token": "wrong-token", "hub.challenge": "echo-me",
    })
    assert response.status_code == 403


def test_webhook_post_rejects_invalid_signature(client, fake_provider):
    body = json.dumps(_wa_payload("201000000001", "wamid.bad-sig", "تأكيد")).encode()
    response = client.post(
        WEBHOOK_URL, content=body,
        headers={"content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef"},
    )
    assert response.status_code == 403
    assert fake_provider == []


def test_webhook_env_var_no_longer_gates_availability(client, fake_provider, monkeypatch):
    """WHATSAPP_ENABLED used to 404 the whole webhook; it's now only the
    one-time seed for the Admin toggle (whatsapp_settings.enabled) — the
    webhook itself must stay reachable regardless."""
    monkeypatch.setenv("WHATSAPP_ENABLED", "false")
    response = _post_webhook(client, "201000000002", f"wamid.{uuid.uuid4().hex}", "تأكيد")
    assert response.status_code == 200


# ---------- Phone -> engineer resolution (spec item 5) ----------

def test_unknown_phone_is_rejected_and_creates_no_draft(client, fake_provider):
    wa_id = "201500000001"
    response = _post_webhook(client, wa_id, f"wamid.{uuid.uuid4().hex}", "مشروع تجريبي\n5 قطعة صنف")
    assert response.status_code == 200
    assert fake_provider[-1][1] == session_service.UNKNOWN_PHONE_TEXT
    with SessionLocal() as session:
        assert session.scalar(select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == f"+{wa_id}")) is None


def test_known_engineer_phone_is_accepted(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    phone = f"+2015{_phone_suffix()}"
    with SessionLocal() as session:
        project_id = _make_project(session, suffix)
        _make_engineer(session, suffix, phone, project_ids=[project_id])

    response = _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"مشروع واتساب {suffix}\n20 شيكارة معجون\n\nمطلوب 2 سبتمبر",
    )
    assert response.status_code == 200
    assert fake_provider[-1][1] != session_service.UNKNOWN_PHONE_TEXT
    assert "طلب شراء جديد" in fake_provider[-1][1]


# ---------- Project resolution (spec item 6) ----------

def test_single_assigned_project_is_used_automatically(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    phone = f"+2016{_phone_suffix()}"
    with SessionLocal() as session:
        project_id = _make_project(session, suffix)
        _make_engineer(session, suffix, phone, project_ids=[project_id])

    response = _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"اسم عشوائي لا يطابق شيء\n20 شيكارة معجون\n\nمطلوب 2 سبتمبر",
    )
    assert response.status_code == 200
    reply = fake_provider[-1][1]
    assert "اختر المشروع" not in reply
    with SessionLocal() as session:
        draft = session.scalar(select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone))
        assert draft.project_id == project_id


def test_ambiguous_project_prompts_numbered_choice_then_resolves(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    phone = f"+2017{_phone_suffix()}"
    with SessionLocal() as session:
        project_a = _make_project(session, f"{suffix}-a", name=f"مشروع أ {suffix}")
        project_b = _make_project(session, f"{suffix}-b", name=f"مشروع ب {suffix}")
        _make_engineer(session, suffix, phone, project_ids=[project_a, project_b])

    first = _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        "اسم غير مطابق إطلاقًا\n20 شيكارة معجون\n\nمطلوب 2 سبتمبر",
    )
    assert first.status_code == 200
    assert "اختر المشروع" in fake_provider[-1][1]

    with SessionLocal() as session:
        draft = session.scalar(select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone))
        candidates = draft.candidate_projects_json
        choice_number = next(i for i, row in enumerate(candidates, 1) if row["id"] == project_a)

    second = _post_webhook(client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}", str(choice_number))
    assert second.status_code == 200
    with SessionLocal() as session:
        draft = session.scalar(
            select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone)
            .order_by(WhatsAppDraft.created_at.desc())
        )
        assert draft.project_id == project_a
        assert draft.status == "collecting"


# ---------- Item Master linking (spec item 7) ----------

def test_item_master_match_links_item_id(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    phone = f"+2018{_phone_suffix()}"
    product_name = f"معجون-{suffix}"
    with SessionLocal() as session:
        project_id = _make_project(session, suffix)
        _make_engineer(session, suffix, phone, project_ids=[project_id])
        item_id = _make_item(session, suffix, product_name, unit="شيكارة")

    _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"مشروع واتساب {suffix}\n20 شيكارة {product_name}\n\nمطلوب 2 سبتمبر",
    )
    with SessionLocal() as session:
        draft = session.scalar(select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone))
        assert draft.items_json[0]["item_id"] == item_id


def test_unmatched_item_stays_manual(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    phone = f"+2019{_phone_suffix()}"
    with SessionLocal() as session:
        project_id = _make_project(session, suffix)
        _make_engineer(session, suffix, phone, project_ids=[project_id])

    unmatched_name = f"صنف-غير-موجود-{suffix}"
    _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"مشروع واتساب {suffix}\n5 قطعة {unmatched_name}\n\nمطلوب 2 سبتمبر",
    )
    with SessionLocal() as session:
        draft = session.scalar(select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone))
        assert draft.items_json[0]["item_id"] == ""
        assert draft.items_json[0]["product_name"] == unmatched_name


# ---------- Missing info follow-up (spec item 9) ----------

def test_missing_quantity_asks_targeted_question(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    phone = f"+2020{_phone_suffix()}"
    with SessionLocal() as session:
        project_id = _make_project(session, suffix)
        _make_engineer(session, suffix, phone, project_ids=[project_id])

    response = _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"مشروع واتساب {suffix}\nكابل 4 مم",
    )
    assert response.status_code == 200
    assert fake_provider[-1][1] == "ما هي الكمية والوحدة لكابل 4 مم؟"

    follow_up = _post_webhook(client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}", "300 متر")
    assert follow_up.status_code == 200
    with SessionLocal() as session:
        draft = session.scalar(select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone))
        assert draft.items_json[0]["quantity"] == 300.0
        assert draft.items_json[0]["unit"] == "متر"
        assert draft.status == "awaiting_delivery_date"


# ---------- Confirmation, REQ creation, and the existing workflow (spec items 8, 9, 14) ----------

def test_confirmation_creates_the_existing_incoming_request(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    phone = f"+2021{_phone_suffix()}"
    with SessionLocal() as session:
        project_id = _make_project(session, suffix)
        engineer = _make_engineer(session, suffix, phone, project_ids=[project_id])

    _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"مشروع واتساب {suffix}\n20 شيكارة معجون\n\nمطلوب 2 سبتمبر",
    )
    assert "للتأكيد" in fake_provider[-1][1]

    confirm = _post_webhook(client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}", "تأكيد")
    assert confirm.status_code == 200
    reply = fake_provider[-1][1]
    assert "تم تسجيل طلب الشراء بنجاح" in reply
    assert "REQ-" in reply

    with SessionLocal() as session:
        draft = session.scalar(select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone))
        assert draft.status == "confirmed"
        request_id = draft.confirmed_request_id
        row = session.get(IncomingPurchaseRequest, request_id)
        assert row is not None
        assert row.status == "new"
        assert row.project_id == project_id
        assert row.requester_user_id == engineer.id
        assert row.source == "whatsapp"
        items = session.scalars(
            select(IncomingPurchaseRequestItem).where(IncomingPurchaseRequestItem.request_id == request_id)
        ).all()
        assert len(items) == 1
        assert items[0].quantity == 20.0
        assert items[0].unit == "شيكارة"

    # spec item 9/14: the same REQ, reachable through the existing internal
    # workflow endpoints an ERP user already uses for every other channel.
    admin_headers = _make_admin_headers(client, suffix)
    detail = client.get(
        f"{API}/internal/incoming-purchase-requests/{request_id}",
        headers={**INTERNAL_HEADERS, **admin_headers},
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["status"] == "new"
    assert detail.json()["project_name"] == f"مشروع واتساب {suffix}"
    assert detail.json()["source"] == "whatsapp"

    list_response = client.get(
        f"{API}/internal/incoming-purchase-requests",
        headers={**INTERNAL_HEADERS, **admin_headers},
        params={"search": request_id},
    )
    assert list_response.status_code == 200, list_response.text
    matching = [row for row in list_response.json() if row["id"] == request_id]
    # search-by-id may not match request_number/requester_name/etc.; fetch
    # unfiltered instead if the id search finds nothing, and assert on that row.
    if not matching:
        matching = [row for row in client.get(
            f"{API}/internal/incoming-purchase-requests",
            headers={**INTERNAL_HEADERS, **admin_headers},
        ).json() if row["id"] == request_id]
    assert matching and matching[0]["source"] == "whatsapp"


# ---------- Idempotency (spec items 10, 11) ----------

def test_duplicate_webhook_message_and_repeated_confirmation_never_duplicate_the_req(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    phone = f"+2022{_phone_suffix()}"
    with SessionLocal() as session:
        project_id = _make_project(session, suffix)
        _make_engineer(session, suffix, phone, project_ids=[project_id])

    _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"مشروع واتساب {suffix}\n20 شيكارة معجون\n\nمطلوب 2 سبتمبر",
    )

    confirm_message_id = f"wamid.{uuid.uuid4().hex}"
    _post_webhook(client, _wa_id(phone), confirm_message_id, "تأكيد")
    with SessionLocal() as session:
        req_count = session.scalar(
            select(func.count()).select_from(IncomingPurchaseRequest)
            .where(IncomingPurchaseRequest.project_id == project_id)
        )
    assert req_count == 1

    # Meta redelivers the exact same message id.
    replay = _post_webhook(client, _wa_id(phone), confirm_message_id, "تأكيد")
    assert replay.status_code == 200
    with SessionLocal() as session:
        req_count_after_replay = session.scalar(
            select(func.count()).select_from(IncomingPurchaseRequest)
            .where(IncomingPurchaseRequest.project_id == project_id)
        )
        processed_count = session.scalar(
            select(func.count()).select_from(WhatsAppProcessedMessage)
            .where(WhatsAppProcessedMessage.message_id == confirm_message_id)
        )
    assert req_count_after_replay == 1
    assert processed_count == 1

    # The engineer manually re-sends "تأكيد" as a brand-new message.
    second_confirm = _post_webhook(client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}", "تأكيد")
    assert second_confirm.status_code == 200
    assert "تم تسجيل طلب الشراء بنجاح" in fake_provider[-1][1]
    with SessionLocal() as session:
        final_count = session.scalar(
            select(func.count()).select_from(IncomingPurchaseRequest)
            .where(IncomingPurchaseRequest.project_id == project_id)
        )
    assert final_count == 1


# ---------- Cancellation (spec item 12) ----------

def test_cancellation_invalidates_the_draft(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    phone = f"+2023{_phone_suffix()}"
    with SessionLocal() as session:
        project_id = _make_project(session, suffix)
        _make_engineer(session, suffix, phone, project_ids=[project_id])

    _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"مشروع واتساب {suffix}\n20 شيكارة معجون\n\nمطلوب 2 سبتمبر",
    )
    cancel = _post_webhook(client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}", "إلغاء")
    assert cancel.status_code == 200
    assert fake_provider[-1][1] == session_service.CANCEL_ACK_TEXT

    with SessionLocal() as session:
        draft = session.scalar(
            select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone)
            .order_by(WhatsAppDraft.created_at.desc())
        )
        assert draft.status == "cancelled"

    confirm_after_cancel = _post_webhook(client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}", "تأكيد")
    assert confirm_after_cancel.status_code == 200
    assert fake_provider[-1][1] == session_service.NOTHING_TO_CONFIRM_TEXT
    with SessionLocal() as session:
        req_count = session.scalar(
            select(func.count()).select_from(IncomingPurchaseRequest)
            .where(IncomingPurchaseRequest.project_id == project_id)
        )
    assert req_count == 0


# ---------- Site Portal remains unaffected by the create_incoming_request refactor (spec item 13) ----------

def test_site_portal_submission_still_works_after_the_refactor(client):
    suffix = uuid.uuid4().hex[:8]
    with SessionLocal() as session:
        project_id = _make_project(session, f"portal-{suffix}")
        now = datetime.now(timezone.utc).isoformat()
        username = f"wa-portal-{suffix}"
        user = User(
            id=str(uuid.uuid4()), username=username, display_name=username,
            password_hash=hash_password("Sprint21Passw0rd!"), account_type="site_portal",
            role="site_engineer", active=True, created_at=now, updated_at=now,
        )
        session.add(user)
        session.flush()
        session.add(UserProjectAccess(
            id=str(uuid.uuid4()), user_id=user.id, project_id=project_id, created_at=now,
        ))
        session.commit()

    login = client.post(f"{API}/auth/login", json={"username": username, "password": "Sprint21Passw0rd!"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    payload = {
        "required_delivery_date": (datetime.now().date() + timedelta(days=5)).isoformat(),
        "priority": "normal", "delivery_destination": "site", "notes": "", "project_id": "",
        "items": [{"item_id": "", "product_name": "صنف بوابة الموقع", "unit": "قطعة", "quantity": 3, "note": ""}],
    }
    response = client.post(
        f"{API}/portal/purchase-requests", data={"payload": json.dumps(payload)}, headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["request_number"].startswith("REQ-")
    with SessionLocal() as session:
        row = session.get(IncomingPurchaseRequest, response.json()["request_id"])
        assert row.source == "site_portal"


# ---------- Parser unit checks (fast, no HTTP) ----------

def test_parser_handles_both_spec_examples():
    from datetime import date

    parsed = parser.parse_message(
        "مشروع رويال هيلز\n\n20 شيكارة معجون\n10 جردل سيلر\n\nمطلوب 2 سبتمبر"
    )
    assert parsed.project_name == "رويال هيلز"
    assert [(i.product_name, i.quantity, i.unit) for i in parsed.items] == [
        ("معجون", 20.0, "شيكارة"), ("سيلر", 10.0, "جردل"),
    ]
    today = date.today()
    expected_year = today.year if date(today.year, 9, 2) >= today else today.year + 1
    assert parsed.required_delivery_date == date(expected_year, 9, 2).isoformat()

    parsed2 = parser.parse_message("رويال هيلز\nكابل 4 مم - 300 متر\nبريزة شنايدر دبل - 20 عدد")
    assert [(i.product_name, i.quantity, i.unit) for i in parsed2.items] == [
        ("كابل 4 مم", 300.0, "متر"), ("بريزة شنايدر دبل", 20.0, "عدد"),
    ]


def test_confirm_and_cancel_are_exact_arabic_bytes_not_a_reversed_or_mangled_variant():
    """A prior report displayed Arabic reversed due to terminal RTL
    rendering — that's a display artifact, not a data problem, but this
    pins the actual in-memory/on-the-wire representation so a future
    regression (e.g. an editor round-tripping through the wrong encoding)
    would be caught here rather than only noticed visually."""
    confirm_word = "تأكيد"  # ت ، أ ، ك ، ي ، د - logical reading order
    cancel_word = "إلغاء"  # إ ، ل ، غ ، ا ، ء - logical reading order
    assert confirm_word == "تأكيد"
    assert cancel_word == "إلغاء"
    assert confirm_word.encode("utf-8") == bytes([
        0xd8, 0xaa, 0xd8, 0xa3, 0xd9, 0x83, 0xd9, 0x8a, 0xd8, 0xaf,
    ])
    assert cancel_word.encode("utf-8") == bytes([
        0xd8, 0xa5, 0xd9, 0x84, 0xd8, 0xba, 0xd8, 0xa7, 0xd8, 0xa1,
    ])
    assert parser.is_confirm(confirm_word) is True
    assert parser.is_cancel(cancel_word) is True
    # a reversed byte sequence must NOT be treated as the same command
    assert parser.is_confirm(confirm_word[::-1]) is False
    assert parser.is_cancel(cancel_word[::-1]) is False


# ---------- Admin Settings: enable/disable, connection status, source (closure sprint) ----------

def test_settings_reflects_enabled_state_and_toggle_takes_effect_without_restart(client, fake_provider):
    suffix = uuid.uuid4().hex[:8]
    admin_headers = _make_admin_headers(client, suffix)
    phone = f"+2030{_phone_suffix()}"
    with SessionLocal() as session:
        project_id = _make_project(session, suffix)
        _make_engineer(session, suffix, phone, project_ids=[project_id])

    baseline = client.get(f"{API}/admin/whatsapp/settings", headers=admin_headers)
    assert baseline.status_code == 200, baseline.text
    assert baseline.json()["enabled"] is True

    disable = client.put(f"{API}/admin/whatsapp/settings", json={"enabled": False}, headers=admin_headers)
    assert disable.status_code == 200
    assert disable.json()["enabled"] is False

    response = _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"مشروع واتساب {suffix}\n20 شيكارة معجون\n\nمطلوب 2 سبتمبر",
    )
    assert response.status_code == 200
    assert fake_provider[-1][1] == wa_router.PAUSED_TEXT
    with SessionLocal() as session:
        assert session.scalar(select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone)) is None
        req_count = session.scalar(
            select(func.count()).select_from(IncomingPurchaseRequest)
            .where(IncomingPurchaseRequest.project_id == project_id)
        )
    assert req_count == 0

    enable = client.put(f"{API}/admin/whatsapp/settings", json={"enabled": True}, headers=admin_headers)
    assert enable.json()["enabled"] is True
    response2 = _post_webhook(
        client, _wa_id(phone), f"wamid.{uuid.uuid4().hex}",
        f"مشروع واتساب {suffix}\n20 شيكارة معجون\n\nمطلوب 2 سبتمبر",
    )
    assert response2.status_code == 200
    with SessionLocal() as session:
        draft = session.scalar(select(WhatsAppDraft).where(WhatsAppDraft.phone_e164 == phone))
        assert draft is not None


def test_get_verification_still_succeeds_while_service_disabled(client):
    """Meta's webhook subscription must not be jeopardized by the Admin
    toggling the daily on/off switch off."""
    suffix = uuid.uuid4().hex[:8]
    admin_headers = _make_admin_headers(client, suffix)
    client.put(f"{API}/admin/whatsapp/settings", json={"enabled": False}, headers=admin_headers)
    response = client.get(WEBHOOK_URL, params={
        "hub.mode": "subscribe", "hub.verify_token": "test-verify-token", "hub.challenge": "still-here",
    })
    assert response.status_code == 200
    assert response.text == "still-here"


def test_settings_response_never_contains_secret_values(client):
    suffix = uuid.uuid4().hex[:8]
    admin_headers = _make_admin_headers(client, suffix)
    response = client.get(f"{API}/admin/whatsapp/settings", headers=admin_headers)
    body = response.text
    assert os.environ["WHATSAPP_ACCESS_TOKEN"] not in body
    assert os.environ["WHATSAPP_APP_SECRET"] not in body
    assert os.environ["WHATSAPP_VERIFY_TOKEN"] not in body


# ---------- PUBLIC_BASE_URL webhook URL (never fall back to localhost for Meta) ----------

def test_webhook_url_is_empty_and_unconfigured_without_public_base_url(client, monkeypatch):
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    suffix = uuid.uuid4().hex[:8]
    admin_headers = _make_admin_headers(client, suffix)
    response = client.get(f"{API}/admin/whatsapp/settings", headers=admin_headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["webhook_url"] == ""
    assert data["webhook_url_configured"] is False
    # a request-derived localhost URL must never be presented as if valid for Meta
    assert "127.0.0.1" not in data["webhook_url"]
    assert data["local_backend_url"]  # diagnostic field is still populated
    public_webhook_category = next(c for c in data["setup_categories"] if c["key"] == "public_webhook")
    assert public_webhook_category["ready"] is False


def test_webhook_url_uses_public_base_url_when_configured(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://researcher-briefing-highways-holes.trycloudflare.com/")
    suffix = uuid.uuid4().hex[:8]
    admin_headers = _make_admin_headers(client, suffix)
    response = client.get(f"{API}/admin/whatsapp/settings", headers=admin_headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["webhook_url"] == (
        "https://researcher-briefing-highways-holes.trycloudflare.com/api/integrations/whatsapp/webhook"
    )
    assert data["webhook_url_configured"] is True


def test_test_connection_success_caches_business_number(client, monkeypatch):
    suffix = uuid.uuid4().hex[:8]
    admin_headers = _make_admin_headers(client, suffix)
    monkeypatch.setattr(
        wa_admin_router.MetaWhatsAppProvider, "get_phone_number_info",
        lambda self: {"display_phone_number": "+201099998888", "verified_name": "RE DECOR & MORE"},
    )
    response = client.post(f"{API}/admin/whatsapp/settings/test-connection", headers=admin_headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["connection_status"] == "connected"
    assert data["business_number"] == "+201099998888"

    follow_up = client.get(f"{API}/admin/whatsapp/settings", headers=admin_headers)
    assert follow_up.json()["business_number"] == "+201099998888"


def test_test_connection_failure_returns_generic_message_never_the_exception_detail(client, monkeypatch):
    def _boom(self):
        raise RuntimeError("connection reset while using token abc123secret")

    suffix = uuid.uuid4().hex[:8]
    admin_headers = _make_admin_headers(client, suffix)
    monkeypatch.setattr(wa_admin_router.MetaWhatsAppProvider, "get_phone_number_info", _boom)
    response = client.post(f"{API}/admin/whatsapp/settings/test-connection", headers=admin_headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["connection_status"] == "error"
    assert data["connection_error"] == wa_admin_router.CONNECTION_ERROR_TEXT
    assert "abc123secret" not in response.text


def test_registered_engineer_counts(client):
    suffix = uuid.uuid4().hex[:8]
    admin_headers = _make_admin_headers(client, suffix)
    with SessionLocal() as session:
        before = session.execute(
            select(func.count()).select_from(User).where(User.account_type == "site_portal")
        ).scalar_one()
        with_phone_before = session.execute(
            select(func.count()).select_from(User)
            .where(User.account_type == "site_portal", User.phone_e164 != "")
        ).scalar_one()
        _make_engineer(session, f"{suffix}-a", f"+2031{_phone_suffix()}", project_ids=[])
        no_phone_user = User(
            id=str(uuid.uuid4()), username=f"wa-nophone-{suffix}", display_name="no phone",
            password_hash=hash_password("Sprint21Passw0rd!"), account_type="site_portal",
            role="site_engineer", active=True, created_at=datetime.now(timezone.utc).isoformat(),
            updated_at=datetime.now(timezone.utc).isoformat(),
        )
        session.add(no_phone_user)
        session.commit()

    response = client.get(f"{API}/admin/whatsapp/settings", headers=admin_headers)
    assert response.status_code == 200
    engineers = response.json()["engineers"]
    assert engineers["total"] == before + 2
    assert engineers["with_phone"] == with_phone_before + 1
