# ProcureX 0.3.0 stabilization baseline

Status: stabilization implementation and release validation complete;
procurement-only; awaiting approval before final commit/tag; not published.

## Approved product surface

ProcureX 0.3.0 covers procurement masters and transactions, incoming purchase
requests, supplier price comparison, reviewed document capture, Arabic/English
localization, RTL/LTR layout, display themes, and the local Windows desktop host.

The Construction Consumption and Execution Calculator is unavailable. It is not
part of this release and is not part of the approved roadmap. There is no
user-accessible frontend page, navigation entry, API client, translation catalog,
backend API, or automatic reference-data installation. Only compatibility migration
and schema models remain bundled so preserved historical databases continue to open.

Alembic migration `0006_construction_calculator` is intentionally retained
unchanged. Existing historical construction tables and reference rows are also
retained unchanged for compatibility and data preservation. Their presence does
not make the calculator an active product capability.

## Database adoption rule

An existing SQLite database without `alembic_version` must not receive historical
migrations blindly. `backend/scripts/adopt_existing_sqlite.py` creates a fresh
reference schema, compares the candidate semantically, stops on any mismatch,
creates a verified SQLite backup, rechecks under an immediate transaction, and
only then records revision `0006_construction_calculator`. It compares before and
after counts, financial totals, and row digests. There is no force-stamp path.

Adoption was proven first on separate development and installed database clones.
The real databases were not stamped or migrated during Phase 0.

## Final stabilization verification

- Fresh Alembic upgrade reached the single head at revision 0006.
- Existing development clone adoption completed fail-closed with exact count,
  financial-total, and row-digest preservation. The adopted clone and a fresh
  database both reached the single Alembic head at revision 0006.
- Final read-only development and installed database audits matched the external
  recovery baseline for every table count and financial total, with integrity
  `ok` and zero foreign-key violations.
- External SQLite Backup API copies restored successfully in temporary locations.
- Backend suite: 70 passed.
- Frontend suite: 50 passed across 17 suites.
- Desktop backup/restore suite: 3 passed, including attachments, incompatible
  schema rejection, and corrupt-live-database fallback preservation.
- Launcher integration suite: 10 passed, covering clean/repeated start, clean
  shutdown, external-service reuse, occupied-port protection, missing dependency,
  and restart persistence.
- Internal and public production frontend builds completed successfully; the
  public-build isolation scan passed across both generated assets, after which
  the internal build was regenerated.
- Interactive UI validation covered Arabic/English, RTL/LTR, Light/Dark/System,
  purchases, payments, settings diagnostics and verified backup creation,
  supplier comparison, unsaved-change protection, horizontal overflow, print
  rules, and browser console errors.
- `git diff --check` completed without whitespace errors.
- The 0.3.0 installer was rebuilt from a fresh frozen runtime. Its 113-file
  payload passed the sensitive/development-file scan with zero matches, and its
  generated manifest matches the Setup byte count, SHA-256, and 0.3.0 metadata.
- The isolated installer cycle passed a path containing spaces, runtime startup
  without system Python or Node, Start Menu/Desktop shortcuts, verified backup,
  repair/upgrade preservation, default uninstall preservation, explicit test-data
  deletion, shortcut removal, and final process/port cleanup.

The launcher, desktop host, and installer are version 0.3.0. The generated Setup
SHA-256 is `a9770f28934733d25e4916fb834ecc3a3d512ac1cc6194d572b76aa32f1b443f`.
All required release gates completed successfully before this report.

## Release boundary

The 0.3.0 installer was built and tested locally but was not published. No commit,
tag, push, or release was created. Final commit/tag and any publication require
explicit approval after review of this report; roadmap expansion remains out of
scope.
