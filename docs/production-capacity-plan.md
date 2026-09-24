# ProcureX Production Capacity Plan

**Date:** 2026-09-24 · **Branches:** `fix/pre-golive-hardening` (capacity review), `fix/pre-golive-closure` (closure fixes, sections 13–15) · **Companion to:** `docs/performance-reliability-audit.md` (section "Production Concurrency & Scaling")

> **Status.** Every throughput, latency and user-count figure in sections 4, 8 and 10 was measured on a **Windows laptop**, not on Render. They are **not production capacity**. Production capacity comes from the Render staging run in section 15, which is **PENDING** (it needs this branch deployed to staging and the Render facts in section 11).

Every number below was measured. Where a fact could not be measured from this environment (Render plan resources, Render proxy timeouts, the production Postgres `max_connections`), it is marked **UNKNOWN** and listed under [Render facts still required](#render-facts-still-required).

---

## 1. Test environment and safety

| | |
|---|---|
| Database | Disposable PostgreSQL 16.15 cluster (embedded binaries, scratch directory, `127.0.0.1:55432`, `max_connections=100`, `pg_stat_statements` on the disposable DB only). Never the production or staging database. |
| Schema | Fresh `alembic upgrade head` (0001 → 0023) followed by `scripts/assert_schema_current.py`. Passed. |
| Data | Seeded **through the real API**: 200 complete REQ → CMP → APR → PO → payment → receipt chains, 40 RFQ chains, 240 REQs, 317 suppliers, 2,015 items. |
| App | Real `uvicorn server:app`, production requirements (`requirements-production.txt`: FastAPI 0.110.1, uvicorn 0.25.0, SQLAlchemy 2.0.36, psycopg 3.2.10), `APP_SURFACE=full`, local attachment storage in a scratch dir, WhatsApp disabled with empty credentials (no Meta/R2 calls). The real `backend/.env`, DB, attachments, backups and logs were never read or written. |
| Hardware | Windows 11 laptop, Intel i7-8665U (4 cores / 8 threads, 1.9 GHz), 15.8 GB RAM. The load generator ran on the same machine. **These are not Render numbers.** Run-to-run variance on this laptop was about ±30% (thermal), so throughput is quoted as ranges. |
| Harness | `backend/scripts/load_test.py` (committed, see [section 12](#12-re-running-the-harness)). Weighted realistic mix: 15% dashboard, 12% request register, 10% REQ detail, 10% RFQ, 10% comparisons, 10% approvals, 11% POs and PO payments, 10% master data, 5% action summary, 5% notifications, 2% daily report. Zero think time: *N users* means *N requests always in flight*. |

---

## 2. Deployment architecture (from the repo)

| Service | Entrypoint | Command (after this change) | Workers | CPU / RAM | Database | Attachments | Role |
|---|---|---|---|---|---|---|---|
| `procurex-public-api` | `server:app`, `APP_SURFACE=public` | `uvicorn … --proxy-headers --timeout-keep-alive 65 --timeout-graceful-shutdown 20` | `WEB_CONCURRENCY=1` (was: implicit 1) | Render `starter`: **UNKNOWN** in repo | shared Postgres `procurex-public-postgres` (`basic-256mb`) | R2/S3 | Public: anonymous intake form and Meta WhatsApp webhook target |
| `procurex-erp-api` | `server:app`, `APP_SURFACE=full` | same | `WEB_CONCURRENCY=2` (was: implicit 1) | Render `starter`: **UNKNOWN** | same shared Postgres | R2/S3 | Private: staff ERP |
| `procurex-public-form`, `procurex-erp-app` | static builds | n/a | n/a | n/a | n/a | n/a | Frontends |
| `procurex-postgres-backup` | Docker cron | `pg_dump` daily | 1 | `starter`: **UNKNOWN** | same Postgres (1 connection) | R2 backup bucket | Backup |
| Migrations | `deploy/migrate/Dockerfile` → `verified_production_migration.py` | run once, manually | 1 | n/a | same Postgres | n/a | Release step |
| Staging (`render.staging.yaml`) | same pair, plan `free` | same, prefixed by the read-only `assert_schema_current.py` | public 1 / ERP 2 | **UNKNOWN** | staging Postgres (`DATABASE_URL` set manually) | R2/S3 | Staging |
| Local desktop | `launcher/ProcureXLauncher.exe` → `uvicorn server:app --host 127.0.0.1 --port 8000` | unchanged | 1 | local | **SQLite** `backend/procurement.db` | local disk | Desktop |

**Databases:** LOCAL_DESKTOP = SQLite; STAGING = PostgreSQL; PRODUCTION_FULL_ERP = PostgreSQL; PRODUCTION_PUBLIC = PostgreSQL (the same database as the ERP). Production is **PostgreSQL**, and hosted startup refuses anything else for the public surface.

---

## 3. The architectural fact that governs capacity

Nearly every ERP route in `server.py`, and the `db.*` wrapper in `database.py`, is `async def` but runs **synchronous SQLAlchemy directly on the event loop**. The consequences, all measured:

- One worker executes that work one request at a time, so **throughput per worker is capped by one CPU core** (~17–25 req/s for this mix). The database is not the limit: Postgres never had more than 4 *active* connections in any run, and the busiest statement totalled 214 ms of DB time in 30 s at 10 users.
- A slow request in an async route **stalls every other request on that worker**.
- A DB lock wait inside an async route **freezes the whole worker** for the duration of the wait. It was unbounded before this change.

Sync `def` routes (`procurement_workflow.py`, `rfq.py`, `price_comparisons.py`, `site_portal.py`, auth) run in the thread pool, can hold several connections at once, and **can race each other even on a single worker**.

Moving the async routes to `def` (or real async DB access) is the long-term fix. It is a large refactor, so it was **not** done here. Worker count is the lever for now.

---

## 4. Measured results

### 4.1 Worker scaling (uvicorn `--workers`, keep-alive 65 s, pool 5/10/30 s)

| Users | 1 worker: RPS / p95 / p99 | 2 workers: RPS / p95 / p99 | 4 workers: RPS / p95 / p99 | 4 separate processes: RPS / p95 |
|---|---|---|---|---|
| 1 | 19.1 / 203 / 265 ms | 21.1 / 172 / 223 ms | 21.2 / 183 / 215 ms | n/a |
| 5 | 17.5 / 651 / 993 ms | **32.7 / 469 / 845 ms** | 42.4 / 382 / 600 ms | 49.3 / 361 ms |
| 10 | 13.2 / 1,474 / 2,029 ms | **32.7 / 826 / 1,157 ms** | 42.8 / 545 / 972 ms | 44.0 / 712 ms |
| 20 | 11.1 / 2,738 / 3,465 ms | 22.4 / 1,763 / 2,182 ms | 38.1 / 1,446 / 2,180 ms | 45.2 / 1,131 ms |
| 50 | 12.1 / 5,924 / 7,135 ms | 24.5 / 3,463 / 4,474 ms | 28.7 / 3,068 / **30,052** ms | 37.6 / 2,362 ms |
| CPU (avg) | ~85–95% (one core) | ~165–195% | ~255–355% | ~320–370% |
| Errors | 0% | 0% | 0.15–1.9% client timeouts (see note) | 0% |

- **CPU saturation:** each worker pins one core at about 5 concurrent users. Throughput grows roughly linearly with workers up to the free cores. On this 4-core machine, with the load generator taking about one core, it flattens at about 45 req/s.
- **Note on 4 × `--workers`:** 33 requests (and 5 in one later 2-worker run) waited the full 30 s client timeout, yet the server logged **no request longer than 4.6 s and no errors**, so they never reached the app. Four *independent* processes carrying the same load had **zero** timeouts. This matches multi-process socket sharing on Windows (uvicorn spawns workers that share one listening socket over the Windows proactor loop). **Linux (Render) must be verified on staging** with the harness before production relies on `--workers`.

### 4.2 Memory per worker (RSS)

| Workers | At start | Peak at 50–75 users | Per worker |
|---|---|---|---|
| 1 | 101 MB | 141–152 MB | ~97 MB idle → ~125–140 MB loaded |
| 2 | 226 MB (incl. 29 MB supervisor) | 286–293 MB | same |
| 4 | 418 MB | 526 MB | same |

The public surface measured 95 MB per worker at start, nearly identical because both surfaces import the full `server` module. Memory stayed flat under overload (+20 MB over the ramp, no growth afterwards), consistent with the earlier soak test (no leak).

**Rule:** workers ≤ (plan RAM × 0.7 − 30 MB) / 140 MB. For example, 512 MB → 2 workers, 1 GB → 4 workers. The plan's RAM is **UNKNOWN**; see [section 11](#render-facts-still-required).

### 4.3 Slow-request isolation

5 users on light pages (PO detail, REQ detail, notification count, PO payments), alone and then with 2 users continuously hitting the heaviest endpoints (approvals list, dashboard, daily report):

| | Light p95 alone | Light p95 with heavy users | Light throughput |
|---|---|---|---|
| 1 worker | 58 ms | **471 ms (8×)** | 122 → 20 req/s |
| 2 workers | 45 ms | **81 ms (1.8×)** | 170 → 81 req/s |

**SLOW_REQUEST_ISOLATION: 1 worker = FAIL, 2 workers = PASS.**

### 4.4 Pool size, overflow, pool exhaustion

- **Pool size:** with `pool_size=1, max_overflow=0`, 20 users on connection-holding thread-pool routes ran with **no pool waits** (27.6 req/s). Connections are held for milliseconds, so an HTTP request does not need a connection for its whole lifetime.
- **Overflow** (2 workers; 20 / 50 users): overflow 0 → 23.7 / 23.3 req/s; 5 → 21.9 / 21.8; 10 → 22.1 / 19.1. p95 was no better with more overflow. Higher overflow only opened more connections. Overflow is a burst margin, not capacity.
- **Exhaustion via a stuck lock** (another session held `ACCESS EXCLUSIVE` on `engineer_approvals` for 15 s):
  - Before: no pool timeout ever fired, because the **worker froze instead**. A PO-detail query (async route) waited on the lock while blocking the event loop, so *every* request on that worker took 15.3 s, including ones needing 4 ms of DB time. Nothing bounded it.
  - After (`lock_timeout`, `statement_timeout`, 503 mapping): lock waiters fail with `55P03` → **503 + `Retry-After: 5`**, worst request 15.5 s → 10.4 s, and the worker recovers as soon as the lock clears. Consecutive lock waits on one event loop still add up (5 s + 5 s in that run), which is why `DB_LOCK_TIMEOUT_MS` is now 3000.
- **Connection return / leaks:** after every run, app connections returned to 0 once the server stopped. During idle they settled at pool size, and overflow connections closed on return.

### 4.5 PostgreSQL under concurrency

`pg_stat_statements` at 10 users, 30 s: top statement (full `items` list) totalled 214 ms, mean 4.5 ms. Every application statement in every run finished in under 200 ms (`log_min_duration_statement=200` logged none). **0 lock waits** in all normal runs, including 5% writes. Sequential scans come from the unbounded list endpoints over small tables. The largest cost is the N+1 in `GET /api/workflow/approvals`: 3,773 `approval_payments` lookups in 30 s, and 203 queries / 415–565 ms of DB time per call at 200 approvals. That holds a thread-pool connection the whole time and grows with data. It is the top query-level follow-up (not fixed here: pure performance, out of this sprint's scope).

### 4.6 Overload and recovery (recommended config: 2 workers, pool 5/2/5 s, keep-alive 65)

| Users | RPS | p50 | p95 | p99 | Errors | RSS peak | DB conns |
|---|---|---|---|---|---|---|---|
| 5 | 23.8 | 84 ms | 701 ms | 1,095 ms | 0% | 273 MB | 7 |
| 20 | 23.8 | 782 ms | 1,594 ms | 2,020 ms | 0% | 279 MB | 14 |
| 30 | 23.4 | 1,222 ms | 2,140 ms | 2,907 ms | 0% | 282 MB | 13 |
| 40 | 24.5 | 1,518 ms | 2,667 ms | 3,075 ms | 0% | 285 MB | 12 |
| 50 | 22.7 | 2,016 ms | 3,490 ms | 4,281 ms | 0% | 290 MB | 13 |
| 75 | 22.0 | 3,049 ms | 5,221 ms | 6,219 ms | 0% | 293 MB | 12 |

Overload shape: throughput flat, latency grows linearly (queueing), memory and connections bounded, no errors, and the 30 s client timeout was never reached. **Recovery:** the first 5-second window after dropping to 5 users was already at baseline (p95 766 ms vs 701 ms). **RECOVERY_TIME ≤ 5 s.**

### 4.7 Graceful shutdown (uvicorn's SIGTERM handler, request in flight)

| Scenario | Result |
|---|---|
| In-flight 3 s request, no graceful timeout | completes (200); new connections refused; exit 3.1 s after SIGTERM; DB connections closed |
| Request stuck on a DB lock, **no** DB timeouts, no graceful timeout | **never exits** (the platform would hard-kill it) |
| Same, `--timeout-graceful-shutdown 20` only | request cancelled at 20 s, but the process **still hangs**: a thread-pool thread is stuck in the unbounded DB call |
| Same lock, **new defaults** (`lock_timeout` 3 s) + graceful 20 s | in-flight gets 503 after 3.3 s; exit **3.2 s** after SIGTERM; connections closed |

**GRACEFUL_SHUTDOWN = PASS**, but only with both layers: DB statement/lock timeouts **and** `--timeout-graceful-shutdown`.

### 4.8 Keep-alive (the 50-user failure mode)

With uvicorn's default `--timeout-keep-alive 5`, 1 worker at 50 users dropped **8.7%** of requests (`RemoteProtocolError`, 43 × `h11 LocalProtocolError` in the server log). The keep-alive timer, delayed by the blocked event loop, fired after the next request had already arrived on that connection and tore it down; behind a proxy this surfaces as a 502. With `--timeout-keep-alive 65`: **0%** errors and 0 protocol errors (p95 6.3 s → 4.1 s). 65 s also keeps the app's idle timeout above the common 60 s load-balancer idle timeout, so the proxy, not the app, closes idle upstream connections. Render's actual upstream idle timeout is **UNKNOWN**.

---

## 5. Concurrency safety (horizontal-scaling gate)

| Check | Method | Result |
|---|---|---|
| Business codes (PO, PAY, APR, RFQ, CMP, ITM, plus a new sequence row) | 2 processes × 8 threads, 2,800 concurrent `reserve_code()` calls on Postgres | **0 duplicates, 0 gaps, 0 lost increments, 0 errors.** REQ numbers are date + UUID hex (no counter). **SAFE** |
| PO payment / receipt, same idempotency key | 10 concurrent, split across 2 instances | 1 row; one loser got a **500**, now **409** |
| Approval from the same comparison | same | 1 row; 9 losers got **500**, now **409** |
| RFQ from the same REQ | same | 1 row; 9 losers got **500**, now **409** |
| Public REQ, same submission token | same | 1 row; 1 loser 500, now **409** |
| **PO from the same comparison** | same | **2 POs**, now **fixed → 1** (row lock on the comparison; 1 worker was already safe because the async route runs serialized) |
| **Corrected-REQ resubmission** | same, **and on a single instance** | **10 → 10 child REQs across 2 instances, 4 on ONE worker**, now **fixed → 1**. Live bug in the current production config (sync route in the thread pool). |
| Document-extraction job claim | 2 processes × 4 threads, 60 queued jobs | **219 claims, 57 jobs processed twice**, now **fixed → 60/60, 0 double** (3/3 runs), via `FOR UPDATE SKIP LOCKED` |
| WhatsApp webhook | 8 threads, own DB connections, router's DB-only `_handle_message` (no Meta calls) | same message id 8× → **2–3 REQs**; 8 different "تأكيد" → **5 REQs**. **Fixed** (section 13.2) → **1 REQ** in both, 3/3 runs, duplicates skipped without errors. **SAFE** |
| Rate limiters (login, public intake) | 2 processes × 8 threads, one key, limit 10 | were per-process memory (N workers = up to N× the limit). **Fixed** (section 13.3): shared DB table, exactly **10 of 80** allowed, 3/3 runs. **SAFE** |
| Document-job stale recovery | 60 jobs left `processing` by a "crashed" worker, 2 processes × 4 threads | **2–3 jobs processed twice per run.** **Fixed** (section 13.5) → 60/60, 0 double, 4/4 runs |
| Closed daily-report cache | code + regression test | per-process, and a reopen elsewhere left other workers serving the pre-reopen body. **Fixed:** keyed by `closed_at`, so it is correct across processes with no shared store. |
| Auth / JWT | code | HS256 with env `AUTH_SECRET_KEY` (mandatory when hosted); the user row, including active flag and role, is re-read on every request. **SAFE.** (Dev without a key: random per-process secret, so never run >1 worker in dev without setting it.) |
| Attachments | `render.yaml` + hosted-startup checks | R2/S3 on both hosted services; hosted public startup refuses anything else. **SAFE** |
| Background tasks | code | only the document worker (one thread per process; `DOCUMENT_EXTRACTION_ENABLED` is not set in `render.yaml`, so off). Its claim is now safe. Backups are a separate Render cron. |
| Migrations | `render.yaml` | `preDeployCommand` is the read-only `assert_schema_current.py`; schema changes run once via `verified_production_migration.py`; app startup never migrates Postgres (`init_db` only checks tables). **SAFE** |

---

## 6. Recommended configuration

### Workers

| Service | `WEB_CONCURRENCY` | Why |
|---|---|---|
| ERP API | **2** | ~2× throughput (32.7 vs 13–17 req/s at 5–10 users), slow-request isolation passes, ~290 MB peak, 14 DB connections. Not 4: memory (~526 MB) and plan CPU are unknown, and 2 already covers expected staff load (section 8). |
| Public API | **1** | Low traffic (rate-limited anonymous form plus webhook). The rate limiter and WhatsApp handling are only correct in one process. |

Per-core throughput, not a CPU×2+1 formula, is the guide: more workers than the plan's real vCPUs add memory and connections without adding throughput.

### PostgreSQL pool (per worker; new code defaults, env-overridable)

| Setting | Value | Reason |
|---|---|---|
| `DB_POOL_SIZE` | **5** | Active connections never exceeded 4 per server in any run; 5 idle-kept connections avoid reconnect churn. |
| `DB_POOL_MAX_OVERFLOW` | **2** (was 10) | 0 / 5 / 10 measured identical; a small margin for unmeasured bursts. |
| `DB_POOL_TIMEOUT_SECONDS` | **5** (was 30) | A pool wait inside an async route freezes the worker, so fail fast with 503. No pool wait ever occurred under normal load, even at pool size 1. |
| `DB_POOL_RECYCLE_SECONDS` | **1800** | Unchanged; guards against server-side idle drops. |
| `pool_pre_ping` | **true** | Unchanged. |
| `DB_STATEMENT_TIMEOUT_MS` | **10000** (new) | Slowest legitimate statement was under 200 ms (50× headroom); bounds a stuck query. |
| `DB_LOCK_TIMEOUT_MS` | **3000** (new) | 0 lock waits in normal load; race-test waits were milliseconds. Caps a worker freeze at 3 s. |

`QueuePool` is used on Postgres (SQLAlchemy's default). SQLite uses the default pool with `check_same_thread=False`, WAL and `busy_timeout=5000`; the pool settings do not apply there. Alembic and `migrate_sqlite_to_postgres.py` build their own engines and get **no** statement or lock timeout.

### Connection budget

```
ERP     1 instance × 2 workers × (5 + 2)             = 14
Public  1 instance × 1 worker  × (5 + 2)             =  7
                                          App max    = 21
Ops: backup cron 1 + migration job ≤2 + admin/psql ≤3 = 6
superuser_reserved_connections (PG default)          = 3
Required max_connections  ≥ 30   (recommend ≥ 40 for headroom)
```

POSTGRES_MAX_CONNECTIONS for Render `basic-256mb` is **UNKNOWN**; run `SHOW max_connections;`. Keep the app total ≤ 70% of (`max_connections` − reserved). If the result is below 40, lower `DB_POOL_SIZE` to 3 before changing anything else; section 4.4 shows a small pool costs nothing here.

### Timeout hierarchy

| Layer | Value | Status |
|---|---|---|
| Postgres `lock_timeout` | 3 s | new |
| SQLAlchemy `pool_timeout` | 5 s | new (was 30 s) |
| Postgres `statement_timeout` | 10 s | new |
| Backend request budget | ~25 s target; not enforced globally, bounded per statement and per pool wait | documented |
| Uvicorn graceful shutdown | 20 s | new; must be below Render's shutdown grace period (**UNKNOWN**) |
| Frontend | 30 s (150 s for document operations) | existing |
| Render proxy request timeout | **UNKNOWN** | verify |
| Uvicorn keep-alive (idle, not per-request) | 65 s | new |
| External: WhatsApp 15 s, document providers 120 s | | existing |

---

## 7. Instances and the horizontal-scaling gate

**INITIAL_PRODUCTION_INSTANCES = 1 per service.** One 2-worker ERP instance covers the expected staff load. Multiple instances add nothing until measured demand requires them.

| Gate | Status |
|---|---|
| POSTGRES_AUTHORITATIVE | YES |
| BUSINESS_CODE_CONCURRENCY_SAFE | YES (measured) |
| IDEMPOTENCY_SAFE | YES for the 7 tested write paths after fixes |
| WHATSAPP_MULTI_INSTANCE_SAFE | YES after section 13.2 (measured on PostgreSQL) |
| ATTACHMENTS_SHARED | YES (R2/S3) |
| AUTH_MULTI_INSTANCE_SAFE | YES |
| BACKGROUND_TASKS_SAFE | YES after the SKIP LOCKED fix |
| MIGRATION_DEPLOY_SAFE | YES |
| RATE_LIMITING_MULTI_WORKER_SAFE | YES after section 13.3 (measured on PostgreSQL) |
| LINUX_MULTI_WORKER_VALIDATED | **PENDING** (staging, section 15) |
| Real client IP on Render | **PENDING** (staging diagnostic, section 13.4) |

**HORIZONTAL_SCALING_READY = NO** (initial production stays 1 instance per service regardless). Remaining blockers:
1. Validate Linux multi-worker behaviour on Render staging with the harness (section 15).
2. Confirm Render's client-address behaviour with the staging diagnostic and set `TRUST_PROXY_HEADERS`/`TRUSTED_PROXY_HOPS` or `FORWARDED_ALLOW_IPS` accordingly (section 13.4). Until then, IP-keyed limits may collapse into one shared bucket.
3. Multi-instance load test on staging (two instances behind Render's balancer) before ever raising an instance count.

The former WhatsApp and rate-limiter blockers are fixed and measured (sections 13.2–13.3).

---

## 8. Expected capacity (laptop estimate, superseded by section 15)

> These figures describe the Windows laptop. Replace them with the staging results in section 15 before using them for production planning.

- **Simultaneous requests (measured, this laptop, 2 workers):** p95 < 1 s up to **~10 in-flight requests**. Degradation (p95 > 1 s) starts at about 10–20. No errors up to 75.
- **Active users:** a staff member working in the ERP generates about 3–6 API calls per page and a page every 20–60 s, i.e. about 0.1–0.3 req/s. At ~22–33 req/s saturation, a 50% utilization target is 11–16 req/s, which is **~50 actively-working users** (conservative end).
- **SAFE_SIMULTANEOUS_USERS ≈ 50 active users / ~10 simultaneous requests**, *on hardware giving each worker a full core comparable to an i7-8665U core*. Render `starter` CPU is **UNKNOWN**; if it is fractional, capacity scales down roughly in proportion. Re-measure on staging.
- **Total registered users** is not the constraint. Hundreds of accounts with a few dozen people working at once fits.

---

## 9. Deployment profiles

**A. Local desktop:** SQLite, one uvicorn process under the launcher (unchanged). `WEB_CONCURRENCY` unset or 1. Pool settings do not apply. `busy_timeout=5000` (earlier audit).

**B. Initial production (this change):** PostgreSQL. ERP `WEB_CONCURRENCY=2`, public `WEB_CONCURRENCY=1`, one instance each. Pool 5 / 2 / 5 s / 1800 s, statement timeout 10 s, lock timeout 3 s. `--timeout-keep-alive 65 --timeout-graceful-shutdown 20`. Total ≤ 21 app connections.

**C. Scale-up (later, on measured need):** first confirm `max_connections` and plan CPU and RAM. Next step: ERP `WEB_CONCURRENCY` up to the plan's real vCPU count, subject to the RAM rule in section 4.2. Then more ERP instances, only after blocker 3 in section 7. Public API instances or workers above 1 only after blockers 1 and 2. Recompute the connection budget at every step.

---

## 10. Before / after

| Metric | Before (1 worker, pool 5/10/30 s, keep-alive 5) | After (2 workers, pool 5/2/5 s + DB timeouts, keep-alive 65) |
|---|---|---|
| RPS at 5 / 10 users | 24.6 / 17.3 | 32.7 / 32.7 (23.8 in the thermally-throttled overload run) |
| p95 at 10 users | 1,194 ms | 826 ms |
| p95 / p99 at 50 users | 6,253 / 6,726 ms | 3,463 / 4,474 ms |
| Errors at 50 users | **8.7%** dropped connections | **0%** (0% up to 75) |
| CPU | ~1 core | ~2 cores |
| RAM peak | 152 MB | 290 MB |
| Max DB connections (theoretical) | 2 services × 15 = 30 | 14 + 7 = 21 |
| Light-page p95 beside heavy users | 471 ms | 81 ms |
| Stuck DB lock | worker frozen for the full lock (15 s+, unbounded) | 503 after ≤3 s per request |
| Shutdown with a stuck request | never exits | exits in 3.2 s |
| Duplicate corrected REQs (10 clicks, 1 worker) | 4 | 1 |
| Duplicate POs (2 instances) | 2 | 1 |
| Double-processed extraction jobs | 57 / 60 | 0 / 60 |
| Concurrent-duplicate responses | 500 | 409 |

---

## 11. Render facts still required

1. `SHOW max_connections;` on `procurex-public-postgres` (plan `basic-256mb`), plus `SELECT count(*), usename, state FROM pg_stat_activity GROUP BY 2, 3;` at idle to see reserved and monitoring connections.
2. vCPU and RAM of the `starter` web plan (ERP and public) and of the `free` staging plan. Apply the RAM rule in section 4.2; if the ERP plan has under ~450 MB usable, set its `WEB_CONCURRENCY=1`.
3. Render's proxy request timeout, upstream idle keep-alive timeout, and shutdown grace period (keep `--timeout-graceful-shutdown` below it).
4. Whether Render forwards the real client IP (`TRUST_PROXY_HEADERS` is still false). Until confirmed, the **public intake limiter keys on the proxy hop address, so it may be one global 5-per-15-min bucket for all visitors.** Pre-existing, not changed here, but capacity-relevant.
5. Run `backend/scripts/load_test.py` against **staging** (the ERP staging API, with `--allow-host`) at 1/5/10/20 users with `WEB_CONCURRENCY=2` to confirm the Linux multi-worker path shows none of the Windows socket-sharing timeouts.

---

## 12. Re-running the harness

```bash
cd backend
LOADTEST_USERNAME=<disposable admin> LOADTEST_PASSWORD=<...> \
python scripts/load_test.py --base-url http://127.0.0.1:8020 \
    --stages 1,5,10,20,50 --stage-seconds 30 \
    --server-pid <uvicorn parent pid> \
    --pg-url postgresql://<disposable db> \
    --json-out results.json
```

- Read-only by default. Writes (item creation, 0.01 PO payments) need `--writes --i-understand-this-writes-data`, and only against a disposable database.
- Refuses non-loopback hosts unless `--allow-host <host>` is given, and always refuses production-looking hosts (`procurex-erp-api`, `procurex-public-api`, `redecor`, or `*.onrender.com` without `staging`).
- `--base-url a,b` spreads users across several instances; `--server-pid` can repeat. `--only name,name` restricts the mix.
- Output: one JSON line per stage on stdout (RPS, p50/p95/p99/max, error rate, status counts, CPU, RSS, DB connections and lock waits) plus the full JSON file with per-endpoint percentiles.

---

## 13. Pre-go-live closure fixes (branch `fix/pre-golive-closure`)

Developed in an isolated git worktree so the other session's uncommitted S3/R2 attachment work was never touched. That work's 981-line diff applies cleanly on top of this branch (checked with `git apply --check`).

### 13.1 Approval list N+1 (`GET /api/workflow/approvals`)

Profile: `N + 3` queries. That is 1 approvals query, 1 PO query loading full rows just for `approval_id`, 1 auth user lookup, and **one `ApprovalPayment` query per approval** (only `payments[0].status` and `.id` were used). Fix: one batched "newest payment per approval" query (subquery on the same filtered statement, so no bound-parameter limit on SQLite) and an `approval_id`-only PO lookup.

| Dataset | Queries | DB time | Wall (median of 5) | Payload | Response |
|---|---|---|---|---|---|
| 9 rows (search filter) | 12 → **4** | 4.6 → 2.6 ms | 16 → 11 ms | 10.7 KB | identical |
| 228 approvals | 231 → **4** | 48.3 → 3.0 ms | 147 → 32 ms | 259 KB | identical |
| 1,368 approvals | 1,371 → **4** | 276 → 8 ms | 812 → 167 ms | 1.55 MB | identical |

Equivalence was checked on canonical JSON (rows keyed by id, sorted keys) across 6 filter combinations (none, status, payment status ×2, project, search) on both datasets: **12/12 identical**. The check caught a bug in my first version (a loop variable shadowed the `payment_status` filter), which is why it exists. Regression tests pin the constant query count, newest-payment-wins, the payment filter, and `has_purchase_order` ignoring cancelled POs. The list remains unpaginated (1.55 MB at 1,368 approvals): a separate, later concern.

### 13.2 WhatsApp webhook idempotency

- The processed-message id is now **claimed (inserted and flushed) before any side effect**. A second worker's insert waits on the primary key and then fails, so the message is skipped with no reply and no error, and Meta still gets its 200.
- The conversation draft is read `FOR UPDATE`.
- Because `create_incoming_request` (site_portal) commits the REQ itself and releases that lock, the draft is marked `confirmed` *before* the call, so the REQ and the confirmed status commit atomically.
- A waiter that lands between that commit and the write-back of the REQ number reads the number from the committed REQ.
- Results (PostgreSQL, 8 threads): same id → 1 REQ (was 2–3); 8 different confirmations → 1 REQ (was 5); all 16 replies carry the real REQ number.
- Trade-off: a crash after the claim commits makes that message at-most-once rather than at-least-once. That is the right default for REQ creation, and the engineer sees the failure reply and can resend.

### 13.3 Rate limiting across workers

| Limiter | Class | Before | After |
|---|---|---|---|
| Login, per username | SECURITY_CRITICAL | per worker: 2 ERP workers = up to 2 × `AUTH_LOGIN_RATE_LIMIT` | shared, exact |
| Login, per IP | SECURITY_CRITICAL (runs only when `TRUST_PROXY_HEADERS=true`) | per worker | shared, exact |
| Public request + document upload, per IP | ABUSE_CONTROL | per worker (public API 1 worker; the ERP host mounts the same routes on 2) | shared, exact |
| WhatsApp webhook | none needed | HMAC-signed | unchanged |

Implementation: table `rate_limit_events` (migration **0024**, additive; keys stored as SHA-256 only). Each hit is one transaction: prune, count, record or 429. On PostgreSQL a per-key `pg_advisory_xact_lock` makes the count exact. Measured: 80 concurrent attempts from 2 processes, limit 10, **exactly 10 allowed**, 3/3 runs. Same interface, so the existing limiter tests pass unchanged. No Redis.

Deploy impact: production must run the verified migration to 0024 **before** deploying this branch (`preDeployCommand` refuses otherwise). Desktop SQLite gets the table from `init_db`: checked on a read-only `VACUUM INTO` copy of the live desktop DB, 73 → 74 tables, row counts unchanged, integrity ok. The certified semantic hash is updated, and the model and migration produce the identical schema.

### 13.4 Client IP behind the proxy

- **Bug fixed.** With `TRUST_PROXY_HEADERS=true` the app used the **leftmost** `X-Forwarded-For` entry, which the client controls: any visitor could choose their rate-limit identity or claim `127.0.0.1`. It now uses the entry appended by our own proxy (rightmost `TRUSTED_PROXY_HOPS`, default 1), the same rule uvicorn's `--proxy-headers` uses.
- **Current production state** (`TRUST_PROXY_HEADERS=false`, no `FORWARDED_ALLOW_IPS`): the app sees Render's proxy-hop address. The login IP limiter disables itself in that state (by design), but the **public-request limiter keys on it**. If Render presents one address, all public visitors share one 5-per-15-minute bucket. **Must be verified on staging before go-live.**
- **Staging diagnostic** (`CLIENT_IP_DIAGNOSTICS=true`, set in `render.staging.yaml`, refused in production). `GET /api/diagnostics/client-ip` returns the peer, each `X-Forwarded-For` entry and `X-Real-IP` as a kind (loopback/private/public) plus a salted fingerprint, and the resulting rate-limit identity; no raw addresses. `GET /api/diagnostics/runtime` returns the serving worker PID, the `statement_timeout`/`lock_timeout` the DB applies, and pool status.
- **Decision rule after the staging check:** if the peer is a private address and `X-Forwarded-For` ends in the visitor's public address, set `TRUST_PROXY_HEADERS=true`, `TRUSTED_PROXY_HOPS=1` (and keep `INTERNAL_REQUEST_TOKEN`, which hosted validation already requires). Confirm that two different devices get different `rate_limit_identity` fingerprints and that a forged leftmost entry does not change it.

### 13.5 Document-job stale recovery

Found by re-running the claim race with leftover jobs. Resetting stale `processing` jobs by loading rows and assigning fields let a second worker's reset overwrite a claim the first had just made: **2–3 of 60 recovered jobs processed twice per run.** The reset is now one conditional `UPDATE … WHERE status='processing' AND locked_at < cutoff`, which PostgreSQL re-checks against the committed row. Result: 60/60, 0 doubles, 4/4 runs.

### 13.6 New finding, not fixed: second external-engineer InstaPay/Vodafone Cash payment fails

`approval_payments.cash_reference` has a **unique** index, and non-cash payments store `''`, so the **second non-cash payment choice in the whole database is rejected** (reproduced through the public approval API on PostgreSQL). Since the capacity review it returns a misleading 409 "already done". It affects only the legacy `external_engineer` approval flow, which the current UI no longer creates (`SupplierPriceComparison.jsx` always sends `comparison_workflow`). The proper fix, a partial unique index `WHERE cash_reference <> ''`, drops an index, which the repo's additive-only migration gate forbids. That needs an explicit decision.

---

## 14. Production gates to evaluate with the Render facts

### 14.1 ERP memory gate (2 workers)

Measured peak (Windows RSS, 75 concurrent users): **293 MB** for 2 workers + supervisor. Required RAM = peak × 1.5 (allocator variance, larger production data, a 1.5 MB approvals payload being serialized, GC timing, platform overhead) = **~440 MB**. No swap or OOM restart counted on.

| ERP plan RAM (fill in from Render) | Headroom over 293 MB | Verdict |
|---|---|---|
| 256 MB | −37 MB | **NO**: run 1 worker, or upgrade the plan |
| 512 MB | 219 MB (43%) | YES, but re-check RSS on staging |
| 1 GB+ | ≥ 731 MB | YES |

`ERP_2_WORKER_MEMORY_SAFE` = the row matching the real plan. A single worker needs ~140 MB peak (×1.5 = 210 MB).

### 14.2 PostgreSQL connection budget

App theoretical max = ERP 2 × (5 + 2) + public 1 × (5 + 2) = **21**. Reserve: superuser 3 + migration job 2 + backup cron 1 + admin/psql 3 + monitoring (whatever `pg_stat_activity` shows at idle). Required `max_connections` ≥ 21 + 9 + monitoring, i.e. **≥ 30 minimum, ≥ 40 recommended**. Safe app budget = 70% × (`max_connections` − reserved). If `SHOW max_connections` is below 40, set `DB_POOL_SIZE=3` first (section 4.4: a small pool cost nothing).

---

## 15. Render staging validation (PENDING)

Prerequisites, all needing the operator:
1. Push `fix/pre-golive-closure` (plus the capacity-review commits it contains) to the branch staging deploys from.
2. Apply migration 0024 to the staging database with the existing staging migration procedure. The staging start command refuses to boot on schema drift.
3. A disposable staging-only ERP admin account (`LOADTEST_USERNAME`/`LOADTEST_PASSWORD`) and the staging hostnames.
4. Optionally, the staging Postgres external connection string for the lock test and connection sampling.

Runbook (from `backend/`):

| Check | Command / action | Pass criterion |
|---|---|---|
| Worker count + DB timeouts | `GET https://<staging-erp>/api/diagnostics/runtime` ~60× on fresh connections | 2 distinct `worker_pid` (ERP), 1 (public); `statement_timeout=10s`, `lock_timeout=3s` |
| Client IP | `GET /api/diagnostics/client-ip` from two different networks, and once with a forged `X-Forwarded-For: 1.2.3.4` | apply the section 13.4 decision rule; the forged entry must not change `rate_limit_identity` |
| Load | `python scripts/load_test.py --base-url https://<staging-erp> --allow-host <staging-erp> --stages 1,5,10,20,50 --stage-seconds 60 --pg-url <staging-db> --json-out staging.json` | 0% errors, no 30 s stalls; record RPS/p50/p95/p99 |
| Soak | same, `--stages 10 --stage-seconds 1200` | flat RSS (Render metrics), flat DB connections, no p95 drift, no worker restarts |
| Lock timeout | during a 20-user run: `psql <staging-db> -c "BEGIN; LOCK TABLE engineer_approvals IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(15); ROLLBACK;"` | locked requests get 503 after about 3 s, others keep working, recovery immediate |
| Graceful restart | start a 10-user run, press "Restart service" in Render | failed requests limited to the restart window, instance back healthy, DB connections return to baseline; record Render's actual grace period |
| Keep-alive | harness output at 20/50 users | no `RemoteProtocolError`/resets beyond noise |
| Connection budget | `SHOW max_connections;` plus idle `pg_stat_activity` on staging **and** production (read-only) | section 14.2 |

Results table (to be filled from `staging.json`):

| Users | Laptop RPS / p95 | Staging RPS / p95 | RPS ratio | p95 ratio |
|---|---|---|---|---|
| 1 | 21.1 / 172 ms | PENDING | | |
| 5 | 32.7 / 469 ms | PENDING | | |
| 10 | 32.7 / 826 ms | PENDING | | |
| 20 | 22.4 / 1,763 ms | PENDING | | |
| 50 | 24.5 / 3,463 ms | PENDING | | |

---

## 16. Attachment storage (R2/S3): blocking calls offloaded and bounded

### Before

boto3 is synchronous. Every attachment route (public REQ intake, Site Portal REQ and clarification, RFQ quotation upload/download, REQ attachment downloads, document capture upload/download, legacy payment proof) is `async def` and called `put_object`/`get_object`/`delete_object` **directly on the event loop**, several of them **inside an open DB session or transaction**. The boto3 client had no `Config`: 60 s connect + 60 s read timeouts, legacy retries, pool 10. Downloads streamed the raw body object (1 KB chunks for R2, "lines" for local files) and never closed it.

Measured with `scripts/storage_offload_probe.py` (real uvicorn, 1 worker, fake storage blocking 2.5 s per call, SQLite):

| Attachment ops in flight | Attachment request max | Concurrent storage calls | Unrelated `GET /api/suppliers` max |
|---|---|---|---|
| 1 download | 2.5 s | 1 | **2,523 ms** |
| 5 downloads | 12.6 s | 1 | **12,545 ms** |
| 20 downloads | 50.3 s | 1 | **32,626 ms** |
| 20 uploads | 50.4 s | 1 | **50,348 ms** |

The worker executed one storage call at a time and every other request queued behind it.

### Fix (`backend/attachment_storage.py`)

- Request handlers use async helpers (`put_attachment`, `get_attachment`, `delete_attachment`, `stream_attachment`, `delete_attachments_quietly_async`). Each storage call runs via `anyio.to_thread.run_sync` on a **dedicated `CapacityLimiter`** (`ATTACHMENT_STORAGE_MAX_THREADS`, default 10 per worker). Excess calls queue instead of spawning threads, and slow storage can never starve Starlette's default pool (40 threads) that serves the sync `def` routes.
- **No storage call holds a DB session.** Uploads write objects first, then open the session, re-check authorization/state, and write metadata. Downloads read metadata, close the session, then open the object. The document worker reads files after closing its session. On any failure after a write, the objects are removed (best-effort; a cleanup failure is logged and never replaces the original error). `create_incoming_request` and `create_document` no longer touch storage at all.
- Downloads stream 64 KB chunks off the event loop and always close the body (returning the R2 connection to the pool), including on client disconnect.
- boto3 `Config`: `connect_timeout` 3 s (`R2_CONNECT_TIMEOUT_SECONDS`), `read_timeout` 10 s per socket read (`R2_READ_TIMEOUT_SECONDS`), standard retry mode with `total_max_attempts` 3 including the first call (`R2_MAX_ATTEMPTS`), `max_pool_connections` = max(10, storage threads) (`R2_MAX_POOL_CONNECTIONS`). Worst case per call ≈ 3 × (3 + 10) s + backoff ≈ 40 s, versus minutes before. All calls are retry-safe (same key, same bytes; get/delete idempotent).
- Errors: missing object → `FileNotFoundError` → 404. Any other provider/transport failure (403, 5xx after retries, connect/read timeout, reset) → `AttachmentStorageUnavailable` → **503 `storage_unavailable`** with `Retry-After: 5`. The logged message names only the operation and provider error code; exception chains are suppressed, so credentials never reach logs or clients.
- No HEAD/stat calls are made on the request path (only the offline `migrate_attachments_to_r2.py`). No schema change.
- Behaviour fix found on the way: the legacy payment-proof upload deleted the *new* proof object if deleting the *previous* one failed after commit. Old-object cleanup is now best-effort after commit.

### After (same probe, same 2.5 s delay)

| Attachment ops in flight | Attachment request max | Concurrent storage calls | Unrelated `GET /api/suppliers` p50 / max (SQLite) | p50 / max (PostgreSQL, pool 5+2) |
|---|---|---|---|---|
| 1 download | 2.5 s | 1 | 7.5 / 14 ms | 10.6 / 15 ms |
| 5 downloads | 2.7 s | 5 | 8.2 / 30 ms | 11.5 / 40 ms |
| 10 downloads | 2.6 s | 10 | 8.1 / 88 ms | 10.2 / 79 ms |
| 20 downloads | 5.2 s | 10 (capped) | 10.2 / 147 ms | 12.5 / 163 ms |
| 20 uploads | 5.3 s | 10 (capped) | 9.7 / 296 ms | 12.2 / 357 ms |

Idle baseline: 8 ms (SQLite), 12 ms (PostgreSQL). On PostgreSQL, 20 concurrent slow uploads caused no pool timeouts with a 7-connection pool, which confirms that no storage call holds a connection.

Tests: `backend/tests/attachment_storage_test.py`. It runs the real botocore stack against a local fake S3 endpoint (500/503 retried 3×, 403 and 404 not retried, read timeout, connection reset, connect timeout, credential-free errors) plus app-level checks: unrelated latency under slow storage, zero DB connections checked out during storage calls, thread cap, 503/404 mapping, no metadata rows or orphaned objects after a failed multi-file upload, and exactly one REQ after a storage-failure retry. Reverting the offload makes the latency test fail (4.2 s wait, concurrency 1).

Re-run: `python scripts/storage_offload_probe.py --delay 2.5 --levels 1 5 10 20 [--database-url <disposable postgres>]`.
