"""Reusable in-memory sliding-window rate limiter.

Per-process, in-memory state: correct for a single running instance. If
ProcureX is ever scaled to more than one worker/instance, every limiter here
needs to move to shared state (e.g. Redis) - each process otherwise enforces
its own independent window, so an attacker split across instances would see
a higher effective limit than configured.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import HTTPException


class RateLimiter:
    """Sliding-window limiter keyed by an arbitrary string."""

    def __init__(self, max_events: int, window_seconds: int) -> None:
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, detail: Any) -> None:
        """Record one event for `key`; raise HTTPException(429) if that
        trips the limit. `detail` becomes the response body so each caller
        supplies its own message - this class carries no business copy."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] < cutoff:
                events.popleft()
            if len(events) >= self.max_events:
                raise HTTPException(
                    429, detail, headers={"Retry-After": str(self.window_seconds)},
                )
            events.append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)

    def clear(self) -> None:
        """Drop all recorded events for every key. Not used by production
        request paths - only for test isolation between test cases that
        share a module-level limiter instance."""
        with self._lock:
            self._events.clear()
