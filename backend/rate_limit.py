"""Sliding-window rate limiter backed by the shared database.

Counts live in the rate_limit_events table, not in process memory, so a
limit holds across every uvicorn worker and every instance (an in-memory
limiter gave each of N workers its own window: up to N x the configured
limit). Keys are stored only as SHA-256 hashes.

Each hit is one short transaction: prune this scope's expired rows, count
the key's rows still inside the window, then record the attempt or reject
it with 429. On PostgreSQL a per-key transaction advisory lock makes the
count exact under concurrency; on SQLite the leading DELETE takes the
single write lock, which serializes hits the same way.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, func, select

try:
    from .database import IS_SQLITE, RateLimitEvent, SessionLocal
except ImportError:  # pragma: no cover - direct backend execution
    from database import IS_SQLITE, RateLimitEvent, SessionLocal


class RateLimiter:
    """Sliding-window limiter keyed by an arbitrary string within a scope."""

    def __init__(self, scope: str, max_events: int, window_seconds: int) -> None:
        self.scope = scope
        self.max_events = max_events
        self.window_seconds = window_seconds

    def _key_hash(self, key: str) -> str:
        return hashlib.sha256(f"{self.scope}\0{key}".encode()).hexdigest()

    def hit(self, key: str, detail: Any) -> None:
        """Record one event for `key`; raise HTTPException(429) if that
        trips the limit. `detail` becomes the response body so each caller
        supplies its own message - this class carries no business copy."""
        key_hash = self._key_hash(key)
        now = time.time()
        cutoff = now - self.window_seconds
        with SessionLocal.begin() as session:
            if not IS_SQLITE:
                session.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(key_hash, 0))))
            session.execute(delete(RateLimitEvent).where(
                RateLimitEvent.scope == self.scope, RateLimitEvent.created_at < cutoff,
            ))
            recent = session.scalar(select(func.count()).select_from(RateLimitEvent).where(
                RateLimitEvent.scope == self.scope, RateLimitEvent.key_hash == key_hash,
            ))
            if recent >= self.max_events:
                raise HTTPException(
                    429, detail, headers={"Retry-After": str(self.window_seconds)},
                )
            session.add(RateLimitEvent(
                id=str(uuid.uuid4()), scope=self.scope, key_hash=key_hash, created_at=now,
            ))

    def reset(self, key: str) -> None:
        with SessionLocal.begin() as session:
            session.execute(delete(RateLimitEvent).where(
                RateLimitEvent.scope == self.scope, RateLimitEvent.key_hash == self._key_hash(key),
            ))

    def clear(self) -> None:
        """Drop all recorded events in this scope. Not used by production
        request paths - only for test isolation between test cases that
        share a module-level limiter instance."""
        with SessionLocal.begin() as session:
            session.execute(delete(RateLimitEvent).where(RateLimitEvent.scope == self.scope))
