# Redesign Progress

## Inventory redesign

### Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Discovery | Done | Read-only discovery completed from the checked-in app, migrations, baseline schema, and documentation. |
| 1 — Shared UI pieces | Done | Added reusable inventory UI primitives and pure stock/expiry display logic with unit tests; no database changes. |
| 2 — Products | Done | Server-backed product catalog with filtered export, saved views, table/card layouts, strength, Code 128 labels, imports, and RPC-only product status changes. Required migrations were run and verified by the user. |
| 3 — Categories & master data | In progress; database prerequisite | Categories card-grid work follows the Products commit. Any new overview/merge RPC migration will be shown for manual application before the UI relies on it. |
| 4 — Stock Inventory | Pending approval | Not started. |
| 5 — Reorder suggestions | Pending approval | Not started. |
| 6 — Returns & stock-take | Gated | Start only after written approval for Phases 1–5. |

### Phase 1 delivered

- Added `src/components/inventory/InventoryUi.tsx` with KPI cards, status/stock/expiry chips, filters, keyboard-operable segmented tabs, responsive selectable data tables, row actions, server-pagination controls, bulk-action bar, empty/loading states, and an accessible confirmation dialog.
- Added pure stock-bar and expiry-display logic plus boundary/error tests in `src/components/inventory/inventoryUiLogic.ts` and its test file.
- Registered the focused test suite in the existing `npm test` runner. No dependencies, database objects, or live data were changed.
- Validation: `npm run lint`, `npm test` (67 tests), and `npm run build` pass. Vite still reports its existing config-loader and large-chunk warnings.

### Phase 2 delivered

- Replaced the Products page's client-side batch aggregation with server-side product list and summary RPCs. Search, active/class/category/manufacturer filters, low-stock-only, stable sorting, and pagination are applied before rows reach the browser.
- Reused the Phase 1 responsive table, stock/expiry/status display, KPI cards, selection, bulk actions, and confirmation dialog. Added per-user saved views and remembered table/card layouts. Filtering, sorting, and pagination stay server-side.
- Added all-filtered-row CSV/XLSX export, with cost fields only when the server says the user can view cost; selected-page CSV/XLSX export is also available. XLSX and JsBarcode are dynamically imported. Code 128 labels show the product name, code, and MRP.
- Added server-checked category reassignment/deactivation for selected products and one-transaction CSV import after a row-by-row preview. The preview flags local/database duplicates and invalid values. New categories/manufacturers still use the existing category/brand RPCs and therefore require Categories permission when values are missing.
- Added a downloadable import template, row-level skip/include controls, and skipped-row export. Strength appears in the list, form, import, and exports. CONTROLLED and NARCOTIC share the Controlled filter while preserving their exact stored class in rows, form, import, and export.
- Single-product activate/deactivate now calls `products_bulk_update`; there are no browser-side `medicines` writes in the Products page. The View batches action routes to Stock Inventory with a server-side medicine-id filter.
- Added `can_view_cost()` and server-side cost/margin redaction in product responses. Cost fields are returned only for active admin/super-admin/manager/accountant profiles; client visibility follows the RPC response. Product list/stat/import/bulk RPCs all check active, non-deleted profiles and Products permission. Existing RLS policies and shared permission helpers are unchanged.
- Added pure CSV parsing/preview tests and included them in `npm test`.
- Added `supabase/migrations/20261010035000_add_medicine_strength.sql` and `supabase/migrations/20261010040000_products_redesign_rpc.sql`. The user ran and verified both migrations; the strength column and six Products RPCs exist in the live database.

## Safe demo login

### Implemented

- The login page has demo and manual tabs, five role cards, role-code pills, named demo users, loading/error states, and an alert banner shown only when demo mode is enabled.
- The demo tab appears in production only if `GET /api/auth/config` returns `{ "demoMode": true }`. In Vite development only, a missing/unavailable config endpoint enables a local preview login so the frontend demo can be explored without an API.
- Local preview login creates an in-memory mock session and opens the existing role-aware frontend pages; it does not send auth requests, create a server token, access a database, or persist data. Production demo login still requires `POST /api/auth/demo-login`.
- `.env.example` documents `DEMO_MODE=false`.
- The app's in-session demo alert is also controlled by the server-provided demo-mode flag.

### Assumptions

- Only the API may decide whether demo mode is enabled. The browser must not infer the flag from a client-side environment variable.
- The API maps `admin`, `pharmacist`, `cashier`, `inventory`, and `accountant` to fixed demo accounts and responds with the same `user` session shape used by normal login.
- “Role code” is shown separately from the fixed account username so the cards communicate both permission role and demo account identity.
- The login layout follows the supplied compact green card reference: lowercase role-code pills, one-line demo-person descriptions, a slim demo warning, and tighter vertical spacing. The customer-facing manual credentials tab remains available alongside it.
- A local Vite preview is allowed to simulate frontend-only demo sessions because this project already ships mock pharmacy data; those sessions are explicitly development-only and are not real authentication.
- The local demo role opens the existing app, starts Cashier at POS and other roles at Dashboard, keeps cashiers away from cost/profit views, and restricts Manage Users in the navigation to Admin.
- The sample sales history uses medicine products from the existing pharmacy inventory rather than the stray retail items previously present in the sample invoice.

### Blockers and checks

- The app uses Supabase Auth, Postgres, migrations, and Edge Functions, but has no custom Node/Express API or API test harness. The rate-limited demo-login endpoint and isolated demo data model are not present. Server-side authorization must use the existing Supabase objects rather than introducing another backend.
- `npm run build`, `npm run lint`, and `npm run test:fefo` pass (8 FEFO tests). Browser smoke checks logged all five roles into the app without calling the missing demo-login endpoint; Cashier opened POS, could not see product/user admin links, and saw profit redacted in Sales History. Admin sees Manage Users. The login layout was checked at 1366x768 and 1920x1080, with demo-off retaining only the manual form.
- The Vite build reports an existing `__dirname` config-loader warning; it is unrelated and unchanged.

## Billing and reference UI work

### Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| B0 | Partly | Inspected the Vite frontend; the checkout is `main`, not `redesign`, and reference screenshots are unavailable. |
| B1 | Partly | Billing-template cards are implemented; preferences are browser-local, not backed by Admin-only API settings. |
| B2 | Done (frontend) | Responsive preview modal supports 58mm, 80mm, and A4 and applies or cancels local preferences. |
| B3 | Done (frontend) | Shared renderer, POS printing, and rendering/security tests are implemented. Sales History reprints are not present; Customer Ledger payment slips use the shared print workflow. |
| B4 | Blocked | No report API or persisted report data is available. |
| B5 | Partly | Header, role-filtered sidebar and user footer were updated; collapse control and all reference details remain. |
| B6 | Partly | Existing dashboard/POS remain; a full spec audit and requested extras were not completed. |
| B7 | Partly | Web build, type-check and frontend tests pass. There is no API test suite. |

### Discovered relevant paths

- `src/components/SettingsView.tsx`
- `src/components/TemplatePreviewModal.tsx`
- `src/components/POSBillingView.tsx`
- `src/components/ReportsScreen.tsx`
- `src/components/CustomerLedgerScreen.tsx`
- `src/components/Sidebar.tsx`
- `src/components/TopNav.tsx`
- `src/index.css`
- `src/types/pharmacy.ts`
- `src/utils/fefo.ts`

### Assumptions

- The attached billing/UI specification targets a different monorepo and `redesign` branch. The available checkout is the Vite/React app on `pharmacy-memo`; no screenshots under `docs/reference/` or shared shop-settings service are present. Supabase Auth, Postgres, migrations, and the `manage-users` Edge Function are available.
- Browser-local storage is used for the billing template and paper format as a frontend-only stand-in. It is not a server-enforced/admin-only preference.
- The template picker/apply action is hidden from editing for non-Admin roles in the UI; this is not a substitute for server-side authorization.
- Receipt header values can use locally saved shop settings; those settings are per-browser and are not shared between counters.

### Completed in this frontend

- Added a shared sanitizer-backed receipt renderer for Simple, Classic, Professional, and Modern in thermal 58mm/80mm and A4 formats, and hooked it to the receipt preview and POS completed-sale print action.
- Reworked Billing Template cards and the preview modal in the existing Settings page. Selection/default format persist locally; applying preview settings saves both and Cancel discards modal changes.
- Added 13 receipt rendering/security tests (4 templates × 3 formats plus HTML escaping). Existing login/demo behavior remains unchanged.
- Refreshed the top header with online/offline status, per-user Normal/Large UI preference, and current user details; moved logout into the sidebar footer and removed third-party attribution. Cashier sidebar navigation is reduced to the supported day-to-day pages in this frontend.

### Blocked / remaining

- Shared/server-enforced billing settings, API/RPC tests, print-sales-report endpoint/data, backup, and persistent real store details remain incomplete. Print-request approval now uses Supabase RLS/RPC, but browser printing itself cannot be technically locked.
- Print Sales Report UI/data, full collapsible sidebar, dashboard/POS reference matching, comprehensive role/colour audit, Sales History reprints, and API tests remain incomplete.
- Validation: `npm run build`, `npm run lint`, `npm run test:receipt` (13 tests), and `npm run test:fefo` (8 tests) pass. Receipt preview was checked with medicine names, batch/expiry, total and no cost/profit fields. API tests cannot run in this repository.
- Branch differs from the referenced prompt: work was found on `main`; it was not moved to a new `redesign` branch.

## Later

- Shared settings across multiple counters: Pharmacy Memo settings currently use browser-local storage and are not shared between terminals.
- Return slips and Sales History reprints: the renderer supports RETURN memos and admins can reprint approved requests, but there is no end-to-end return workflow or Sales History reprint path to connect yet.
- Later server work: server-built receipt data and shared/server-enforced settings require persisted receipt and settings models; add API/RPC integration tests when a Supabase test environment is available.
- Supplier contact writes in `src/components/SuppliersView.tsx` still go directly from the browser to the `suppliers` table (insert, update, deactivate). Leave them for later; consider moving them to permission-checked RPCs.
- Phase 4 cost-privacy plan (analysis only; no policy changes made): after Stock Inventory reads batches through server functions, revoke direct `stock_batches` SELECT for `authenticated` and return only non-cost batch fields to inventory-authorized callers. Keep cost access inside permission-checked server functions and return NULL for cost fields to callers outside admin, super_admin, manager, and accountant. Review `purchase_catalog`, `purchase_history`, and `purchase_detail` together and make each mask cost, totals derived from cost, and margin for callers without `can_view_cost()`; do not change purchase write/FEFO behavior. The impact is that Purchases, POS, Purchase History, and Stock Inventory must consume the RPCs rather than reading batch cost columns directly. Present the exact policy/function migration for approval before applying it.
- ESC/POS: direct printer-driver support is not part of this frontend implementation.
- Link print requests to persisted sales once POS sales are stored in the database; current request snapshots are intentionally self-contained.
