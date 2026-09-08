# ProcureX V1 closure review — 2026-09-08

Release review for `fix/pre-golive-hardening`, starting at `f212ed9`.
No push or deployment was performed. This is a cleanup sprint, not a schema migration.

## A. Legacy audit

Authoritative workflow: REQ → technical review → RFQ → supplier quotations → comparison → approval → PO → payment → receiving → completed.

| Capability | Classification | Decision and evidence |
|---|---|---|
| Direct-purchase entry `/purchases` | C | Removed entry page and route. Current POs use the formal workflow. No current page links to this entry route. Retained purchase models and APIs. |
| Old purchase register `/register` | C | Removed page and route. Its only frontend route metadata was hidden navigation; import/export compatibility is retained in backend. |
| Approved-items pricing draft `/approved-items-draft` | C | Removed page, route and page test. Current quotation/comparison flow does not call this page. Retained approved-price fields and APIs pending compatibility review. |
| Incoming customer conversion | C / E for API retirement | Removed action and handler from Incoming Requests. Customer APIs still have a caller in Supplier Comparison and backend tests; no customer records deleted. |
| Incoming internal-request / purchase-draft conversion | C / E for API retirement | Removed both actions and handlers. Three persisted documents with 15 lines require preservation. Backend tests still exercise conversion and external token consumers cannot be disproved locally. |
| Historical purchase detail `/purchases/:purchaseId` | B | Kept. ProjectPurchases explicitly opens this route from its separate historical section. |
| Project purchase center | A | Kept. Incoming Requests and Projects link to it; it displays current workflow traceability. |
| Customer model/API and hidden customer register | A / E for UI retirement | Supplier Comparison loads `/customers`; hidden CRUD register retained because maintenance requirements remain uncertain. |
| Formal price history | A | Kept. Suppliers and Items link here; formal prices are sourced from POs, not the empty legacy price_history table. |
| Old price-history and payment APIs | E | Retained. Existing tests/import-export and historical compatibility remain. Current Payments reads formal POs and excludes old direct payments. |
| Legacy external approval/payment sharing | B / E for mutation retirement | ApprovalsCommandCenter contains an explicitly separate legacy panel; PublicApproval still calls token-based decision/payment APIs. Kept because these are real code callers and external tokens may remain valid. |
| Document capture/review | A | Kept. Incoming Requests links to document review; worker and public/internal routers have real callers. |
| Manual items in REQ/comparison | A | Kept. These are current procurement capabilities, distinct from the removed manual direct-purchase workflow. |
| Construction calculator | B / E for further source removal | Already not registered at runtime; historical seeded data and migration dependencies remain. Existing redirect retained. No construction data was deleted. |
| Site Portal, WhatsApp, public approval | A | Preserved with existing account boundaries and integration routes. |

No E-class capability was deleted. No backend models, tables, migrations, attachments, audit history, existing backups, `.env`, or design-reference assets were modified.

## B. Routes and code

- Removed frontend routes: `/purchases`, `/register`, `/approved-items-draft`.
- Added a catch-all redirect to the dashboard for stale bookmarks; existing authentication guard applies at the destination.
- Retained historical purchase detail and project-center deep links.
- Backend routes removed: **0**. [Runtime inventory](v1-closure-routes.json) records 150 registered method/path entries with handler modules. A separate local AST inventory records 151 decorator declarations, including unmounted code; these counts are not equivalent.
- Legacy backend mutation routes remain because zero legitimate callers/no compatibility requirement was not established. This is an explicit compatibility-review remainder, not proof that all legacy APIs are dead.
- Removed files: Purchases.jsx, Purchases.test.jsx, PurchaseRegister.jsx, ApprovedItemsDraft.jsx, ApprovedItemsDraft.test.jsx.
- Removed obsolete Incoming conversion handlers and unused icons/imports. No broad style or component-system refactor.
- Source/test diff: **1,154 lines removed**, **100 lines added**, **5 files removed** (documentation excluded).

Legacy API caller review (all preserved; no external-consumer absence is claimed):

| API group | Frontend callers after cleanup | Test/script/internal callers and compatibility |
|---|---|---|
| `/api/purchases/{purchase_id}` GET | PurchaseDetails via ProjectPurchases | backend_test.py; historical drill-down |
| `/api/purchases` GET/POST and DELETE detail | None in current frontend | backend_test.py; Excel import/export and historical purchase logic still exist |
| `/api/payments` GET/POST/DELETE | None in current Payments screen | backend_test.py; historical direct-payment ledger and import/export compatibility |
| `/api/price-history` | None in current formal history screen | backend_test.py; retained legacy data model/export |
| Incoming `convert-customer`, `convert` | Removed from IncomingPurchaseRequests | backend_test.py; internal-token compatibility; three historical internal documents |
| Incoming `approved-price`, `approved/items` | Removed ApprovedItemsDraft | No remaining local call found; persistent fields retained and external/internal-token consumers unverified (E) |
| Incoming `hold/overdue` | No current visible action identified | Preserve pending internal/external consumer review |
| `/api/customers` CRUD | SupplierPriceComparison reads; Customers maintains | backend_test.py; one real customer row |
| Public approval decision/payment/proof | PublicApproval | backend_test.py; issued-token compatibility |
| Workflow approval ready/sent/share/revision and payment verification/cash | ApprovalsCommandCenter legacy panel | backend_test.py; segregated historical workflow |
| Excel import/export | Old register removed | excel_io.py and backend tests retained; external clients unverified |

## C. Data hygiene

Preserved all three internal documents:

| Document | Source request ID | Classification |
|---|---|---|
| PDR-20260826-9E96FAB8 | 535c7e30-1f43-44e3-b2ae-63cf7c9ebf54 | Unconfirmed provenance; preserved |
| IPR-20260908-0BD69412 | 4e80e219-c76f-4bf2-b61f-462f88e12e50 | Created before sprint; not assumed to be test data |
| PDR-20260908-215B388C | d3f0a638-1d29-440a-8394-d49f0677c314 | Created before sprint; not assumed to be test data |

The dashboard previously treated two converted internal drafts as deliveries. Its operational request pipeline now excludes converted internal drafts without a non-cancelled formal PO. Its active-request and funnel totals use that same operational scope. A request with both an old draft and a formal PO remains included. The visible erroneous delivery count changed from 2 to 0, matching the formal ledger.

Historical requests remain readable in Incoming Requests. Their internal-document reference is collapsed and labelled historical. No record was deleted, no cleanup mutation was rehearsed/applied, and no data migration was necessary. A future decision about whether these records are test data requires business-owner identification.

## D. Suppliers

- Internal PK: String internal ID; relationships generally use supplier IDs.
- Root cause: preserved shorter historical codes coexist with the current six-digit generator, while register ordering was lexicographic.
- **Case B:** historical codes were not renumbered. `price_comparison_rows.supplier_code` and `price_comparison_supplier_offers.supplier_code` contain persisted codes, including SUP-002, SUP-004, SUP-006 and SUP-010. Code-based unique/grouping and fallback identity logic exists in price_comparisons.py and procurement_workflow.py.
- Current generator already reserves six-digit `SUP-000001` format, using the greater of the persistent sequence and maximum suffix + 1. No-reuse reservations are preserved.
- Next code at baseline: **SUP-000030**, not inferred from the 27-row count.
- Register now sorts recognized codes by numeric suffix, with deterministic code/ID ties, and leaves unrecognized codes after them.
- New regression verifies numeric ordering without changing IDs/codes; the existing mixed-width and concurrency allocator tests remain.
- Supplier rows, quotations, comparisons, approvals, POs, attachment records and every other business table have identical before/after hashes.

## E. UI/UX and acceptance

Changed Incoming Requests, shared master-data loading/empty/error states (Suppliers, Items, Projects and retained Customer register), and layout route labels. Supplier code order is fixed in its API response. Existing dense supplier columns, item formal-price columns, action menus, RTL and currency formatting are preserved.

Incoming Requests keeps list/detail layout and grouped corrections. RFQ is the primary sourcing action; comparison is secondary and appears only in pricing with a linked project. Removed three obsolete actions and their handlers. Historical document references no longer look like a successful current purchase action. RFQ detail now resolves its layout title.

Browser checks used the real restarted app in Chrome, signed in as an ERP admin:

- 13 operational pages checked at **1366×768, 1440×900, 1920×1080**: Dashboard, Daily Report, Incoming Requests, RFQ register, Supplier Comparison, Approval Center, POs, Payments, Suppliers, Items, Projects, Users, Settings. No document-level horizontal overflow in 39 checks; no console errors captured during these checks.
- Screenshots visually inspected: Suppliers at 1366×768, Incoming Requests at 1440×900, Items and corrected Dashboard at 1920×1080, populated comparison at 1366×768, RFQ workspace at 1440×900. The populated comparison also passed overflow checks at the larger sizes. Its bottom summary did not overlap the visible table area.
- Opened existing request RFQ and a saved comparison without submitting business mutations. This is representative acceptance, not exhaustive validation of every dialog, action, or data shape.
- RFQ workspace additionally passed document-overflow checks at all three desktop sizes; its layout heading resolves correctly. Temporary browser viewport override was reset and ProcureX was left open.
- **Manual remainder:** authenticated Site Portal mobile/tablet form, corrections, attachment and receiving interactions. ERP accounts are intentionally excluded from the Site Portal. No Site Portal visual pass is claimed.

## F. Database verification

WAL-safe SQLite backup: `logs/closure-20260908T081800Z/procurement.walsafe.db`, created with SQLite's backup API. Existing backups were untouched.

Full evidence: `before.json`, `after.json`, `data-audit.json`, `git-before.txt` in that same ignored local evidence directory. No private DB was added to Git.

- Integrity: **ok before and after**.
- Foreign-key violations: **0 before and after**.
- Every table row count and row digest unchanged.
- Logical business hash (SHA-256 of sorted per-table row digests): `bb9b9d334b3518226b97b165b213c7040a8d2a078d1bc759929af869db163c69` before and after.
- Release semantic schema hash: `a6592d200824de1ba1d348683bd1b583d356ab5ba7a3cc3d27c83c7d63019288`.
- Alembic revision unchanged: `0023_price_comparison_selection`.

| Records | Before | After |
|---|---:|---:|
| Requests / request items | 16 / 71 | 16 / 71 |
| Request status history | 56 | 56 |
| RFQs / RFQ items / suppliers | 7 / 45 / 11 | 7 / 45 / 11 |
| Quotations / quotation lines / attachments | 11 / 63 / 3 | 11 / 63 / 3 |
| Comparisons / rows / supplier offers | 6 / 63 / 9 | 6 / 63 / 9 |
| Approvals / lines | 6 / 38 | 6 / 38 |
| POs / lines | 4 / 19 | 4 / 19 |
| PO payments | 4 | 4 |
| Receipts / lines | 4 / 19 | 4 / 19 |
| Suppliers / items | 27 / 30 | 27 / 30 |
| Internal documents / lines | 3 / 15 | 3 / 15 |
| Workflow audit events | 179 | 179 |
| Projects / customers / users | 1 / 1 / 8 | 1 / 1 / 8 |
| Legacy purchases / purchase items / payments / price_history | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |

Formal price history is derived from the formal workflow; the empty legacy price_history table does not mean formal history is missing.

## G. Regression

Final results follow. Intermediate failures were fixed: two tests expected retired routes, the first pipeline implementation used an out-of-scope variable in Dashboard/Daily Report, and the pipeline/funnel totals initially used different scopes. None is an accepted release failure.

- Frontend final: **40 suites, 307 tests passed**.
- Final production frontend build: **passed**.
- Desktop self-test: **passed**; desktop pytest: **3 passed**.
- Fresh Alembic upgrade from empty DB to current head: **passed**, semantic schema hash matches release contract.
- Full/public TestClient lifespan smoke: **passed**; health 200 on both surfaces, unauthenticated ERP 401 on full and 404 on public. Public `/api/` is intentionally absent (404).
- Backend final: **346 collected, 346 passed in 461.33 seconds** (`backend-verified.log`). Collection-only process emitted a Windows temporary SQLite cleanup warning after collecting, with exit 0; the final full suite passed.
- `git diff --check`: passed.
- RBAC hierarchy and grouped-correction/deep-link tests remain in the full suites; no role checks were replaced with exact-role comparisons in this sprint.

## H. Remaining review

Historical supplier codes must remain unchanged. Review the three identified internal documents only if business owners can confirm their provenance. Retiring legacy backend mutation APIs needs an external-consumer/compatibility decision; they were not deleted on absence of visible UI alone. Complete Site Portal mobile/tablet visual acceptance with a Site Portal account before hosting.

Manual acceptance steps: at 390×844 and 768×1024, sign in with a Site Portal account; inspect request entry, item selection, grouped returned corrections and receiving views. Confirm no horizontal page overflow, obscured controls or console errors. Exercise submissions, uploads and receiving mutations on a disposable database/attachment copy. The ERP admin session used for this sprint cannot perform this isolated portal acceptance.

## I. Git

- `a1e3f5d` — refactor(legacy): retire obsolete pages and polish operational navigation.
- `5912c93` — fix(procurement): sort supplier codes and exclude legacy draft KPIs.
- This report and runtime inventory are committed separately as closure evidence.
- Explicit paths staged; no `git add .`, `git commit -a`, push or deployment.

## J. Verdict

**PROCUREX_V1_CLOSURE = PASS_WITH_MANUAL_REVIEW**

The automated release checks pass and real business data is unchanged. Complete the Site Portal visual checks and review the explicitly uncertain compatibility/data-provenance items before treating hosting acceptance as complete.
