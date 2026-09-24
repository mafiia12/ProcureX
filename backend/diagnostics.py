"""Lightweight per-request performance diagnostics.

Tracks wall-clock request duration, SQL query count/time (via SQLAlchemy
engine events), and outbound external-HTTP time, keyed per-request with
contextvars so concurrent requests never cross-contaminate each other's
counters. Intentionally cheap: a handful of perf_counter() calls and float
additions per query/request - no I/O, no locks beyond what logging already
does.

Never logs query parameters, SQL literal values, headers, bodies, or query
strings - only counts, durations, method, and route path.
"""

from __future__ import annotations

import contextvars
import time
from dataclasses import dataclass, field

_query_count: contextvars.ContextVar[list] = contextvars.ContextVar(
    "procurex_db_query_count", default=None
)
_db_time_ms: contextvars.ContextVar[list] = contextvars.ContextVar(
    "procurex_db_time_ms", default=None
)
_external_time_ms: contextvars.ContextVar[list] = contextvars.ContextVar(
    "procurex_external_time_ms", default=None
)
_external_count: contextvars.ContextVar[list] = contextvars.ContextVar(
    "procurex_external_count", default=None
)


def reset_request_metrics() -> None:
    """Call once at the start of each inbound request."""
    _query_count.set([0])
    _db_time_ms.set([0.0])
    _external_time_ms.set([0.0])
    _external_count.set([0])


def record_query(duration_ms: float) -> None:
    counter = _query_count.get()
    total = _db_time_ms.get()
    if counter is None or total is None:
        return  # No request in flight (e.g. background worker thread) - fine to drop.
    counter[0] += 1
    total[0] += duration_ms


def record_external(duration_ms: float) -> None:
    counter = _external_count.get()
    total = _external_time_ms.get()
    if counter is None or total is None:
        return
    counter[0] += 1
    total[0] += duration_ms


@dataclass
class RequestMetrics:
    db_query_count: int = 0
    db_time_ms: float = 0.0
    external_call_count: int = 0
    external_time_ms: float = 0.0


def snapshot() -> RequestMetrics:
    q = _query_count.get()
    t = _db_time_ms.get()
    ec = _external_count.get()
    et = _external_time_ms.get()
    return RequestMetrics(
        db_query_count=q[0] if q else 0,
        db_time_ms=round(t[0], 2) if t else 0.0,
        external_call_count=ec[0] if ec else 0,
        external_time_ms=round(et[0], 2) if et else 0.0,
    )


class timed_external:
    """Context manager: `with timed_external(): httpx.post(...)`.

    Records elapsed wall time against the current request's external-call
    budget regardless of success/failure, so a timeout still counts.
    """

    def __enter__(self):
        self._start = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb):
        record_external((time.perf_counter() - self._start) * 1000)
        return False
