# Changelog

## 0.3.0 - stabilization candidate

- Established external recovery, data exclusions, and a restorable Git bundle.
- Added additive Alembic migrations through revision
  `0006_construction_calculator` and a fail-closed adoption workflow for existing
  unversioned SQLite databases.
- Added durable business codes, supplier price comparison, and reviewed document
  capture/OCR workflows.
- Added Arabic/English catalogs, RTL/LTR layout, and Light/Dark/System themes.
- Added an offline Windows launcher, verified SQLite backup/restore utilities,
  and installer source.
- Made purchase, line-item, history, and payment writes atomic; added normalized
  invoice duplicate detection and idempotent payment submission handling.
- Added manifest-backed database and attachment backups, schema compatibility
  checks, rollback-safe restore, and corrupt-live-database recovery preservation.
- Added safe diagnostics, bounded folder actions, generic user-facing errors,
  private rotating logs, and unsaved-change guards on transactional screens.
- Aligned backend and frontend financial rounding, improved Excel export print
  layout and number formats, and completed Arabic/English operational labels on
  purchases, payments, settings, and supplier comparison screens.
- Unified release metadata at version 0.3.0 across the frontend, launcher,
  desktop host, and installer.
- Removed every active Construction Consumption and Execution Calculator surface.
  Only its migration and historical schema models remain for compatibility and
  preservation; existing historical rows are untouched, and no router, seeding,
  rate workbook, or calculator translation catalog ships in the release.

Validation completed with 70 backend tests, 50 frontend tests across 17 suites,
3 desktop backup/restore tests, 10 launcher integration scenarios, fresh and
adopted Alembic database gates, production builds, public-build isolation, and
interactive UI checks. The ProcureX 0.3.0 installer was built and passed an
isolated install/repair/uninstall cycle, including shortcut and data-preservation
checks. No commit, tag, push, or publication occurred during this pass.
