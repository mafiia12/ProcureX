"""Staging-only diagnostics: visitor address resolution and worker runtime.

/client-ip - how does this deployment see a visitor's address?

Answers the question the rate limiters depend on - does request.client.host
differ per visitor behind the platform proxy, and which X-Forwarded-For
entry is the proxy's own - without exposing addresses: every value is
reduced to a kind (loopback/private/public/invalid) plus a short salted
fingerprint, so two devices can be compared but not identified.

/runtime - which worker process served the request (sample it repeatedly to
count distinct workers), the statement/lock timeouts the database actually
applies to this app's connections, and the connection-pool status.

Mounted only when CLIENT_IP_DIAGNOSTICS=true (never in production;
server.py refuses that combination).
"""

from __future__ import annotations

import ipaddress
import os

from fastapi import APIRouter, Request
from sqlalchemy import text

try:
    from .database import IS_SQLITE, SessionLocal, engine
    from .incoming_requests import _client_ip, _hash_private, _trusted_proxy_hops
except ImportError:  # pragma: no cover - direct backend execution
    from database import IS_SQLITE, SessionLocal, engine
    from incoming_requests import _client_ip, _hash_private, _trusted_proxy_hops

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])


def _describe(value: str) -> dict:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        kind = "invalid"
    else:
        kind = "loopback" if address.is_loopback else "private" if address.is_private else "public"
    return {"kind": kind, "fingerprint": _hash_private(value)[:10]}


@router.get("/client-ip")
def client_ip_diagnostics(request: Request) -> dict:
    forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    real_ip = request.headers.get("x-real-ip", "").strip()
    return {
        "peer": _describe(request.client.host) if request.client else None,
        "x_forwarded_for": [_describe(part) for part in forwarded],
        "x_real_ip": _describe(real_ip) if real_ip else None,
        "trust_proxy_headers": os.getenv("TRUST_PROXY_HEADERS", "").lower() == "true",
        "trusted_proxy_hops": _trusted_proxy_hops(),
        "rate_limit_identity": _describe(_client_ip(request)),
    }


@router.get("/runtime")
def runtime_diagnostics() -> dict:
    timeouts = {}
    if not IS_SQLITE:
        with SessionLocal() as session:
            timeouts = {
                "statement_timeout": session.execute(text("SHOW statement_timeout")).scalar(),
                "lock_timeout": session.execute(text("SHOW lock_timeout")).scalar(),
            }
    return {"worker_pid": os.getpid(), "db_timeouts": timeouts, "pool": engine.pool.status()}
