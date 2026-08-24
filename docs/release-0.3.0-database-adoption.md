# ProcureX 0.3.0 real-database adoption record

Date: 2026-08-02

Both real SQLite databases were adopted independently at Alembic revision
`0006_construction_calculator` using the Phase 0 fail-closed workflow. No
historical migration was executed against either populated schema and no
force-stamp path was used.

## Development database

- Semantic schema matched a fresh 0006 schema before adoption.
- All 48 business/history table counts and every row digest were unchanged.
- Invoice total: 38,676; purchase-line total: 38,636; payments: 38,676;
  outstanding: 0, before and after.
- SQLite integrity: `ok`; foreign-key violations: 0.
- Two independent reopen checks retained revision 0006 and all fingerprints.

## Installed database

- The pre-adoption logical shape matched the original Phase 0 backup exactly.
- The expected default-definition mismatch was limited to `items`,
  `purchase_items`, and `price_history`.
- The documented reconciliation rebuilt only those three empty tables after a
  verified backup. Counts, values, row digests, and financial totals remained
  unchanged.
- Semantic schema then matched a fresh 0006 schema before adoption.
- SQLite integrity: `ok`; foreign-key violations: 0.
- Two independent reopen checks retained revision 0006 and all fingerprints.

The detailed backups, manifests, semantic comparisons, counts, totals, and
adoption reports are retained outside the repository under recovery set
`phase1-20260802T094748Z`.
