"""Password hashing and stateless bearer-token helpers.

Auth mechanism: signed JWT (HS256) sent as ``Authorization: Bearer <token>``.
Chosen over a server session/cookie because ProcureX will soon serve two
separate frontend surfaces (internal ERP and the Site Request Portal, added
in Sprint 2.4) that may run on different origins during development; a
bearer token avoids cross-origin cookie/credentials configuration entirely
and needs no server-side session store (no Redis, per the phase brief).

There is deliberately no refresh-token flow: tokens are short-lived-ish
(default 12h, AUTH_TOKEN_EXPIRES_MINUTES) and logout is client-side token
disposal. Because a JWT is stateless, `active` is re-checked against the
database on every authenticated request (see auth/service.py) so a
deactivated account loses access immediately, not only at next login.
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "procurex-auth"
MIN_PASSWORD_LENGTH = 10

_secret_cache: str | None = None


def _secret_key() -> str:
    global _secret_cache
    if _secret_cache is not None:
        return _secret_cache
    configured = os.getenv("AUTH_SECRET_KEY", "").strip()
    if configured:
        _secret_cache = configured
        return _secret_cache
    environment = os.getenv("APP_ENV", "development").strip().lower()
    if environment in {"staging", "production"}:
        raise RuntimeError(f"AUTH_SECRET_KEY must be set in {environment}")
    # Local/test convenience only: tokens simply stop validating across a
    # process restart, which is an acceptable dev-time tradeoff and is never
    # reachable once APP_ENV is staging/production (checked above).
    _secret_cache = secrets.token_hex(32)
    return _secret_cache


def _token_ttl_minutes() -> int:
    return int(os.getenv("AUTH_TOKEN_EXPIRES_MINUTES", "720"))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(*, user_id: str, username: str, account_type: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "username": username,
        "account_type": account_type,
        "role": role,
        "iss": JWT_ISSUER,
        "iat": now,
        "exp": now + timedelta(minutes=_token_ttl_minutes()),
    }
    return jwt.encode(payload, _secret_key(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(
        token, _secret_key(), algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER,
    )
