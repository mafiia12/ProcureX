## ProcureX change checklist

- [ ] Backend tests, frontend tests, Python compilation, both production builds,
      migration validation, and database integrity checks pass.
- [ ] Any SQLAlchemy schema change includes a new additive Alembic revision; no
      existing revision was edited after release.
- [ ] The migration preserves populated databases and has an explicit backup and
      rollback/restore plan.
- [ ] Public builds and `APP_SURFACE=public` expose only `/api/public/*`.
- [ ] No real secret, database, workbook, generated attachment, or backup was added.
- [ ] Production deployment remains blocked unless the required `release-gate`
      check passes for this exact commit.
