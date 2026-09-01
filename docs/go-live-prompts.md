# ProcureX — برومبتات إصلاح ما قبل الإطلاق

البرومبتات دي مكتوبة بالإنجليزي عن قصد: الريبو والتعليقات والـ docs كلها إنجليزي، والوكيل بيبقى أدق لما اللغة تطابق الكود.

**قبل ما تلزق أي برومبت:**

```bat
cd /d D:\MAIN PROJ
git status
git checkout -b fix/pre-golive-hardening
```

لازم `git status` يطلع clean الأول. الفايدة إن أي حاجة تتعمل تقدر ترجّعها بـ `git checkout -- .` أو `git reset --hard`.

---

## البرومبت الأول — إصلاحات مستقلة عن الاستضافة

دي الحاجات اللي لازم تتعمل مهما كانت هتستضيف فين. الزقه كله مرة واحدة.

```text
You are working on ProcureX, a FastAPI + React procurement ERP at D:\MAIN PROJ.
Read before you write. Do not refactor anything outside the scope below.

CONTEXT (verified, do not re-litigate):
- Alembic is at a single head, 0021_whatsapp_settings_and_source.
- Authentication (JWT + roles) exists in backend/auth/ since revision 0012.
- server.py::_validate_hosted_configuration already gates hosted deployments.
- attachment_storage.py::build_attachment_storage already fails closed on
  bad hosted config. Neither of those needs changing in this pass.

SAFETY CONSTRAINTS (non-negotiable):
- Never modify, move, or delete: backend/procurement.db, backend/*.db*,
  backend/workbook.xlsm, backend/backups/, logs/, or anything in .venv/.
- Do not create new Alembic revisions. No schema changes in this pass.
- Do not change existing public-surface behaviour. Existing tests must pass
  unchanged.
- Make one commit per task, with a message explaining the why, not the what.

Before editing anything, print a short plan: which files you will touch for
each task and what could break. Then stop and wait for my approval.

=== TASK A (highest priority) — fix the SQLite to PostgreSQL migration script

File: backend/scripts/migrate_sqlite_to_postgres.py

The bug: TABLE_ORDER is a hardcoded list of 21 tables written around Alembic
revision 0007. Every table added since then is silently absent, including
users (0012), the purchase-order workflow (0008/0009), approval business
stages (0010), site receiving (0011), site portal requests and attachments
(0013/0014), RFQ and supplier quotations (0015), the PO payment ledger
(0016), corrected-request ancestry (0017), supplier offer adjustments
(0018), daily reports (0019), and WhatsApp intake and settings (0020/0021).
Run today, the script succeeds and reports success while leaving all of that
data behind, because it never looks for it.

Required changes:
1. Import every module that defines SQLAlchemy models, then derive the copy
   order from Base.metadata.sorted_tables (already topologically sorted by
   foreign key) instead of the hardcoded list. To find the modules: search
   backend/ for __tablename__ and make sure each defining module is imported
   by this script. Note that backend/alembic/env.py imports models
   conditionally on purpose (so the 0001 baseline does not create later
   tables early) - that constraint does NOT apply here, so import them all.
2. Keep TABLE_ORDER, but demote it to a KNOWN_TABLES assertion set. Before
   copying anything, compare it against Base.metadata.tables and abort with
   a clear message listing any table that is in metadata but not in the copy
   plan. The point is that the next person who adds a migration and forgets
   this script gets a loud failure instead of silent data loss.
3. Also inspect the source SQLite file. Any table present there but absent
   from metadata must be reported explicitly, not silently skipped.
4. Extend TOTALS so the post-copy financial verification actually covers the
   money columns on the newer tables (supplier quotations/offers, the PO
   payment ledger). Read those models first and pick the real numeric
   columns - do not guess column names.
5. Add a per-table source-vs-target row count report printed in both dry-run
   and --execute modes.
6. Preserve all existing behaviour: read-only unless --execute, consistent
   SQLite backup taken first, full rollback if any count or total differs.

Then verify: run the script in dry-run mode against backend/procurement.db
with DATABASE_URL pointing at a THROWAWAY local Postgres (docker run, or
skip if Docker is unavailable and say so). Show me the table list it
produces and confirm every table from every Alembic revision appears.

=== TASK B — brute-force protection on login

Files: backend/incoming_requests.py, backend/auth/router.py, and a new
backend/rate_limit.py

Right now the only rate limiter in the codebase is _check_rate_limit in
incoming_requests.py (an in-memory sliding window keyed by hashed client IP,
configured by PUBLIC_REQUEST_RATE_LIMIT and PUBLIC_REQUEST_RATE_WINDOW_SECONDS),
and it is applied only to public purchase-request submission. POST
/api/auth/login has no throttle at all, so once the ERP is on the internet
the login endpoint is open to unlimited password guessing.

Required changes:
1. Extract the sliding-window helper into backend/rate_limit.py as a small
   reusable class. The public-request path must keep byte-for-byte identical
   behaviour and env var names - this is a pure extraction for that caller.
2. Apply a login throttle in auth/router.py, counting per hashed client IP
   AND per submitted username, whichever trips first. New env vars:
   AUTH_LOGIN_RATE_LIMIT (default 10) and AUTH_LOGIN_RATE_WINDOW_SECONDS
   (default 900). Respond 429 with a Retry-After header.
3. A successful login clears that username's counter. A failed login must
   return the exact same message it returns today - no user enumeration, and
   the throttle response must not reveal whether the username exists.
4. Add a comment stating plainly that this store is per-process, so it is
   correct at one instance and would need shared state if the service is
   ever scaled horizontally.
5. Add backend tests: locked out after N attempts, 429 carries Retry-After,
   successful login resets, two different usernames throttle independently.
6. Add both new vars to backend/.env.example with short comments.

=== TASK C — prove the app actually works on PostgreSQL

File: .github/workflows/ci.yml

Every existing check runs against SQLite. Production will be PostgreSQL and
nothing has ever exercised that combination, so dialect differences (types,
JSON handling, autoincrement, ordering, locking) are completely untested.

First, read backend/tests and backend/pytest.ini and tell me how the test
database is chosen. If the suite honours DATABASE_URL, add a
backend-tests-postgres job using a postgres:16 service container that runs
alembic upgrade head and then the full suite against it. If the suite hard-
codes SQLite, do NOT fake it: instead add a job that runs alembic upgrade
head against Postgres and then boots the app against that database and hits
a real endpoint, and tell me clearly that full suite coverage on Postgres
needs a conftest change we should scope separately.

Either way, add the new job to release-gate's needs list and to its
assertion block, so it is genuinely required and not decorative.

=== TASK D — correct the stale deployment doc

File: docs/deployment-readiness.md

It still states that APP_SURFACE=full fails startup in staging/production and
that the internal ERP must stay local until authentication exists. Both were
true when it was written and are false now. Correct those statements, and
rewrite the "Remaining blockers" section to reflect what is actually left.

Do not delete the staging/production/rollback checklists - they are still
good. Only fix what is factually wrong.
```

---

## البرومبت الثاني — Render فقط

**متلزقش دا غير لو استقريت على Render فعلاً.** لو هتستضيف على حاجة تانية قوللي وأكتبلك واحد بديل.

```text
Continue on ProcureX. Same safety constraints as before: no schema changes,
never touch backend/procurement.db or workbook.xlsm, one commit, and print a
plan before editing.

Goal: render.yaml and render.staging.yaml currently define only the public
surface - the public request API, the public form static site, the Postgres
database, and the nightly backup cron. There is nothing for the internal ERP,
so today the ERP simply cannot be deployed from this repo.

Add to render.yaml (and mirror into render.staging.yaml with staging plans
and names):

1. A web service procurex-erp-api:
   - runtime python, rootDir backend, same build command as the public API
   - startCommand mirroring the public API's, including --proxy-headers
   - preDeployCommand: python scripts/assert_schema_current.py
     (keep deployment read-only with respect to schema, exactly like the
     public API - migrations stay in the verified migration container)
   - healthCheckPath: read server.py and use a route that actually exists on
     the full surface. Do not invent one. If no suitable lightweight
     unauthenticated health route exists on the full surface, say so and
     propose adding one rather than pointing the check at an authenticated
     endpoint.
   - envVars: APP_ENV=production, APP_SURFACE=full,
     AUTH_SECRET_KEY with generateValue: true,
     DATABASE_URL fromDatabase (the SAME procurex-public-postgres instance),
     ATTACHMENT_STORAGE_BACKEND=s3 plus the R2 vars (sync: false),
     CORS_ORIGINS and TRUSTED_HOSTS (sync: false),
     FORCE_HTTPS=true, TRUST_PROXY_HEADERS=true,
     INTERNAL_REQUEST_TOKEN with generateValue: true,
     PUBLIC_BASE_URL and the WHATSAPP_* vars (sync: false).

   Why ATTACHMENT_STORAGE_BACKEND=s3 matters here: the code permits local
   disk on the full surface in production, but only at an explicit path
   outside the application directory. Render's filesystem is ephemeral and
   no such path exists, so the service would either refuse to start or lose
   attachments on every deploy. S3/R2 is the only correct setting on Render.

   Why INTERNAL_REQUEST_TOKEN matters: with TRUST_PROXY_HEADERS=true on the
   full surface, _validate_hosted_configuration refuses to start without it,
   because the localhost fallback in the internal-access gate becomes
   spoofable from the internet behind a proxy.

2. A static site procurex-erp-app:
   - rootDir frontend, buildCommand using npm run build (the full ERP build,
     not build:public), staticPublishPath build
   - envVars: REACT_APP_BACKEND_URL (sync: false) and GENERATE_SOURCEMAP=false
   - the same SPA rewrite and the same four security headers the public form
     already sets
   - add a comment noting that REACT_APP_BACKEND_URL is inlined at build
     time by Create React App, so changing it requires a rebuild, not a
     restart.

3. A new deploy/env/erp-api.env.example documenting every variable above,
   in the same style as the existing deploy/env templates.

4. At the top of the erp-api service, a short comment block recording the
   architectural choice: two separate API services (public and full) sharing
   one database, so that the internet-facing request form does not run in
   the same process as the ERP code. Also note the cheaper single-service
   alternative (APP_SURFACE=full already mounts the public and WhatsApp
   routers) and why it was not chosen.

Finally, validate the YAML parses and tell me what each new service will
cost per month on the plan you selected.
```

---

## بعد ما الوكيل يخلص

```bat
cd /d D:\MAIN PROJ
git diff --stat
.venv\Scripts\python.exe -m pytest backend\tests -q
.venv\Scripts\python.exe -m compileall -q backend
cd frontend && npm run test:ci
```

راجع الـ diff بنفسك قبل الـ merge — خصوصًا `migrate_sqlite_to_postgres.py`، لأنه الملف اللي لو غلط هيغلط في الداتا الحقيقية.
