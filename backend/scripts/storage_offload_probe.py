"""Measure whether slow attachment storage stalls unrelated ERP requests.

Runs the real ASGI app under uvicorn (one worker, like Render) with the
attachment storage replaced by an in-memory fake whose calls block for
--delay seconds - the shape of a slow/hanging boto3 call to R2. While N
attachment uploads or downloads are in flight, it keeps probing two
unrelated routes and reports their latency:

    GET /api/            (no database)
    GET /api/suppliers   (authenticated, database)

If storage calls run on the event loop, every probe queued behind them
waits for the whole storage delay. If they are offloaded, the probes stay
at their idle latency while the attachment requests themselves still take
--delay seconds.

No R2 credentials or network are needed. Uses a throwaway SQLite database
unless --database-url points at a disposable PostgreSQL. Never point it at
a real database: it creates users and requests.

    python scripts/storage_offload_probe.py --delay 2.5 --levels 1 5 10 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import statistics
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

INTERNAL_TOKEN = "storage-probe-internal-token"
PASSWORD = "StorageProbePassw0rd!"
PNG = b"\x89PNG\r\n\x1a\n" + b"storage-probe-image" * 64


def _configure_environment(database_url: str | None) -> tempfile.TemporaryDirectory:
    workdir = tempfile.TemporaryDirectory(prefix="procurex-storage-probe-")
    root = Path(workdir.name)
    os.environ["DATABASE_URL"] = database_url or f"sqlite:///{(root / 'probe.db').as_posix()}"
    os.environ["APP_ENV"] = "development"
    os.environ["ATTACHMENT_STORAGE_BACKEND"] = "local"
    os.environ["INTERNAL_REQUEST_TOKEN"] = INTERNAL_TOKEN
    os.environ["PUBLIC_REQUEST_RATE_LIMIT"] = "100000"
    os.environ["CORS_ORIGINS"] = "http://localhost:3000"
    os.environ["INCOMING_REQUEST_UPLOAD_DIR"] = str(root / "uploads")
    os.environ["PROCUREX_BACKUP_DIR"] = str(root / "backups")
    os.environ["PROCUREX_LOG_DIR"] = str(root / "logs")
    os.environ["DOCUMENT_WORKER_ENABLED"] = "false"
    return workdir


class SlowMemoryStorage:
    """AttachmentStorage stand-in: blocking sleep, then an in-memory op."""

    def __init__(self):
        self.delay = 0.0
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.lock = threading.Lock()
        self.active = 0
        self.peak_active = 0

    def _enter(self):
        with self.lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)

    def _leave(self):
        with self.lock:
            self.active -= 1

    def put(self, key, content, media_type, sha256):
        self._enter()
        try:
            time.sleep(self.delay)
            with self.lock:
                self.objects[key] = (bytes(content), media_type)
        finally:
            self._leave()

    def get(self, key):
        import io
        from attachment_storage import StoredAttachment

        self._enter()
        try:
            time.sleep(self.delay)
            with self.lock:
                if key not in self.objects:
                    raise FileNotFoundError(key)
                content = self.objects[key][0]
        finally:
            self._leave()
        return StoredAttachment(io.BytesIO(content), len(content))

    def delete(self, key):
        self._enter()
        try:
            time.sleep(self.delay)
            with self.lock:
                self.objects.pop(key, None)
        finally:
            self._leave()


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _payload(label: str) -> dict:
    return {
        "requester_name": "Storage Probe", "company_name": "Probe Co",
        "phone_number": "+201001234567", "whatsapp_number": "+201001234567",
        "email": "probe@example.com", "project_name": f"Probe {label}",
        "project_location": "Cairo", "delivery_location": "Gate 1",
        "required_delivery_date": "2099-12-31", "priority": "normal", "notes": "",
        "submission_token": f"probe-{label}-{uuid.uuid4().hex}",
        "items": [{
            "product_name": f"probe item {label} {uuid.uuid4().hex[:8]}",
            "preferred_brand": "", "main_category": "", "subcategory": "",
            "specifications": "", "quantity": 1, "unit": "pcs", "attachment_index": 0,
        }],
    }


def _summary(samples: list[float]) -> dict:
    if not samples:
        return {"n": 0}
    ordered = sorted(samples)
    p95 = ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))]
    return {
        "n": len(ordered),
        "p50_ms": round(statistics.median(ordered) * 1000, 1),
        "p95_ms": round(p95 * 1000, 1),
        "max_ms": round(ordered[-1] * 1000, 1),
    }


async def _probe_until(client, headers, done: asyncio.Event, interval: float) -> dict:
    samples: dict[str, list[float]] = {"root": [], "suppliers": []}
    while not done.is_set():
        for name, path, extra in (("root", "/api/", {}), ("suppliers", "/api/suppliers", headers)):
            start = time.perf_counter()
            response = await client.get(path, headers=extra)
            response.raise_for_status()
            samples[name].append(time.perf_counter() - start)
        try:
            await asyncio.wait_for(done.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
    return {name: _summary(values) for name, values in samples.items()}


async def _run(args) -> dict:
    import httpx

    base = args.base_url
    async with httpx.AsyncClient(base_url=base, timeout=120) as client:
        login = await client.post("/api/auth/login", json={"username": args.username, "password": PASSWORD})
        login.raise_for_status()
        auth = {"Authorization": f"Bearer {login.json()['access_token']}"}
        internal = {**auth, "X-Internal-Token": INTERNAL_TOKEN}

        args.storage.delay = 0.0
        created = await client.post(
            "/api/public/purchase-requests",
            data={"payload": json.dumps(_payload("seed")), "website": ""},
            files=[("attachments", ("seed.png", PNG, "image/png"))],
        )
        created.raise_for_status()
        number = created.json()["request_number"]
        listing = (await client.get("/api/internal/incoming-purchase-requests",
                                    headers=internal, params={"search": number})).json()
        request_id = listing[0]["id"]
        detail = (await client.get(f"/api/internal/incoming-purchase-requests/{request_id}",
                                   headers=internal)).json()
        attachment_id = detail["items"][0]["attachment"]["id"]
        download_path = f"/api/internal/incoming-purchase-requests/{request_id}/attachments/{attachment_id}"

        idle_done = asyncio.Event()
        idle_task = asyncio.create_task(_probe_until(client, auth, idle_done, args.interval))
        await asyncio.sleep(1.0)
        idle_done.set()
        results: dict = {"idle": await idle_task, "delay_s": args.delay, "runs": []}

        args.storage.delay = args.delay

        async def download():
            start = time.perf_counter()
            response = await client.get(download_path, headers=internal)
            ok = response.status_code == 200 and response.content == PNG
            return ok, time.perf_counter() - start

        async def upload():
            start = time.perf_counter()
            response = await client.post(
                "/api/public/purchase-requests",
                data={"payload": json.dumps(_payload("upload")), "website": ""},
                files=[("attachments", ("probe.png", PNG, "image/png"))],
            )
            return response.status_code == 200, time.perf_counter() - start

        for operation, fn in (("download", download), ("upload", upload)):
            for level in args.levels:
                args.storage.peak_active = 0
                done = asyncio.Event()
                probe = asyncio.create_task(_probe_until(client, auth, done, args.interval))
                wall = time.perf_counter()
                outcomes = await asyncio.gather(*(fn() for _ in range(level)))
                wall = time.perf_counter() - wall
                done.set()
                unrelated = await probe
                results["runs"].append({
                    "operation": operation, "concurrency": level,
                    "succeeded": sum(1 for ok, _ in outcomes if ok),
                    "attachment_request": _summary([elapsed for _, elapsed in outcomes]),
                    "wall_s": round(wall, 2),
                    "peak_concurrent_storage_calls": args.storage.peak_active,
                    "threads_after": threading.active_count(),
                    "unrelated": unrelated,
                })
        return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--delay", type=float, default=2.5)
    parser.add_argument("--levels", type=int, nargs="+", default=[1, 5, 10, 20])
    parser.add_argument("--interval", type=float, default=0.1)
    parser.add_argument("--database-url", default=None,
                        help="disposable database only; default is a throwaway SQLite file")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    import logging
    logging.getLogger("httpx").setLevel(logging.WARNING)
    workdir = _configure_environment(args.database_url)
    import uvicorn

    import attachment_storage
    from auth.models import User
    from auth.security import hash_password
    from database import SessionLocal
    from server import app

    args.storage = SlowMemoryStorage()
    attachment_storage._storage = args.storage
    args.username = f"storage-probe-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as session:
        session.add(User(
            id=str(uuid.uuid4()), username=args.username, display_name=args.username,
            password_hash=hash_password(PASSWORD), account_type="erp", role="admin",
            active=True, created_at=_now(), updated_at=_now(),
        ))
        session.commit()

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 30
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    args.base_url = f"http://127.0.0.1:{port}"
    try:
        results = asyncio.run(_run(args))
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        workdir.cleanup()

    if args.json:
        print(json.dumps(results, indent=2))
        return 0
    idle = results["idle"]
    print(f"storage delay per call: {results['delay_s']}s")
    print(f"idle unrelated latency: root p50={idle['root']['p50_ms']}ms "
          f"suppliers p50={idle['suppliers']['p50_ms']}ms")
    print(f"{'op':9}{'N':>4}{'ok':>4}{'attach_max_s':>14}{'peak_calls':>12}"
          f"{'root_p50':>10}{'root_max':>10}{'sup_p50':>10}{'sup_max':>10}")
    for run in results["runs"]:
        unrelated = run["unrelated"]
        print(f"{run['operation']:9}{run['concurrency']:>4}{run['succeeded']:>4}"
              f"{run['attachment_request']['max_ms'] / 1000:>14.2f}{run['peak_concurrent_storage_calls']:>12}"
              f"{unrelated['root'].get('p50_ms', 0):>10}{unrelated['root'].get('max_ms', 0):>10}"
              f"{unrelated['suppliers'].get('p50_ms', 0):>10}{unrelated['suppliers'].get('max_ms', 0):>10}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
