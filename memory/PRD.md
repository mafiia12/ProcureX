# RE DECOR & MORE — Procurement ERP: PRD

## Original Problem Statement
Build a professional full-stack Procurement ERP from an existing Excel workbook (PRI-RE_DECOR_Procurement_ERP_4.xlsm). The workbook is the business-logic reference. Arabic RTL interface, blue/white/gray corporate design, RE DECOR & MORE branding. Migrate real workbook data only (no sample data). Excel import/export required.

## User Choices
- Approved schema/plan; no authentication (no login); ignore stray PUR row in Suppliers sheet; currency EGP.

## Architecture
- FastAPI + SQLite (SQLAlchemy) backend, React 19 + shadcn/ui + Tailwind (RTL) + Recharts frontend.
- Backend: `backend/server.py` (all API routes, /api prefix), `backend/excel_io.py` (workbook parse / idempotent import / export builder), `backend/migrate.py` (idempotent migration from `workbook.xlsm`).
- Frontend: `src/components/Layout.jsx` (RTL sidebar shell), `src/components/CrudPage.jsx` (generic CRUD), pages: Dashboard, Purchases, PurchaseRegister, PriceHistory, Payments, Suppliers, Items, Projects, Customers, SettingsPage. `src/lib/api.js` axios + EGP formatter.

## Normalized Entities (SQLite tables)
suppliers, customers, projects, items, purchases, purchase_items, payments, price_history, settings (12 dropdown lists).

## Business Logic Preserved (from workbook formulas + VBA)
- Auto IDs: PUR-###### (purchases), PAY-### (payments), po-#### (PO), SUP-/CUS-/prj-/ITM codes.
- Line total = qty × price × (1 − disc%) × (1 + vat%). Summary: subtotal → discount → after-discount → VAT → +shipping/+other → final total.
- Duplicate invoice prevention (invoice_number + supplier → 409).
- Validation: date, invoice no., supplier/project/customer required, qty>0, price>0, ≥1 item, total>0 (Arabic messages).
- Save purchase = header + purchase_items + price_history rows + form clear.
- Payments: linked to purchase, auto lookup, remaining = max(0, total − paid), status غير مدفوع/مدفوع جزئي/مدفوع, over-payment rejected.
- Item stats (last price/date, purchase count, total qty/value) computed live from price_history.

## Migrated Real Data (2026-06)
17 suppliers, 2 customers, 2 projects, 15 items, 1 purchase (PUR-000001, 29,947.50, paid), 1 payment (PAY-001), 5 price-history rows, 12 settings lists. No sample data.

## Implemented (2026-06)
- All 10 modules; Dashboard 8 KPIs + 4 charts (by supplier, by project, monthly, payment status).
- Excel export (multi-sheet Arabic workbook) + Excel import (dedup-safe) from Purchase Register page.
- Tested by testing agent: 14/14 backend tests, all frontend flows pass (iteration_1.json).

## Backlog / Next Tasks
- P1: Purchase Requests module (sheets exist in workbook but empty).
- P1: Edit existing purchase (currently create/view/delete only).
- P2: Print/PDF purchase order & payment receipt.
- P2: Supplier rating & lead-time analytics; project budget vs spend tracking.
- P2: User accounts/roles if needed later.

## Test Notes
- No auth. Backend tests: `pytest backend/tests/backend_test.py -v` (self-cleaning). Do not delete migrated records.
