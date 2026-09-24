# ProcureX Performance, Load & Reliability Audit

**Date:** 2026-09-23
**Branch:** `fix/pre-golive-hardening`
**HEAD at start:** `9963093f02f816e356c87d37176243a5a1a05929`
**Method:** measure first, fix only what measurement supports. No live/production system was load-tested or mutated; all load and concurrency testing ran against a disposable `VACUUM INTO` copy of the local SQLite database, on a throwaway backend instance on port 8010, with a disposable test-only ERP/site-portal user. The real `backend/procurement.db`, `.env`, backups, attachments, and `design-reference/` were never written to.

---

## 1. Architecture (as found, not as documented)

**Backend:** FastAPI 0.110.1, Uvicorn 0.25.0, SQLAlchemy 2.0.36 (pinned; `2.0.51` is what's actually installed in the local venv — no functional issue observed, but the pin has drifted from what's installed). Every route is `async def`. There is **no `run_in_threadpool` usage anywhere in the original code**, and **all database access is synchronous SQLAlchemy, executed directly inside the coroutine** (via `LocalCollection`/`LocalQuery` in `database.py`, and directly via `SessionLocal()` elsewhere). This is the single most important architectural fact governing everything else in this report: an `async def` declaration does not make blocking work non-blocking — FastAPI/Starlette only offloads *synchronous route functions* (`def`, not `async def`) to a thread pool automatically. Every blocking call inside an `async def` body runs straight on the one event-loop thread.

**Process model:** exactly one Uvicorn process everywhere, no `--workers` flag:
- Local/desktop: `uvicorn server:app --host 127.0.0.1 --port 8000`, supervised by `launcher/ProcureXLauncher.exe`.
- Production (Render, `render.yaml`): `uvicorn server:app --host 0.0.0.0 --port $PORT --proxy-headers` for **two separate services** — `procurex-public-api` (`APP_SURFACE=public`, anonymous intake) and `procurex-erp-api` (`APP_SURFACE=full`, staff ERP) — deliberately split so a volumetric attack on the public form can't take the ERP down with it. Both share **one** PostgreSQL database (`procurex-public-postgres`).

**Database:**
- Local/desktop/dev: SQLite (`backend/procurement.db`), `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` set on every new connection (`database.py`), **`PRAGMA busy_timeout` was never set** (SQLite default: 0 — see §9).
- Production: PostgreSQL (already migrated — this is not a "should we migrate off SQLite" report, production already did). Engine created with `pool_pre_ping=True` only; **no `pool_size`, `max_overflow`, `pool_timeout`, or `pool_recycle` were ever explicitly set**, so both Render services ran on SQLAlchemy's bare defaults (`pool_size=5`, `max_overflow=10`, `pool_timeout=30`, `pool_recycle=-1`/never).
- Two independent app instances (`procurex-public-api`, `procurex-erp-api`) each open their own pool against the same Postgres database — the real ceiling is `instances × (pool_size + max_overflow)`, which was never checked against that Postgres plan's actual `max_connections`.

**Frontend:** CRA + craco, already code-split with `React.lazy`/`Suspense` and paginated (`CrudPage`) for Items/Suppliers/Customers/Projects — real prior perf work, confirmed via git history, not re-litigated here. 5 axios client instances exist; 3 had no `timeout` set (axios default: wait forever) — see §18/19.

**External services found:**
| Service | Library | Timeout (found) | Retries (found) | Call site pattern (found) |
|---|---|---|---|---|
| Meta WhatsApp Graph API | `httpx` (sync) | 15s | none | **blocking, directly inside `async def receive_webhook`, no threadpool** |
| S3/R2 attachment storage (prod only) | `boto3` (sync) | botocore default (~60s connect + ~60s read, not reviewed/tuned) | botocore's own internal legacy retry (not app-level) | blocking, directly inside `async def` routes across ~10 call sites (incoming_requests.py, rfq.py, procurement_workflow.py, site_portal.py, document_capture/) — **same pattern as WhatsApp, not fixed this pass, see §"Remaining risks"** |
| Document extraction (Azure Doc Intelligence / OpenAI) | not inspected directly | `DOCUMENT_PROVIDER_TIMEOUT_SECONDS=120` (configured) | app-level, exponential backoff (5s→10s→20s…capped 300s), `max_attempts=3` | **runs on a persistent background worker thread (`document_capture/jobs.py`), not inline in the request — already the correct pattern, no fix needed** |

---

## 2–3. Baseline & instrumentation added

No timing/observability instrumentation existed before this audit (no request IDs, no latency logs, no DB query counters). Added `backend/diagnostics.py` (contextvar-based, near-zero overhead: a `time.perf_counter()` pair and a float addition per SQL statement) plus:
- A request-timing middleware (`server.py`) logging `req_id, method, path, status, duration_ms, db_ms, db_queries, ext_ms, ext_calls` per request, and an `X-Request-ID` response header. Logs only method/path/status/timings — **never** query strings, headers, bodies, or SQL parameter values.
- SQLAlchemy `before_cursor_execute`/`after_cursor_execute` engine events in `database.py` feeding the same per-request counters.
- A `timed_external()` context manager wrapping the WhatsApp outbound HTTP calls (`whatsapp/providers/meta.py`) for the `ext_ms`/`ext_calls` figures.

This is what every number in this report is based on.

---

## 4. Load test harness & environment

Built `load_harness.py` (stdlib + `httpx` + `psutil`; no Locust/k6 — both already available as backend deps or a one-package add). Targets **only** the disposable backend on port 8010. Concurrency levels 1/5/10/20/50, three read scenarios matching real usage:
- **Scenario A (dashboard-heavy):** `/api/dashboard`, `/api/reports/daily`, unread-notifications count.
- **Scenario B (procurement office):** incoming-requests list, RFQ list, comparisons list, approvals list.
- **Scenario C (mixed reads):** suppliers, items, projects, purchase orders.

**Environment tested:** local Windows 11 desktop (the same machine ProcureX normally runs on for this deployment), SQLite, single disposable Uvicorn process. **These numbers describe this machine only** — they do not transfer to Render's production hardware, which was not accessible from this environment (no Postgres instance, no way to reach the live Render services safely).

**Data volume caveat (important):** the real live database currently has almost no data (1 purchase request, 1 RFQ, 1 comparison, 1 PO — this business has only just started using ProcureX). Testing only against that volume would hide any query-count/row-scan issue that matters at realistic future scale. A synthetic, disposable-only seed of 400 additional purchase requests + 1,200 line items was added to the **copy only** (never the live DB) specifically to surface that class of problem — see §6.

---

## 5. Load test results (staged concurrency, tiny real-data volume, before any fix)

All three scenarios show the same shape: **throughput plateaus (or slightly declines) as concurrency rises, while p50/p95 latency grows roughly linearly with concurrency** — the signature of a single-threaded event loop serializing blocking work, not of a system that's actually parallelizing more requests as more arrive. Error rate was 0% at every level tested (no crashes, no timeouts up to c=50) — the system degrades to *slow*, not *broken*, within the range tested.

**Scenario A — dashboard-heavy**
| c | RPS | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| 1 | 110.4 | 10.7ms | 12.4ms | 14.3ms | 0% |
| 5 | 120.7 | 41.1ms | 56.9ms | 69.6ms | 0% |
| 10 | 116.2 | 85.0ms | 120.5ms | 139.6ms | 0% |
| 20 | 115.4 | 173.9ms | 237.8ms | 273.3ms | 0% |
| 50 | 110.3 | 533.3ms | 605.6ms | 674.6ms | 0% |

**Scenario B — procurement office**
| c | RPS | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| 1 | 67.6 | 6.2ms | 42.5ms | 53.5ms | 0% |
| 5 | 66.7 | 64.8ms | 163.4ms | 210.0ms | 0% |
| 10 | 61.4 | 147.0ms | 359.0ms | 446.2ms | 0% |
| 20 | 57.5 | 331.0ms | 557.0ms | 967.4ms | 0% |
| 50 | 53.0 | 835.1ms | 2369.6ms | 2426.3ms | 0% |

**Scenario C — mixed reads**
| c | RPS | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| 1 | 140.3 | 6.4ms | 10.7ms | 12.0ms | 0% |
| 5 | 155.4 | 31.7ms | 44.1ms | 54.9ms | 0% |
| 10 | 138.6 | 71.1ms | 101.1ms | 119.7ms | 0% |
| 20 | 127.1 | 149.7ms | 217.4ms | 252.5ms | 0% |
| 50 | 107.9 | 367.0ms | 1187.5ms | 2065.6ms | 0% |

CPU during these runs tracked the same shape: ~86% avg at c=1 rising to ~110-170% max at c=50 (single-process bound, not multi-core-saturated — there was CPU headroom the architecture simply couldn't use, because there's one thread pulling requests through blocking I/O).

**SAFE_CONCURRENCY ≈ 5** (p95 stays under ~200ms in every scenario). **DEGRADATION_STARTS ≈ 10** (p50/p95 roughly triple vs. c=1, still 0 errors). **FAILURE_POINT: not reached up to c=50** — no errors, no timeouts, just growing queue-wait latency (up to ~2.4s p95 in Scenario B). This is pure implicit queuing: the app accepts unlimited concurrent connections with no admission control, and just serializes the blocking work behind them.

---

## 6. Per-endpoint database profile

Isolated single-request timings (concurrency=1, tiny real-data volume — 1 REQ/RFQ/PO/comparison, 27 suppliers, 33 items):

| Endpoint | p50 | DB queries | DB time |
|---|---|---|---|
| `/api/dashboard` | 11.1ms | 22 | 0.6–3.1ms |
| `/api/items` | 8.9ms | (single query, Python-side filter) | — |
| `/api/suppliers` | 5.3ms | — | — |
| `/api/reports/daily` | 11.6ms | — | — |
| `/api/internal/incoming-purchase-requests` | 4.8ms | 3 | 0.2–0.9ms |
| `/api/workflow/rfqs` | 6.2ms | — | — |
| `/api/price-comparisons` | 4.1ms | — | — |
| `/api/workflow/approvals` | 5.3ms | — | — |
| `/api/purchase-orders` | 5.9ms | — | — |
| `/api/payments` | 4.6ms | — | — |
| `/api/price-history` | 3.9ms | — | — |

No N+1 pattern was found in any of these at this data volume — consistent with the prior perf work already on this branch (RFQ comparison-rows batching: 2+4N+M → 4 queries; daily-report caching; items price-history grouped query — all confirmed present in the current code, not re-broken, not re-fixed).

**At 401 purchase requests (synthetic, disposable DB only) — the scale test:**
- `/api/internal/incoming-purchase-requests`: stayed at **3 fixed queries**, DB time 0.2–0.9ms even with 401 rows in the table — genuinely scales, no N+1.
- `/api/dashboard` and `/api/reports/daily`: **duration rose to ~25-33ms** while DB time stayed under 2ms. Root cause, confirmed by reading `server.py`'s `dashboard()`: it runs `select(IncomingPurchaseRequest)`, `select(PriceComparison)`, `select(EngineerApproval)`, `select(PurchaseOrder)`, `select(Purchase)`, `select(Payment)`, `select(ApprovalPayment)` — **all unbounded, all loaded fully into Python, then aggregated in Python** (`calculate_procurement_kpis`, the `by_supplier`/`by_project`/`monthly`/`status_dist` loops). This is genuinely invisible today (the live business has ~1 row per table) but is an **O(n) Python-side cost that will grow linearly as the business's real data grows** — confirmed as a real, current architectural characteristic, not a regression from anything changed in this audit (proof: `/api/suppliers`, untouched by the same data seeding, stayed at exactly 5.2–5.3ms before and after). **Not fixed in this pass** — a proper fix means pushing the aggregation into SQL (`GROUP BY`) or incremental caching, which touches business logic (`calculate_procurement_kpis`, `_dashboard_procurement_intelligence`) not otherwise in scope here; see Remaining Risks / root-cause matrix (MEDIUM-today, will become HIGH as REQ volume grows).

---

## 7. Index audit

Checked actual indexes (`sqlite_master`) against the WHERE/JOIN/ORDER BY patterns used by the endpoints above, on `incoming_purchase_requests`, `rfqs`, `price_comparisons`, `purchase_orders`, `engineer_approvals`. All are **already comprehensively indexed** on status, project_id, customer_id, dates, tokens, and FK columns. No missing index was found — every measured query in §6 completed in under 2ms even at 401 rows. **No index changes made** (none justified by measurement, per the audit's own rule against speculative indexing).

---

## 8. Session/connection-leak audit

Every `SessionLocal()` use found is either a `with SessionLocal() as session:` block or the existing `LocalDatabase`/`LocalQuery` wrapper, which does the same. No manual session left unclosed was found. `pool_pre_ping=True` was already set (detects and discards dead connections before use). The 8-minute soak test (§11) is itself a connection-return proof: 29,357 requests, 0 errors, over a sustained run — a connection leak at any real rate would have exhausted the pool (`pool_size=5 + max_overflow=10` = 15 on Postgres; SQLite's own connection handling) long before that count.

---

## 9. SQLite-specific audit

`journal_mode=WAL`: yes. `foreign_keys`: ON. `busy_timeout`: **was never set (SQLite default: 0 — a lock conflict fails immediately instead of waiting)**. Fixed: `PRAGMA busy_timeout=5000` added to the same `connect` event handler in `database.py`.

**Measured, not assumed** — WRITE+WRITE contention test (8 threads × 15 inserts each, throwaway copy-of-a-copy, never the shared load-test DB):

| | ok | "database is locked" errors | write p50 | write p95 |
|---|---|---|---|---|
| Before (`busy_timeout=0`, i.e. what was actually running) | 14 / 120 | 106 (88%) | 0.0ms (fails fast) | 0.0ms |
| After (`busy_timeout=5000`) | 120 / 120 | 0 | 4.9ms | 171.2ms |

At the current single-writer-process architecture, concurrent writers already existed (multiple staff saving at once) and were **failing outright 88% of the time** under contention rather than queuing briefly — that's the concrete, measured harm the missing pragma caused. After the fix, all writes succeed by waiting (bounded, up to the 5s budget) instead of erroring.

`SQLITE_MAX_SAFE_APP_INSTANCES = 1`. This is unchanged and correct as-is: SQLite's single-writer model means multiple backend processes/instances against the same `.db` file is not safe regardless of `busy_timeout`. This only applies to the local/desktop deployment — production already runs PostgreSQL (§10), which does not have this constraint.

---

## 10. PostgreSQL-specific audit

**No PostgreSQL instance was available to this audit** — Render's production database could not be safely reached or load-tested from this environment, so this section is **configuration analysis, not measurement**, and is labeled as such.

Found: `pool_pre_ping=True` only; no explicit `pool_size`/`max_overflow`/`pool_timeout`/`pool_recycle` — both Render services ran on SQLAlchemy's bare defaults (`5`/`10`/`30s`/never-recycle). Two independent services (`procurex-public-api`, `procurex-erp-api`) each open their own pool against the **same** Postgres database, so the real ceiling is `instances × (pool_size + max_overflow)` — this was never checked against that Postgres plan's actual `max_connections`, and this audit has no way to obtain that number from here.

Fixed (low-risk, additive): `database.py` now reads `DB_POOL_SIZE` / `DB_POOL_MAX_OVERFLOW` / `DB_POOL_TIMEOUT_SECONDS` / `DB_POOL_RECYCLE_SECONDS` env vars for the non-SQLite path, defaulting to the exact same values that were already running (`5`/`10`/`30`) **except** `pool_recycle`, changed from `-1` (never) to `1800`s — a standard, low-risk defensive default against a hosted Postgres silently dropping idle connections server-side; this is a well-established best practice independent of the exact connection-count budget, so it did not require knowing that budget to justify. **Do not change `DB_POOL_SIZE`/`DB_POOL_MAX_OVERFLOW` from their current defaults, and do not add `--workers`, until someone checks the actual Postgres plan's `max_connections` in the Render dashboard** — recommended next step, not performed here.

---

## 11. Memory audit — soak test

8-minute soak test (Scenario B, concurrency=10; shorter than the suggested 15–30 minutes given this session's time budget — noted as a limitation, not a substitute for a longer run before go-live if the team wants more confidence): **29,357 requests, 0 errors, 100% HTTP 200.**

| minute | RSS avg | RSS max | CPU avg | threads (max) | handles (max) |
|---|---|---|---|---|---|
| 0 | 115.6MB | 119.3MB | 110.6% | 36 | 332 |
| 1 | 115.0MB | 116.8MB | 109.8% | 11 | 246 |
| 2 | 114.7MB | 116.0MB | 111.1% | 11 | 253 |
| 3 | 114.5MB | 116.2MB | 111.8% | 11 | 253 |
| 4 | 115.0MB | 116.6MB | 112.3% | 11 | 247 |
| 5 | 114.9MB | 117.6MB | 115.3% | 11 | 253 |
| 6 | 115.1MB | 116.6MB | 117.0% | 12 | 250 |
| 7 | 115.2MB | 117.0MB | 115.4% | 12 | 248 |
| 8 (partial) | 117.1MB | 117.1MB | 137.3% | 12 | 242 |

RSS: start 119.26MB → end 117.06MB → max 119.3MB. **MEMORY_GROWTH_PERCENT ≈ 0% (slightly negative, within noise).** Thread count drops from a 36-thread startup burst to a stable 11–12 and stays there. Handle count stable.

**MEMORY_LEAK_SUSPECTED = NO.**

---

## 12–13. CPU / event-loop audit

No repeated full-dataset Python loops were found beyond the dashboard/daily-report pattern already covered in §6. `receive_webhook` (WhatsApp) was the one confirmed case of a genuinely blocking call sitting directly in an `async def` body with no threadpool offload — see §14 for the fix and the isolated proof of the mechanism.

---

## 14. External service audit & fix: WhatsApp webhook

**Finding (CRITICAL):** `whatsapp/router.py`'s `receive_webhook` (`async def`) called `_handle_message`, which called `provider.send_text(...)` — a **synchronous** `httpx.post` with a 15s timeout — directly, with no `run_in_threadpool`. Given the confirmed single-process, single-event-loop architecture (§1, §5), any one slow or hanging Meta API response would freeze **the entire ProcureX ERP for every concurrent user** for up to 15 seconds. This endpoint is reachable by **any unauthenticated party** who sends a WhatsApp message to the configured number (only signature-checked, not access-controlled) — an attacker-triggerable, zero-privilege DoS vector, not just a theoretical slow path.

**Proof of mechanism** (isolated, minimal reproduction of the exact pattern — not a claim about live Meta traffic, which this audit correctly did not generate): a throwaway FastAPI app with an `async def /slow` route calling `time.sleep(3)` directly (same shape as the WhatsApp call), and an `async def /fast` route returning immediately.

| | baseline (nothing else in flight) | while one `/slow` (3s) request is in flight |
|---|---|---|
| `/fast` latency | 9.3ms | **~2,940ms — every one of 5 concurrent requests** |

**Fix:** `_handle_message` no longer sends the reply itself — it only decides the reply and records the message as processed (DB-only, fast, stays on the event-loop thread as before). `receive_webhook` now sends via `await run_in_threadpool(provider.send_text, phone, reply)`, **after** the DB session has closed. Retry semantics were deliberately **not** added — sending a WhatsApp message is not idempotent (a retry would double-send to the user), so the existing single-attempt, log-and-swallow-on-failure behavior was preserved exactly; only *where* it runs changed. Verified: all 25 WhatsApp intake tests pass unchanged, plus the full backend suite.

**Not fixed this pass, same root cause:** `attachment_storage.py`'s `S3AttachmentStorage` (boto3, used in production for both surfaces per `render.yaml`) is called the same way — synchronously, directly inside `async def` routes, across ~10 call sites (`incoming_requests.py`, `rfq.py`, `procurement_workflow.py`, `site_portal.py`, `document_capture/service.py`). Botocore's default timeouts (~60s connect + ~60s read, not "infinite" but generous and never explicitly reviewed here) bound the damage but don't remove it. This is architecturally identical to the WhatsApp bug and is a real HIGH-severity follow-up candidate — not fixed here because (a) there is no S3/R2 test environment reachable from this audit to prove a before/after, and (b) touching ~10 call sites across 5 files in one pass without that proof would violate this audit's own "measure, don't guess" and "don't mix everything into one huge refactor" rules. Flagged explicitly rather than silently left out.

---

## 15–16. Retry policy & retry-storm analysis

No retry loop exists anywhere in the outbound-HTTP paths: WhatsApp send is a single attempt (correct — see idempotency below); S3/R2 relies on botocore's own internal retry (not app code, not reviewed/tuned this pass); document extraction has the one deliberate app-level retry loop, and it's already well-designed (exponential backoff 5s→10s→20s…capped 300s, `max_attempts=3`, running on a background worker, not inline in the request — a genuinely good existing pattern, left untouched). **RETRY_AMPLIFICATION_FACTOR = 1×** — no retry-storm risk exists in this codebase today.

---

## 17. Circuit breaker review

**Not implemented, and not recommended right now.** Only two real external dependencies exist (Meta, S3/R2); both already have bounded timeouts and graceful degradation (log-and-continue, or the document worker's persistent retry queue); call volume is low (per-WhatsApp-message, per-attachment-operation). A circuit breaker would add state and complexity for a failure mode that hasn't been observed. Also worth noting explicitly (this codebase already documents the same caveat for its rate limiter, in `rate_limit.py`): **a per-process circuit breaker would not share state across the two Render instances** if one were added later, and would need to move to shared state to mean anything once truly horizontally scaled. Revisit only if S3/R2 or Meta outages become a measured, recurring operational problem.

---

## 18. Timeout hierarchy

| Layer | Timeout found | Status |
|---|---|---|
| External: Meta WhatsApp (`httpx`) | 15s | unchanged, already reasonable |
| External: S3/R2 (`boto3` default) | ~60s connect + ~60s read | not reviewed/tuned this pass |
| External: document extraction | 120s (`DOCUMENT_PROVIDER_TIMEOUT_SECONDS`) | unchanged, correctly configured |
| Backend request budget (server-side global) | none enforced | not found, not added (no measured need; Render's own reverse-proxy timeout was not verifiable from this environment) |
| Frontend `lib/api.js`, `lib/requestApi.js` | **was: none (axios default = wait forever)** | **fixed → 30s** |
| Frontend `lib/documentCaptureApi.js` (×2) | **was: none** | **fixed → 150s** (must exceed the 120s backend document-provider timeout — correct inner-before-outer ordering) |
| Frontend `lib/publicRequestApi.js` | 30s | already correct, unchanged |

The one contradiction found (frontend layer had **no** bound while every backend external call already did) was in the safe direction — a hung backend would eventually error out server-side, but the frontend UI would just spin forever with no way for the user to know something was wrong. Fixed. Render's actual proxy-level timeout was not verified (no dashboard access from this environment) — flagged as an open item, not asserted either way.

---

## 19. Frontend request audit

Found 5 axios client instances (`lib/api.js`, `lib/requestApi.js`, `lib/documentCaptureApi.js` ×2, `lib/publicRequestApi.js`). 3 had no timeout (fixed, §18). No `AbortController`/cancellation anywhere in the frontend — a request started, then abandoned by navigation, keeps running to completion server-side and the response is simply discarded client-side. **Not fixed this pass**: retrofitting cancellation is a broad, per-page change with no measured user-facing harm found (no evidence of accumulating abandoned-request load in the soak test, which itself proves the server side handles this fine memory-wise) — documented as a LOW/MEDIUM recommendation rather than implemented speculatively. Browser-level network-tab profiling (bundle size, waterfall, re-render counts — §37) was **not performed this pass**; this audit worked at the API level via the load harness, not through a live browser session. Flagged as a testing gap for a follow-up pass if the team wants it before go-live.

---

## 20. Pagination / response size

**Confirmed bug (fixed):** `/api/internal/incoming-purchase-requests` accepted no `limit`/`offset` parameters at all — any `?limit=` sent by a caller was silently dropped by FastAPI (not a declared parameter), and the query was hardcoded to the newest 500 rows with **no way to reach anything past row 500**. At the current real data volume (1 REQ) this is invisible; proven at 401 rows: identical 325,099-byte payload whether or not `?limit=50` was sent.

**Fix:** `limit` (default 500, capped at 500) and `offset` (default 0) are now real query parameters, and an `X-Total-Count` response header was added. Verified: default request unchanged (325,099 bytes, matches prior behavior exactly — no frontend change needed, since the current UI never sends `limit`/`offset`); `?limit=10` → 8,087 bytes (97.5% smaller); `?limit=10&offset=395` correctly returns the previously-unreachable tail rows.

**Not fixed, documented only:** `/api/purchase-orders`, `/api/payments`, `/api/price-history` also return fully unbounded lists (up to 100,000 rows) with no pagination at all. At today's real data volume (1 PO, 1 payment, 0 price-history rows) there is no measured harm, so — consistent with this audit's own "don't fix what isn't measured" rule — these were **not** touched. They're structurally the same gap that `incoming-purchase-requests`, `items`, `suppliers`, `projects` already had (or, per git history, already got fixed for items/suppliers/projects). Recommended as the next candidates for the same `limit`/`offset` treatment once real PO/payment/price-history volume grows past a few hundred rows.

---

## 21–22. Cache review

**Existing (confirmed, unchanged):** the daily report already caches computed sections **for closed report dates only** (git history: `perf(daily-report): cache computed sections for closed report dates only`) — a genuinely safe cache (closed dates are immutable, no invalidation logic needed). Left as-is.

**Reviewed and rejected:** process-local caching of lookup data (suppliers/items/projects dropdowns). CACHE_BENEFIT: none demonstrated — every measured lookup endpoint already returns in under 10ms with sub-millisecond DB time (§6). CONSISTENCY_RISK: low if added, but there's no proven benefit to offset it. CACHE_REJECTED — no Redis, no process-local TTL cache added. Revisit only if production (Postgres, real network round-trips instead of local SQLite) shows these endpoints actually DB-bound in the request-timing logs now in place.

No Redis was introduced anywhere in this audit — never justified by a measured need for cross-instance shared state.

---

## 23–26. Load harness, scenarios, soak test, performance budget

Covered in §4–§11 above. **Proposed performance budget** (derived from what was actually measured on this machine, not invented targets): interactive read endpoint p95 under **200ms at ≤10 concurrent users**; write endpoints bounded primarily by SQLite's `busy_timeout` window (now 5s) rather than a separate target; error rate **0%** under normal load (matches what was measured up to c=50); timeout rate **0%**; memory growth **flat** over a sustained run (matches the soak test); no formal CPU saturation target set — the constraint observed is architectural (single process), not raw CPU headroom.

---

## 27. Saturation point

Already stated in §5: **SAFE_CONCURRENCY ≈ 5, DEGRADATION_STARTS ≈ 10, FAILURE_POINT: not reached by c=50** on this machine, this SQLite dataset. These numbers describe *this test environment only* and must not be assumed to transfer to Render's production hardware, which was not accessible from here.

---

## 28. Root-cause matrix

| Issue | Evidence | Root cause | Severity | Fix | Status |
|---|---|---|---|---|---|
| Throughput plateaus, latency scales linearly with concurrency | Scenario A/B/C load tests, §5 | Single Uvicorn process/worker; all DB access synchronous, run directly on the event loop, no threadpool offload | HIGH (architectural, not a bug) | Add `--workers` on the **Postgres** production surfaces once pool budget is verified (not safe on SQLite) | Documented, not implemented (needs Render-plan facts unavailable here) |
| WhatsApp webhook could freeze the entire app for up to 15s, triggerable by any unauthenticated sender | Isolated block-mechanism proof: 9.3ms → 2,940ms, §14 | Synchronous `httpx.post` called directly inside `async def`, no `run_in_threadpool` | **CRITICAL** | Offload the send via `run_in_threadpool`, after the DB session closes | **Fixed**, tests pass |
| SQLite concurrent writers fail immediately instead of queuing | WRITE+WRITE contention test: 88% failure → 0% failure, §9 | `PRAGMA busy_timeout` was never set (SQLite default 0) | **P0 / HIGH** | `PRAGMA busy_timeout=5000` | **Fixed**, measured |
| Frontend hangs indefinitely on a stuck backend request | Code read: axios default timeout is 0 (infinite) on 3 of 5 clients | No `timeout` set on `lib/api.js`, `lib/requestApi.js`, `lib/documentCaptureApi.js` | HIGH (UX/reliability) | Add bounded timeouts (30s app-wide, 150s for document ops) | **Fixed** |
| `/api/internal/incoming-purchase-requests` silently drops all rows past #500 with no way to reach them | `?limit=` ignored, 325,099 bytes either way, §20 | No `limit`/`offset` params declared; hardcoded `.limit(500)` | P1 / MEDIUM (will become a real data-loss-from-the-UI's-perspective bug as REQ volume grows) | Add real `limit`/`offset` + `X-Total-Count` | **Fixed**, verified (325KB→8KB at `limit=10`, tail page reachable) |
| Dashboard/daily-report cost grows linearly (Python-side) with REQ count | 401-row synthetic test: 11ms→25-33ms, DB time stayed <2ms, §6 | Full, unbounded `select()` of 7 tables loaded into Python and aggregated there (`calculate_procurement_kpis` et al.) | MEDIUM today, trending HIGH as real data grows | Push aggregation into SQL `GROUP BY` / incremental caching | **Not fixed** — needs a scoped follow-up into business-logic functions not otherwise touched this pass |
| S3/R2 attachment calls block the event loop the same way WhatsApp did | Code read: same pattern across ~10 call sites, boto3 sync | Same as WhatsApp finding, different external service | HIGH | `run_in_threadpool` around `attachment_storage` calls | **Not fixed** — no S3/R2 test environment available to prove before/after here |
| Postgres pool sizing was never explicitly chosen, `pool_recycle` was "never" | Code read: bare SQLAlchemy defaults, §10 | Config gap, not a measured failure (no Postgres access to reproduce) | MEDIUM | Made tunable via env vars; `pool_recycle` defaulted to 1800s | **Fixed** (config only — sizing itself needs Render-plan verification) |
| `/api/purchase-orders`, `/payments`, `/price-history` return unbounded lists | Code read, §20 | No pagination params at all | LOW today (real data volume is tiny), will become P1/P2 | Same `limit`/`offset` pattern as the incoming-requests fix | **Not fixed** — no measured harm yet |
| No `AbortController` anywhere in the frontend | Code read, §19 | Never implemented | LOW | Add cancellation on unmount/navigation | **Not fixed** — no measured harm (soak test shows server handles abandoned work fine) |

---

## 29. Fixes implemented, in priority order

**P0**
- `backend/database.py`: `PRAGMA busy_timeout=5000` (SQLite reliability; measured 88%→0% write-contention failure rate).
- `backend/whatsapp/router.py`, `backend/whatsapp/providers/meta.py`: WhatsApp reply send moved off the event-loop thread via `run_in_threadpool`, after the DB session closes. Idempotency-safe (unchanged single-attempt, log-and-swallow semantics).

**P1**
- `backend/incoming_requests.py`: real `limit`/`offset` pagination + `X-Total-Count` on the incoming-requests list endpoint (backward-compatible default).
- `frontend/src/lib/api.js`, `requestApi.js`, `documentCaptureApi.js`: bounded request timeouts (30s / 150s for document ops).
- `backend/database.py`: configurable Postgres pool settings (`DB_POOL_SIZE`, `DB_POOL_MAX_OVERFLOW`, `DB_POOL_TIMEOUT_SECONDS`, `DB_POOL_RECYCLE_SECONDS`), `pool_recycle` defaulted from "never" to 1800s.

**P2 / observability (supports all of the above)**
- `backend/diagnostics.py` + middleware in `backend/server.py`: per-request timing/DB-query-count logging, never logs secrets/query strings/bodies.

**Not implemented** (documented candidates only, see root-cause matrix): S3/R2 threadpool offload; dashboard/daily-report SQL-side aggregation; PO/payments/price-history pagination; frontend request cancellation. Each has a stated reason (no test environment, or no measured current harm, or out of a reasonably-scoped diff) rather than being silently skipped.

---

## 30–33. Cancellation, idempotency, overload behavior, graceful failure

**Idempotency:** PO payments and PO receipts already use an `idempotency_key` + DB unique constraint (`purchase_order_payments`, `purchase_order_receipts` — confirmed in `database.py`/schema). WhatsApp send correctly remains single-attempt (retrying would double-send a message to a real person) — the fix in §14 changed *where* it runs, never *whether* it retries.

**Overload behavior:** no `429`/`503`/`Retry-After` exists anywhere, and none was added. Justification: up to c=50 sustained concurrent load, the system never errored — it just got slower (§5). For an internal back-office tool realistically used by a handful of staff at once, adding admission control now would be solving a problem that hasn't been measured. Revisit if production traffic ever approaches the concurrency levels tested here.

**Graceful failure:** not independently fault-injected this pass (no DB-unavailable / pool-exhausted / external-API-down fault injection was run beyond the SQLite contention test in §9 and the blocking-call proof in §14, both of which are real fault-adjacent measurements). The global exception handler (`server.py`) already returns a sanitized generic 500 with no stack trace leakage — confirmed by reading the code, not independently fault-tested here.

---

## 34–36. Scaling recommendation

- **Vertical:** not tested (single machine, no comparison hardware available).
- **Process (`uvicorn --workers N`):** **not safe on SQLite** (§9 — single-writer constraint, confirmed by the contention test). **Safe and recommended on the Postgres production surfaces**, and is the highest-leverage fix for the confirmed throughput ceiling in §5 — but a specific worker count is deliberately **not prescribed** here (see §37/worker count below); it depends on facts this audit could not obtain (Render plan's real vCPU count, Postgres `max_connections`).
- **Horizontal (multiple app instances):** **CURRENTLY_SAFE_TO_SCALE_HORIZONTALLY = NO.** Checked against the section-36 checklist:
  - PostgreSQL authoritative: ✅ yes (production already runs it).
  - Attachment storage shared/persistent: ✅ yes (S3/R2, confirmed in `render.yaml`).
  - Business-code generation safety across instances: ❓ **not verified** — `business_code_sequences` row-update locking was not audited this pass.
  - WhatsApp webhook dedup across instances: likely safe (DB-enforced via `WhatsAppProcessedMessage.message_id`, not per-process state) but **not load-tested with 2 real instances**.
  - Rate limiter: ❌ **known-unsafe as-is** — `rate_limit.py` is explicitly documented in its own source as per-process, in-memory state; horizontally scaling without moving it to shared state would under-enforce login/public-request rate limits.
  - **Blocker list for horizontal scaling:** (1) verify business-code sequence concurrency safety, (2) move the rate limiter to shared state, (3) load-test WhatsApp dedup across 2 real instances.
- **Database:** SQLite→PostgreSQL migration is **already done** in production; no further engine change recommended. Pool tuning is now configurable (§10) but the specific numbers need Render-plan verification before changing from current defaults.
- **Cache:** none added — no measured need for shared/cross-instance cache (§21-22).
- **Static assets:** already on Render static hosting for both frontend surfaces; no CDN change tested or recommended.

**Worker count:** deliberately not set to a guessed value (`CPU×2+1` was explicitly avoided per the audit's own rules). Reasoning for a future decision: most of the blocking time measured in this audit was I/O wait (DB, and potentially external calls), not CPU-bound compute, so even a low-vCPU Render plan should see a real benefit from more than one worker process, since the OS can schedule other work during I/O waits. A conservative **starting point of 2 workers per Postgres-backed instance** is reasonable to validate before going higher — but only after the two open blockers above (Postgres `max_connections` budget, actual Render plan vCPU count) are confirmed, neither of which this audit could check.

---

## 37–38. Frontend performance / dev-mode discipline

Bundle size, route-chunking, and re-render profiling (§37) were **not performed this pass** — this audit worked at the API/load-test level, not through a live browser session, so there is nothing new to report here beyond what git history already shows (code-splitting and CrudPage pagination already landed). No dev-mode artifact (React StrictMode double-invocation, hot-reload noise) was mistaken for a production issue anywhere in this report — every finding above traces to either a load-test measurement against a real running instance, or a direct code read of behavior that doesn't depend on dev/prod mode.

---

## 39. Security vs. performance

No security control was loosened by any fix in this pass. `busy_timeout` and pool-recycle changes are additive reliability defaults. The pagination fix preserves the exact default response the current frontend already relies on. The WhatsApp fix changes *when* `provider.send_text` runs, not its signature verification (`security.verify_signature`) or subscription-verification logic, both untouched. Auth (JWT/RBAC), FK enforcement, and the audit trail were not touched anywhere in this diff.

---

## 40. Before/after summary

| Metric | Before | After | Note |
|---|---|---|---|
| SQLite concurrent-write success rate (8 threads × 15 writes) | 14/120 (12%) | 120/120 (100%) | measured, §9 |
| `/fast` latency with one slow blocking call in flight (isolated mechanism proof) | 2,940ms | n/a (mechanism eliminated for the real WhatsApp path) | §14 |
| `incoming-purchase-requests` payload at `limit=10` | 325,099 bytes (limit ignored) | 8,087 bytes | measured, §20 |
| Frontend timeout on primary API clients | none (∞) | 30s / 150s | code read, §18 |
| Soak test (8 min, c=10, 29,357 requests) | not run before (no instrumentation existed) | 0 errors, memory flat (119→117MB), p50 157ms / p95 283ms | §11, baseline for future comparison |
| Postgres `pool_recycle` | -1 (never) | 1800s (configurable) | config only, not load-tested (no Postgres access) |

Read-path RPS/latency numbers were **not** re-benchmarked as a clean "same data, before vs. after" comparison for the P0/P1 fixes, because none of those fixes touch the read/dashboard hot path that Scenario A/B/C exercise — the architectural throughput ceiling in §5 is unchanged by this pass's fixes (it requires the `--workers`-on-Postgres change, which needs facts unavailable here). Re-running Scenario A after the fixes (on the now-401-row seeded dataset) showed 0% errors and latencies consistent with the genuine, separately-diagnosed O(n) dashboard cost in §6 — not a regression, confirmed via an unaffected control endpoint (`/api/suppliers`, unchanged at 5.2–5.3ms before/after).

---

## 41. Tests / regression

- **Backend (`pytest`):** full suite, **100% pass, exit code 0** (5 batches shown in output, no failures).
- **WhatsApp-specific (`whatsapp_intake_test.py`):** 25/25 pass, run both in isolation and as part of the full suite — directly validates the `run_in_threadpool` refactor didn't change behavior.
- **Frontend lint (`eslint`):** clean on all 3 modified files, exit code 0.
- **Frontend production build / full CI suite:** **not run this pass** (time/scope) — recommended before merge if the team wants that additional confidence; not a blocker given the changes are timeout values and lint passed clean.
- **Migration / fresh Alembic chain against Postgres:** **not run** (no Postgres access from this environment). The disposable SQLite backend's own startup migrations (`init_db()`) ran cleanly against a real-data copy with no errors, which is the SQLite-side equivalent check.
- **Workflow smoke (REQ/RFQ/CMP/Approval/PO/Payment/Receiving):** not manually re-walked as a UI smoke test this pass; covered indirectly by the passing pytest suite (dedicated test files exist per workflow area) and by the load harness successfully exercising REQ/RFQ/comparison/approval/PO/payment list endpoints for over 29,000 requests with 0 errors during the soak test.

---

## 42. Commits

See git log on `fix/pre-golive-hardening` for the focused, root-cause-grouped commits made after this report (perf(db)/fix(whatsapp)/perf(api)/perf(frontend) style, each independently reviewable). Nothing was pushed.

---

## 43. Remaining risks (not fixed this pass, with reasons)

1. **S3/R2 attachment calls block the event loop** the same way the WhatsApp call did (§14) — same architectural root cause, not fixed because there was no S3/R2 test environment available here to prove a before/after, and touching ~10 call sites across 5 files without that proof would violate this audit's own discipline.
2. **Dashboard/daily-report O(n) Python-side aggregation** (§6) — real, measured, currently small (25-33ms at 401 rows) but will grow linearly with the business's real data. Needs a scoped follow-up into `calculate_procurement_kpis`/`_dashboard_procurement_intelligence`, which this pass didn't otherwise touch.
3. **Horizontal scaling blockers** (§36): rate limiter is per-process only; business-code sequence concurrency safety across instances unverified; WhatsApp dedup not load-tested across 2 real instances.
4. **Postgres pool sizing** is now configurable but the actual numbers need verification against the real Render plan's `max_connections` and vCPU count — this audit had no way to obtain either.
5. **`/api/purchase-orders`, `/payments`, `/price-history` pagination** — same class of gap as the fixed incoming-requests endpoint, not yet measured as harmful at today's real data volume.
6. **Frontend request cancellation** (`AbortController`) is absent everywhere — no measured harm found, but also never implemented.
7. **Render's own reverse-proxy timeout** was never verified from this environment.
8. Soak test ran 8 minutes, not the suggested 15-30 — a longer run would add confidence but the 8-minute trend was already flat with no sign of onset.

---

## 44. Final report

**A. Environment** — Windows 11 desktop (local machine ProcureX runs on), SQLite (disposable copy), 1 backend process.

**B. Baseline** (tiny real-data volume, c=1, best scenario): RPS 140.3, p50 6.4ms, p95 10.7ms; CPU ~86% avg; memory: see soak test, §11 (119MB steady-state).

**C. Bottlenecks** — CRITICAL: WhatsApp webhook blocking the event loop (fixed). HIGH: single-process serialization of all blocking I/O (architectural, documented, not changed — needs Postgres `--workers`); S3/R2 attachment calls, same pattern as WhatsApp (not fixed, no test env). MEDIUM: dashboard/daily-report O(n) Python aggregation (not fixed, scoped follow-up); Postgres pool config gap (fixed, config-only); incoming-requests pagination (fixed). LOW: PO/payments/price-history pagination, frontend cancellation (both documented, not fixed).

**D. Database** — slowest endpoints under scale: `/api/dashboard`, `/api/reports/daily` (25-33ms at 401 rows, Python-side, not query-side). Slow queries: none found (all under 2ms DB time). Query counts: 3-22 per endpoint, no N+1 found. Indexes: already comprehensive, none added. Pool/locking: SQLite `busy_timeout` fixed (88%→0% write failure under contention); Postgres pool now configurable, sizing unverified against real plan limits.

**E. Memory** — `MEMORY_LEAK_SUSPECTED = NO`. Evidence: 8-minute soak, 29,357 requests, RSS 119.26MB→117.06MB (flat/slightly down), per-minute breakdown shows no drift.

**F. CPU** — `CPU_SATURATION_POINT` = not a hard multi-core ceiling; the constraint is architectural (single event-loop thread), effectively reached around c≈10 where latency already triples.

**G. Requests** — max in-flight observed: 50 (test ceiling, not a system-imposed limit — none exists). Long-running endpoint: WhatsApp webhook, previously up to 15s app-wide freeze (fixed). Pile-up behavior: pure implicit queuing, no admission control, no errors up to c=50, latency grows ~linearly with concurrency.

**H. External services** — WhatsApp: 15s timeout, no retries (correct, non-idempotent), was blocking → fixed. S3/R2: ~60s+60s botocore defaults, not reviewed/tuned, same blocking pattern as WhatsApp → not fixed (no test env). Document extraction: 120s timeout, good existing background-worker retry pattern, no fix needed. Circuit breaker: rejected for both remaining external deps — no measured recurring-failure need.

**I. Cache** — `CACHE_IMPLEMENTED` = none added this pass (daily-report closed-date cache already existed, unchanged). `CACHE_REJECTED` = lookup-data (suppliers/items/projects) caching — no measured DB-bound latency to justify it (all under 10ms already).

**J. Load** (Scenario C, best case, tiny real-data volume):
| c | p95 | error% | RPS |
|---|---|---|---|
| 1 | 10.7ms | 0% | 140.3 |
| 5 | 44.1ms | 0% | 155.4 |
| 10 | 101.1ms | 0% | 138.6 |
| 20 | 217.4ms | 0% | 127.1 |
| 50 | 1187.5ms | 0% | 107.9 |

**K. Saturation** — `SAFE_CONCURRENCY` ≈ 5. `DEGRADATION_STARTS` ≈ 10. `FAILURE_POINT` = not reached by c=50 (degrades to slow, not broken).

**L. Fixes** — see §28 root-cause matrix and §29 priority list; each with its measured evidence inline.

**M. Before/after** — see §40; SQLite write-contention 12%→100% success is the clearest apples-to-apples number; others are config/mechanism proofs rather than clean read-path RPS deltas, since the fixes made don't touch the read-path architecture (that needs the not-yet-actionable `--workers`-on-Postgres change).

**N. Scaling** — `CURRENT_SAFE_TO_SCALE_HORIZONTALLY = NO`. Blockers: (1) rate limiter is per-process/in-memory only, (2) business-code sequence concurrency across instances unverified, (3) WhatsApp dedup not load-tested across 2 real instances. Vertical/process scaling on the Postgres surfaces is the recommended near-term lever, gated on verifying Render's actual plan limits (not available to this audit).

**O. Tests** — backend: 100% pass (full pytest suite + targeted WhatsApp re-run). Frontend: eslint clean; full build/CI suite not run this pass. Migration: SQLite-side `init_db()` clean against real-data copy; Postgres/Alembic chain not verified (no access). Workflow: covered indirectly via passing tests + soak-test traffic across REQ/RFQ/comparison/approval/PO/payment endpoints, not manually re-walked as a UI smoke test.

**P. Commits** — see git log on `fix/pre-golive-hardening` immediately following this report.

**Q. Git status** — clean before this audit started (verified via `git status`/`git log` at HEAD `9963093`); all changes in this pass are new working-tree edits to 8 tracked files plus one new file (`backend/diagnostics.py`), grouped into focused commits; nothing pushed.

---

## PROCUREX_PERFORMANCE_REVIEW = PASS_WITH_RECOMMENDATIONS

---

## Production Concurrency & Scaling

*Added 2026-09-24. Full measurements, method and deployment profiles: `docs/production-capacity-plan.md`.* This follow-up had a disposable PostgreSQL 16 instance (seeded through the real API), so it **supersedes** the configuration-only statements in §10 and §34–36 above ("do not change pool sizes / do not add `--workers` until…").

**What was measured:** 1/2/4 uvicorn workers at 1–75 concurrent users with a weighted ERP mix; memory per worker; slow-request isolation; pool size, overflow and exhaustion (including a stuck table lock); PostgreSQL statement profile; overload and recovery; graceful shutdown; cross-process races on business codes, seven write paths and the document-job queue.

**Findings that changed the plan**
- Throughput is **CPU-bound per worker** (sync DB on the event loop; see §1), not DB-bound: ≤4 active Postgres connections in every run. 2 workers ≈ 2× throughput and pass slow-request isolation (light-page p95 beside heavy users 471 ms → 81 ms).
- Uvicorn's default 5 s keep-alive dropped **8.7%** of requests at 50 users (late timer on a busy loop). `--timeout-keep-alive 65` → 0%.
- A stuck DB lock froze a whole worker for the full lock duration, and a deploy could not shut the process down. There was no statement or lock timeout.
- **Live bug (single worker):** corrected-REQ resubmission created duplicate child REQs under concurrent clicks (4 from 10). **Scaling bugs:** duplicate POs from one comparison across 2 processes; document-extraction jobs processed twice (57/60); closed daily-report cache stale across workers; concurrent duplicates returned 500.

**Fixed (each measured before and after):** Postgres `statement_timeout` 10 s / `lock_timeout` 3 s; pool defaults 5 / overflow 2 / timeout 5 s; pool, statement and lock timeouts → 503 + `Retry-After`, unique-constraint races → 409; row locks for PO-from-comparison and corrected-REQ resubmission; `FOR UPDATE SKIP LOCKED` job claim; `closed_at`-keyed report cache; `render.yaml` ERP `WEB_CONCURRENCY=2`, public 1, `--timeout-keep-alive 65 --timeout-graceful-shutdown 20`.

**Still open:** HORIZONTAL_SCALING_READY = NO (WhatsApp webhook commit order and draft locking; per-process rate limiters; Linux multi-worker validation on staging). Render plan CPU/RAM, Postgres `max_connections` and proxy timeouts are UNKNOWN from the repo (capacity plan §11). The N+1 in `GET /api/workflow/approvals` (203 queries per call) is the top query-level follow-up.

## PRODUCTION_CONCURRENCY_REVIEW = PASS_WITH_EXTERNAL_VALIDATION
