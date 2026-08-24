# ProcureX deployment readiness

Status: preparation only. Nothing in this repository deploys the internal ERP,
creates a cloud resource, or migrates the populated local database automatically.

## Environment boundaries

| Environment | Surface | Database | Attachments | Exposure |
|---|---|---|---|---|
| Local development | `full` | Local SQLite | Local filesystem | Loopback/private network only |
| Staging | `public` | Separate PostgreSQL | Separate private R2 bucket | Public request form and `/api/public/*` only |
| Production | `public` | Production PostgreSQL | Production private R2 bucket | Public request form and `/api/public/*` only |

`APP_ENV=staging` and `APP_ENV=production` both fail startup if the full ERP
surface is requested. They also require PostgreSQL, HTTPS-only CORS origins,
explicit trusted hosts, `FORCE_HTTPS=true`, S3-compatible attachment storage,
R2 credentials, and a privacy salt. The full dashboard and all internal APIs
remain local until authentication, authorization, and audit logging are complete.

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

- Internal ERP authentication, role authorization, and audit logs are not yet
  implemented; therefore the internal ERP must remain private/local.
- No staging or production resources, secrets, DNS, TLS, WAF rules, monitoring,
  retention policy, or restore drill have been created or verified.
- Branch protection must require the CI `release-gate`.
- Provider pricing and capacity must be rechecked immediately before purchase.
