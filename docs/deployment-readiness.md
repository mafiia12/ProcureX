# ProcureX deployment readiness

Status: preparation only. Nothing in this repository deploys the internal ERP,
creates a cloud resource, or migrates the populated local database automatically.

## Environment boundaries

| Environment | Surface | Database | Attachments | Exposure |
|---|---|---|---|---|
| Local development | `full` | Local SQLite | Local filesystem | Loopback/private network only |
| Staging | `public` | Separate PostgreSQL | Separate private R2 bucket | Public request form and `/api/public/*` only |
| Staging | `full` (`procurex-erp-api`/`procurex-erp-app`) | Same staging PostgreSQL as the `public` service | Same staging private R2 bucket | Internal ERP only, behind JWT auth - never the public intake form |
| Production | `public` | Production PostgreSQL | Production private R2 bucket | Public request form and `/api/public/*` only |
| Production | `full` (`procurex-erp-api`/`procurex-erp-app`) | Same production PostgreSQL as the `public` service | Same production private R2 bucket | Internal ERP only, behind JWT auth - never the public intake form |

`APP_ENV=staging` and `APP_ENV=production` accept either `APP_SURFACE=full`
(the internal ERP) or `APP_SURFACE=public` (the anonymous request form);
`_validate_hosted_configuration` in `server.py` enforces baseline hardening
on both - HTTPS-only CORS origins, explicit trusted hosts, `FORCE_HTTPS=true`,
and a strong `AUTH_SECRET_KEY` - plus surface-specific requirements: `public`
additionally requires PostgreSQL, S3-compatible attachment storage, R2
credentials, and a privacy salt; `full` additionally requires
`INTERNAL_REQUEST_TOKEN` whenever `TRUST_PROXY_HEADERS=true` (see
`render.yaml`'s `procurex-erp-api` service). The internal ERP is protected by
JWT authentication and per-role authorization (`backend/auth/`, since
revision 0012) and workflow actions are recorded to `workflow_audit_events`
(`procurement_workflow.py`'s `_audit`) - see "Remaining blockers" below for
what audit coverage does not yet include.

Templates:

- Local API: `backend/.env.example`
- Local frontend: `frontend/.env.example`
- Staging API/frontend: `deploy/env/staging-*.env.example`
- Production API/frontend: `deploy/env/public-*.env.example`
- Production migration: `deploy/env/production-migration.env.example`
- Production backups: `deploy/env/backup.env.example`

## Mandatory quality gate

`.github/workflows/ci.yml` must be a required branch-protection check. Its
`release-gate` job succeeds only after all of these checks succeed:

1. Full backend pytest suite.
2. Python `compileall`.
3. Single Alembic head and a complete upgrade on a disposable SQLite database.
4. SQLite integrity and foreign-key verification.
5. Full frontend test suite.
6. Full internal ERP production build.
7. Public-only production build plus bundle scanning for internal route/API markers.

Configure Render with `autoDeployTrigger: checksPass`. Production deployment is
forbidden if the `release-gate` check is missing, skipped, stale, or unsuccessful.
The tested commit SHA must be the same SHA passed to the migration runner.

## Staging checklist

- [ ] The CI `release-gate` passes for the exact candidate commit.
- [ ] Create a staging-only PostgreSQL database and private R2 bucket.
- [ ] Use distinct staging credentials, privacy salt, hostnames, and CORS origins.
- [ ] Review `render.staging.yaml`; creating its resources requires approval.
- [ ] Apply Alembic to staging and run `assert_schema_current.py`.
- [ ] Confirm `/api/public/purchase-requests` and its health route work.
- [ ] Confirm `/api/internal/*`, `/api/purchases`, `/api/items`, `/docs`, and
      `/openapi.json` return 404.
- [ ] Submit one disposable request, verify private attachment storage, then test
      duplicate, rate, MIME/signature, size, CORS, RTL, and mobile behavior.
- [ ] Perform a staging backup-and-restore drill into a new empty database.

## Production migration and deployment checklist

- [ ] Staging acceptance is signed off.
- [ ] The CI `release-gate` passes for the exact production commit.
- [ ] Branch protection prevents bypassing required checks.
- [ ] Production PostgreSQL and the attachment/backup R2 buckets are private.
- [ ] Attachment and backup tokens are separate and bucket-scoped.
- [ ] Run the production migration container from the repository root only after
      setting the variables in `production-migration.env.example`:

  ```powershell
  docker build -f deploy/migrate/Dockerfile -t procurex-migration-gate .
  docker run --rm --env-file deploy/env/production-migration.env procurex-migration-gate
  ```

  The runner refuses non-production/full-surface configurations and a missing CI
  attestation. It creates a custom-format `pg_dump`, validates it with
  `pg_restore --list`, uploads the dump and SHA-256 to private R2, downloads the
  object, verifies its checksum and archive again, and only then runs `alembic
  upgrade head`.

- [ ] `render.yaml` performs only `assert_schema_current.py`; it never migrates
      automatically during deployment.
- [ ] Deploy the public API and public-only frontend from the tested commit.
- [ ] Verify the public route allowlist at the application and edge layers.
- [ ] Verify TLS, exact CORS/trusted-host values, security headers, rate limits,
      private R2 objects, monitoring, and the first automated backup.
- [ ] Keep the local SQLite database and workbook unchanged and retained.

## Rollback checklist

- [ ] Stop new public submissions before changing any target.
- [ ] Before DNS cutover, abort and keep the local ERP unchanged.
- [ ] After cutover but before accepted submissions, restore the former DNS target
      or maintenance page; retain PostgreSQL and R2 for investigation.
- [ ] After accepted submissions, never revert blindly to SQLite. Reconcile the
      request/status/attachment delta first.
- [ ] Prefer a fix-forward release or restore PostgreSQL PITR/a verified dump into
      a new database. Never restore over the current database.
- [ ] Run schema, count, financial-total, foreign-key, and attachment-key checks on
      the recovery target before switching `DATABASE_URL`.
- [ ] Retain the former database until the observation period and approval end.

## Remaining blockers before go-live

- Audit coverage is partial: workflow actions (requests, RFQ/quotations,
  comparisons, approvals, conversions) are recorded to
  `workflow_audit_events`, but login attempts and admin user-management
  actions are not yet audited. Decide whether that gap must close before
  go-live or can follow it.
- `render.yaml`/`render.staging.yaml` now define the ERP services
  (`procurex-erp-api`, `procurex-erp-app`) alongside the public ones, but
  nothing has actually been provisioned yet: no staging or production
  secrets, DNS, TLS, WAF rules, monitoring, retention policy, or restore
  drill have been created or verified for either surface.
- CI's `release-gate` now requires a PostgreSQL smoke test
  (`backend-tests-postgres-smoke`) in addition to the SQLite-based checks,
  but the full pytest suite still only ever runs against SQLite -
  `backend/tests/backend_test.py` hardcodes its own `DATABASE_URL` at import
  time. Making the full suite honour PostgreSQL is a separate, scoped
  change (every test's fixtures/cleanup would need auditing for
  SQLite-specific assumptions), not yet done.
- Branch protection must require the CI `release-gate`.
- Provider pricing and capacity must be rechecked immediately before purchase.
