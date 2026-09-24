"""ProcureX capacity/load-test harness (read-only by default).

Drives a weighted, realistic ERP workload against ONE disposable backend
and prints a JSON summary per concurrency stage. See
docs/production-capacity-plan.md for how the published numbers were made.

Safety rules, enforced in code:
- Refuses any target that is not loopback unless --allow-host names it
  explicitly, and always refuses hostnames that look like production
  (onrender.com without "staging", or anything in PRODUCTION_HOST_MARKERS).
- Read-only unless BOTH --writes and --i-understand-this-writes-data are
  given. Writes create items and small PO payments; point them only at a
  disposable database.
- Never prints tokens, passwords, or response bodies.

Example (disposable backend on :8020):

    LOADTEST_USERNAME=loadtest-admin LOADTEST_PASSWORD=... \
    python scripts/load_test.py --base-url http://127.0.0.1:8020 \
        --stages 1,5,10,20,50 --stage-seconds 30 --json-out results.json

Optional sampling (both read-only):
    --server-pid <uvicorn parent pid>   RSS/CPU of the process tree (psutil)
    --pg-url postgresql://...           connection counts from pg_stat_activity
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import statistics
import sys
import time
import uuid
from collections import Counter, defaultdict
from urllib.parse import urlparse

import httpx

PRODUCTION_HOST_MARKERS = ("procurex-erp-api", "procurex-public-api", "redecor")
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

# Weights reflect how the ERP frontend actually loads pages (see
# frontend/src/pages): dashboard and the request register dominate; detail
# views follow list views; master-data lookups are occasional.
READ_MIX = [
    ("dashboard", 15, lambda ids: "/api/dashboard"),
    ("requests_list", 12, lambda ids: "/api/internal/incoming-purchase-requests?limit=50"),
    ("request_detail", 10, lambda ids: f"/api/internal/incoming-purchase-requests/{ids.pick('request')}"),
    ("unread_count", 5, lambda ids: "/api/internal/incoming-purchase-requests/notifications/unread-count"),
    ("action_summary", 5, lambda ids: "/api/workflow/action-summary"),
    ("rfq_list", 6, lambda ids: "/api/workflow/rfqs"),
    ("rfq_detail", 4, lambda ids: f"/api/workflow/rfqs/{ids.pick('rfq')}"),
    ("comparison_list", 5, lambda ids: "/api/price-comparisons"),
    ("comparison_detail", 5, lambda ids: f"/api/price-comparisons/{ids.pick('comparison')}"),
    ("approval_list", 5, lambda ids: "/api/workflow/approvals"),
    ("approval_detail", 5, lambda ids: f"/api/workflow/approvals/{ids.pick('approval')}"),
    ("po_list", 5, lambda ids: "/api/purchase-orders"),
    ("po_detail", 3, lambda ids: f"/api/purchase-orders/{ids.pick('po')}"),
    ("po_payments", 3, lambda ids: f"/api/purchase-orders/{ids.pick('po')}/payments"),
    ("suppliers", 4, lambda ids: "/api/suppliers"),
    ("items", 3, lambda ids: "/api/items"),
    ("projects", 3, lambda ids: "/api/projects"),
    ("daily_report", 2, lambda ids: "/api/reports/daily"),
]


class Ids:
    def __init__(self):
        self.pools: dict[str, list[str]] = defaultdict(list)

    def pick(self, kind: str) -> str:
        values = self.pools.get(kind) or ["missing"]
        return random.choice(values)


def _refuse_unsafe_target(base_url: str, allowed: set[str]) -> None:
    host = (urlparse(base_url).hostname or "").lower()
    if any(marker in host for marker in PRODUCTION_HOST_MARKERS) or (
        host.endswith("onrender.com") and "staging" not in host
    ):
        raise SystemExit(f"refusing: {host} looks like production")
    if host not in LOOPBACK_HOSTS and host not in allowed:
        raise SystemExit(f"refusing: {host} is not loopback; pass --allow-host {host} if it is disposable")


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(pct / 100 * (len(ordered) - 1))))
    return ordered[index]


async def _discover(client: httpx.AsyncClient, headers: dict) -> Ids:
    ids = Ids()

    async def collect(kind, path, key="id"):
        response = await client.get(path, headers=headers)
        if response.status_code != 200:
            return
        rows = response.json()
        if isinstance(rows, dict):  # list endpoints wrap rows under differing keys
            rows = next((v for v in rows.values() if isinstance(v, list)), [])
        ids.pools[kind] = [row[key] for row in rows if isinstance(row, dict) and row.get(key)][:200]

    await collect("request", "/api/internal/incoming-purchase-requests?limit=200")
    await collect("rfq", "/api/workflow/rfqs")
    await collect("comparison", "/api/price-comparisons")
    await collect("approval", "/api/workflow/approvals")
    await collect("po", "/api/purchase-orders")
    return ids


class Sampler:
    """Background, read-only sampling of server RSS/CPU and DB connections."""

    def __init__(self, server_pids: list[int] | None, pg_url: str | None):
        self.server_pids = server_pids or []
        self.pg_url = pg_url
        self.samples: list[dict] = []
        self._stop = asyncio.Event()
        self._procs: dict = {}  # cpu_percent() needs the same Process object across calls

    def _sample(self) -> dict:
        sample: dict = {"t": time.time()}
        if self.server_pids:
            import psutil

            try:
                procs = []
                for pid in self.server_pids:
                    parent = psutil.Process(pid)
                    for proc in [parent, *parent.children(recursive=True)]:
                        procs.append(self._procs.setdefault(proc.pid, proc))
                sample["rss_mb"] = sum(p.memory_info().rss for p in procs) / 1048576
                # Percent of ONE core, summed over processes (200 = two full cores).
                sample["cpu_pct"] = sum(p.cpu_percent(None) for p in procs)
                sample["procs"] = len(procs)
            except psutil.Error:
                pass
        if self.pg_url:
            import psycopg

            try:
                with psycopg.connect(self.pg_url, autocommit=True, connect_timeout=3) as conn:
                    rows = conn.execute(
                        "SELECT coalesce(state,'?'), count(*) FROM pg_stat_activity "
                        "WHERE datname = current_database() AND pid <> pg_backend_pid() "
                        "AND backend_type = 'client backend' GROUP BY 1"
                    ).fetchall()
                    sample["db_conn"] = {state: count for state, count in rows}
                    sample["db_waiting_locks"] = conn.execute(
                        "SELECT count(*) FROM pg_locks WHERE NOT granted"
                    ).fetchone()[0]
            except Exception as exc:  # sampling must never break the run
                sample["db_error"] = type(exc).__name__
        return sample

    async def run(self, interval: float = 1.0) -> None:
        while not self._stop.is_set():
            self.samples.append(await asyncio.to_thread(self._sample))
            try:
                await asyncio.wait_for(self._stop.wait(), interval)
            except asyncio.TimeoutError:
                pass

    def stop(self) -> None:
        self._stop.set()

    def summarize(self, start: float, end: float) -> dict:
        window = [s for s in self.samples if start <= s["t"] <= end]
        out: dict = {}
        rss = [s["rss_mb"] for s in window if "rss_mb" in s]
        cpu = [s["cpu_pct"] for s in window if "cpu_pct" in s]
        if rss:
            out.update(rss_mb_avg=round(statistics.mean(rss), 1), rss_mb_peak=round(max(rss), 1))
        if cpu:
            out.update(cpu_pct_avg=round(statistics.mean(cpu), 1), cpu_pct_peak=round(max(cpu), 1))
        conns = [sum(s["db_conn"].values()) for s in window if "db_conn" in s]
        active = [s["db_conn"].get("active", 0) for s in window if "db_conn" in s]
        if conns:
            out.update(db_conn_peak=max(conns), db_active_peak=max(active),
                       db_lock_waits_peak=max(s.get("db_waiting_locks", 0) for s in window if "db_conn" in s))
        return out


async def _virtual_user(client, headers, ids, mix, deadline, results, write_ratio, write_state, timeout):
    names = [m[0] for m in mix]
    weights = [m[1] for m in mix]
    builders = {m[0]: m[2] for m in mix}
    while time.perf_counter() < deadline:
        if write_ratio and random.random() < write_ratio:
            name, method, path, body = _next_write(ids, write_state)
        else:
            name = random.choices(names, weights)[0]
            method, path, body = "GET", builders[name](ids), None
        started = time.perf_counter()
        try:
            response = await client.request(method, path, headers=headers, json=body, timeout=timeout)
            status = response.status_code
        except httpx.TimeoutException:
            status = "timeout"
        except httpx.HTTPError as exc:
            status = type(exc).__name__
        results.append((name, status, (time.perf_counter() - started) * 1000))


def _next_write(ids: Ids, state: dict):
    state["n"] += 1
    if state["n"] % 2:
        token = uuid.uuid4().hex[:10]
        return ("write_item", "POST", "/api/items", {
            "product_name": f"loadtest item {token}", "unit": "piece",
            "main_category": "loadtest", "specifications": token,
        })
    return ("write_payment", "POST", f"/api/purchase-orders/{ids.pick('po')}/payments", {
        "payment_date": "2026-09-01", "amount": 0.01, "payment_method": "bank_transfer",
        "payment_reference": "loadtest", "idempotency_key": f"lt-{uuid.uuid4().hex}",
    })


async def _stage(base_urls, headers, ids, concurrency, seconds, write_ratio, timeout, mix):
    results: list = []
    limits = httpx.Limits(max_connections=concurrency + 5, max_keepalive_connections=concurrency + 5)
    # Several base URLs = several independent instances; virtual users are
    # spread round-robin across them (a stand-in for a load balancer).
    clients = [httpx.AsyncClient(base_url=url, limits=limits, timeout=timeout) for url in base_urls]
    try:
        deadline = time.perf_counter() + seconds
        write_state = {"n": 0}
        started = time.time()
        await asyncio.gather(*[
            _virtual_user(clients[n % len(clients)], headers, ids, mix, deadline, results,
                          write_ratio, write_state, timeout)
            for n in range(concurrency)
        ])
        ended = time.time()
    finally:
        for client in clients:
            await client.aclose()
    latencies = [r[2] for r in results]
    statuses = Counter(str(r[1]) for r in results)
    ok = sum(v for k, v in statuses.items() if k.isdigit() and int(k) < 400)
    per_endpoint = {}
    for name in sorted({r[0] for r in results}):
        values = [r[2] for r in results if r[0] == name]
        per_endpoint[name] = {"n": len(values), "p50": round(_percentile(values, 50), 1),
                              "p95": round(_percentile(values, 95), 1)}
    return {
        "concurrency": concurrency, "seconds": round(ended - started, 1), "requests": len(results),
        "rps": round(len(results) / max(ended - started, 0.001), 1),
        "p50_ms": round(_percentile(latencies, 50), 1), "p95_ms": round(_percentile(latencies, 95), 1),
        "p99_ms": round(_percentile(latencies, 99), 1), "max_ms": round(max(latencies, default=0), 1),
        "error_rate_pct": round(100 * (len(results) - ok) / max(len(results), 1), 2),
        "timeouts": statuses.get("timeout", 0), "statuses": dict(statuses),
        "per_endpoint": per_endpoint, "_window": (started, ended),
    }


async def main_async(args) -> dict:
    base_urls = [url.strip() for url in args.base_url.split(",") if url.strip()]
    for url in base_urls:
        _refuse_unsafe_target(url, set(args.allow_host or []))
    if args.writes and not args.i_understand_this_writes_data:
        raise SystemExit("--writes also requires --i-understand-this-writes-data (disposable DB only)")
    username = os.getenv("LOADTEST_USERNAME", "")
    password = os.getenv("LOADTEST_PASSWORD", "")
    if not username or not password:
        raise SystemExit("set LOADTEST_USERNAME and LOADTEST_PASSWORD")
    async with httpx.AsyncClient(base_url=base_urls[0], timeout=30) as client:
        login = await client.post("/api/auth/login", json={"username": username, "password": password})
        if login.status_code != 200:
            raise SystemExit(f"login failed: HTTP {login.status_code}")
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        ids = await _discover(client, headers)
    mix = READ_MIX
    if args.only:
        mix = [m for m in READ_MIX if m[0] in set(args.only.split(","))]
    sampler = Sampler(args.server_pid, args.pg_url)
    sampler_task = asyncio.create_task(sampler.run())
    stages = []
    try:
        for concurrency in [int(c) for c in args.stages.split(",")]:
            stage = await _stage(base_urls, headers, ids, concurrency, args.stage_seconds,
                                 args.write_ratio if args.writes else 0.0, args.timeout, mix)
            stage.update(sampler.summarize(*stage.pop("_window")))
            stages.append(stage)
            print(json.dumps({k: v for k, v in stage.items() if k != "per_endpoint"}), flush=True)
            if args.pause:
                await asyncio.sleep(args.pause)
    finally:
        sampler.stop()
        await sampler_task
    return {"base_url": args.base_url, "label": args.label, "writes": bool(args.writes),
            "discovered": {k: len(v) for k, v in ids.pools.items()}, "stages": stages,
            "samples": sampler.samples if args.keep_samples else None}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True, help="one URL, or several comma-separated instances")
    parser.add_argument("--allow-host", action="append", help="non-loopback host known to be disposable")
    parser.add_argument("--stages", default="1,5,10,20,50")
    parser.add_argument("--stage-seconds", type=float, default=30)
    parser.add_argument("--pause", type=float, default=3, help="idle seconds between stages")
    parser.add_argument("--timeout", type=float, default=30, help="client timeout (matches frontend's 30s)")
    parser.add_argument("--only", help="comma-separated endpoint names from the mix")
    parser.add_argument("--writes", action="store_true")
    parser.add_argument("--i-understand-this-writes-data", action="store_true")
    parser.add_argument("--write-ratio", type=float, default=0.05)
    parser.add_argument("--server-pid", type=int, action="append", help="repeat for several instances")
    parser.add_argument("--pg-url")
    parser.add_argument("--label", default="")
    parser.add_argument("--keep-samples", action="store_true")
    parser.add_argument("--json-out")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    result = asyncio.run(main_async(args))
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
