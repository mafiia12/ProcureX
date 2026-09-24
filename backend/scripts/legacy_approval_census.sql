-- ProcureX legacy approval census: READ-ONLY.
--
-- Answers whether production still holds legacy external-engineer approvals
-- or payments before the V1 launch (docs/production-capacity-plan.md
-- section 17). Writes nothing: the whole script runs in a READ ONLY
-- transaction, which PostgreSQL refuses to let modify data.
--
--   psql "$PRODUCTION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/legacy_approval_census.sql
--
-- Only run it against production when production DB access has been
-- explicitly provided for this purpose.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

-- 1. Approvals by type (the launch question).
SELECT approval_type, count(*)
FROM engineer_approvals
GROUP BY approval_type
ORDER BY approval_type;

-- 2. Legacy approvals by status (only relevant if 1 shows external_engineer).
SELECT approval_type, status, count(*)
FROM engineer_approvals
WHERE approval_type <> 'comparison_workflow'
GROUP BY approval_type, status
ORDER BY approval_type, status;

-- 3. Legacy direct payments (approval_payments is used only by the legacy flow).
SELECT count(*) AS approval_payments FROM approval_payments;

SELECT method, status, count(*)
FROM approval_payments
GROUP BY method, status
ORDER BY method, status;

-- 4. The deferred index defect: non-cash payments share cash_reference = ''
--    under a plain unique index, so at most one can ever exist.
SELECT count(*) AS blank_cash_reference_payments
FROM approval_payments
WHERE cash_reference = '';

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'approval_payments' AND indexname = 'ix_approval_payments_cash_reference';

ROLLBACK;
