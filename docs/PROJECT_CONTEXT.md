# Project Context

## Quick start for any AI

Read this whole file before doing anything. If the code and this file disagree, the code is right: fix this file.

## Project summary

Pharma Care is a pharmacy point-of-sale (POS), inventory, purchasing, customer/accounting, and staff-management web app. Its users include cashiers, managers, accountants, admins, and super admins. It is a Vite + React + TypeScript frontend with Tailwind CSS, Supabase Auth/Postgres/Edge Functions, and SQL migrations. Current maturity: actively developed; several core catalog and stock workflows are server-backed, while other screens still use mock, in-memory, or browser-local data. This checkout is not a complete production backend/API.

## How to run

Commands below are defined by `package.json`; run from the repository root:

```sh
npm install
npm run dev
npm run lint
npm test
npm run build
```

Vite serves on port 3000. `npm test` runs the project's registered unit tests; see the generated test-file list below for coverage.

## Folder map

- `src/App.tsx`: eager app shell, navigation state, demo/mock data and page routing; non-Dashboard screens and modal views are lazy-loaded with visible loading/error states.
- `src/components/POSBillingView.tsx`: active POS workflow, cart, and completed-sale printing. `POSScreen.tsx` is a legacy, unreferenced component.
- `src/utils/receipt.ts`, `printSnapshot.ts`, `printWorkflow.ts`: Pharmacy Memo rendering, safe print snapshots, and print-request workflow.
- `src/components/SettingsView.tsx`, `TemplatePreviewModal.tsx`: receipt template/paper settings and preview.
- `src/components/InventoryScreen.tsx`, `src/components/inventory/`: Products and Stock Inventory UI, shared inventory UI, and pure logic.
- `src/components/StockPurchaseView.tsx`, `PurchaseHistoryView.tsx`: purchasing and purchase history.
- `src/components/CustomerLedgerScreen.tsx`, `Customers`-related screens in `src/components/`: customer balances, ledger, and payment slips. Some data remains demo/in-memory; inspect the current page before assuming persistence.
- `src/components/ManageUsersView.tsx`, `src/permissions.tsx`, `src/utils/auth.ts`: staff, roles, UI permission checks, and profile/auth helpers.
- Other feature screens in `src/components/` include Dashboard, Reports, Suppliers, Cash Book, Controlled Drugs, Master Data, and print-request administration.
- `src/utils/`, `src/types/`, `src/data/`: reusable logic, TypeScript domain shapes, and mock pharmacy data.
- `supabase/migrations/`, `supabase/functions/`, `supabase/baseline/`: database migrations, Edge Functions, and a supplied schema snapshot.
- `docs/`: database references, `MASTER_PLAN.md`, `MULTI_SHOP_FULL_PLAN.md`, execution progress, redesign notes, and this context.
- `scripts/`, `.githooks/`: context generation and commit-hook tooling.
- `public/`: static assets and fonts.

## Data and storage

- Supabase Auth/Postgres: shared across clients connected to the same configured project. Products, Stock Inventory, and purchase workflows use server RPCs; Suppliers still has direct table reads/writes. Authorization and persistence are not uniform across every screen.
- Supabase Edge Functions: the `manage-users` function exists; print approval, requester-name listing, audited receipt-only modification, and profile Trash Bin events use database RPCs/Edge Functions.
- Supabase CLI is available as a local development dependency (`npx supabase`); hosted deployment still requires an authenticated CLI session and the correct project ref.
- Browser `localStorage`: per-browser/device preferences, saved inventory views, purchase drafts, receipt settings, per-user stock-alert keys seen, and other UI settings. These do not synchronize across counters.
- S1 owner-run SQL recovery package is prepared under `supabase/fresh/`: it snapshots `public` table data, selected catalog metadata, and sequence state into an isolated forced-RLS schema. It has not been run; catalog metadata is not a complete schema restore. It is not a full database backup and does not include Auth users, Storage objects, or platform configuration.
- Personal theme, text size, animation, and similar-medicine display preferences are available from the Settings page to every signed-in role and are stored per user in this browser. They are presented as compact segmented controls and toggle rows. Shop identity, billing, and business settings remain hidden from non-admin roles.
- Mixed persistence: the active POS catalog and sales use `pos_catalog()` and `post_sale()` RPCs; customer/ledger and sales-history paths also use RPCs. Dashboard stock/expiry KPIs still use `INITIAL_PRODUCTS` sample data, and Cash Book transactions/expenses remain React in-memory state. `POSScreen` and controlled-drug sample types are legacy/unreferenced paths; confirm each active page before relying on its data source.
- Other storage: unknown; no general file/object-storage workflow is established by the checked-in frontend docs.
- Shared production data behavior depends on Supabase deployment and the live schema, which may differ from checked-in migrations.

## Roles and permissions

Role names in `src/types/pharmacy.ts`: `admin`, `super_admin`, `manager`, `cashier`, `accountant`.

Permission keys in `src/permissions.tsx`: `pos`, `products`, `categories`, `suppliers`, `customers`, `sales_history`, `purchase_history`, `purchases`, `expenses`, `stock_inventory`, `reports`, `manage_users`, plus POS print toggles `pos_print_sale` and `pos_print_payment`.

UI defaults: Admin and Super Admin get every module. Manager gets POS, Products, Categories, Suppliers, Customers, Sales History, Purchase History, Purchases, Stock Inventory, and Reports. Cashier gets POS and Customers. Accountant gets Customers, Suppliers, Sales History, Purchase History, Expenses, and Reports. Non-admin permissions can be configured; admin roles use their full defaults. Dashboard/help, personal print requests, and the Settings route are available to all; non-admin Settings contains personal display/accessibility preferences only. Shop/business Settings, Trash Bin, and print-request administration remain Admin/Super Admin-only. UI checks do not replace database/server authorization.

Cost visibility decision: Admin and Super Admin may view cost; Manager may view it only with at least one of `products`, `stock_inventory`, `purchases`, or `purchase_history`; Accountant may view it read-only through `purchase_history` or `reports`; Cashier never may. There is no Pharmacist role in the current app. The server rule exists in migrations; its effective production definition and table grants still require live verification.

Confirmed multi-tenant target: Super Admin is platform-only (`shop_id = NULL`), manages shops/Admin accounts/page grants, and has no shop-business access or catalog-seeding exception. The initially empty Developer Shop uses a separate Admin login; retained non-Super-Admin accounts/data map to Shop 1. A shop may have multiple Admins. Super Admin grants each Admin's pages; Shop Admins may manage only Manager/Cashier staff in their shop and may grant only permissions they hold. Staff cannot manage accounts; only Super Admin manages Admins, shop assignment, and account status. Preserve creator-scoped Team view behavior. Only Super Admin may see shop IDs or read/edit private Admin notes through protected server paths. These rules are approved but not implemented; schema, RLS, RPCs, Edge Function, and UI await S1 owner results and later smoke tests.

## Business rules

- Persisted money columns and calculation fields use integer paisa; `sale_items.discount_percent` is numeric.
- Batch sale allocation in `src/utils/fefo.ts` uses FEFO: positive eligible stock only, `ACTIVE`/`NEAR_EXPIRY`, expiry today or later, then received date and ID for tie-breaking. It rejects an insufficient allocation rather than returning a partial sale. Server-side enforcement depends on the deployed RPC/schema and must be verified there.
- Expiry is a stock-batch field, not a medicine/product-master field. Product setup does not require expiry, but every purchase batch currently requires a future expiry date; no-expiry batches are not supported by the schema or sale/alert rules.
- Do not permit negative stock. Verify the server transaction and constraints as well as frontend allocation before relying on this in production.
- Stock alerts use sellable stock from positive, unexpired (`expiry_date >= current_date`), `ACTIVE`/`NEAR_EXPIRY` batches for active medicines. Alert low/out counts require `min_stock_alert > 0`; the alert RPC returns no cost, MRP, supplier, or cost-derived value and is available to every active, non-deleted profile regardless of module permission. The existing Products `out_of_stock` KPI does not apply the positive-reorder-threshold condition, so its count may exceed alert out counts. Owner-supplied live results show `stock_alerts_summary` exists with anon EXECUTE false/authenticated true; no migration-history result or end-to-end behavior was supplied.
- Cost and profit/margin are internal data, not Pharmacy Memo print fields. Receipt rendering displays sale amounts/totals and is styled black on white. Do not add cost, purchase price, profit, or margin to customer-facing slips.
- Cost-bearing base tables stay inaccessible to `anon` and `authenticated`; read cost only through permission-checked RPCs. Do not grant direct `SELECT` on `stock_batches`, because its RLS read policy includes `pos` and exposes all selectable columns to Cashier.
- Pharmacy Memo supports 58mm and 80mm thermal layouts (and A4); black text on white background. Return/payment memo rendering exists. A source-level sale-return request/review workflow is wired in POS; live end-to-end behavior remains unverified.
- Implemented return policy in source and migration: only sealed, intact, same-sale-batch units meeting configured shelf-life/window/class/storage rules may be restocked; a Manager/Admin must approve, with `sales_history` and `stock_inventory` required for restock. Cashiers with POS may request returns but cannot approve. `QUARANTINE` and `WRITE_OFF` do not increase sellable stock. Refunds use original line totals in integer paisa; credit-sale returns update customer credit/ledger. Cumulative returns cannot exceed sold quantity, while multiple partial-return transactions are allowed. Owner reports the migration applied; runtime and accounting reconciliation remain unverified.
- Invoice, memo, and purchase numbers are planned to be sequential and unique per shop. Gap-free numbering is not promised unless concurrency, rollback, retry, and failure tests prove it. Current checkout does not establish persisted server-side invoice/memo allocators; enforcement remains unknown.

## Conventions and decisions

- Keep business logic in reusable pure helpers when practical, with tests alongside the helper.
- Use server RPCs for workflows needing atomic multi-table writes or server-side filtering/authorization; use Supabase directly only where the current code does so intentionally.
- Keep client-facing cost fields nullable/redacted by the server when visibility is denied; never turn unknown cost into zero in UI.
- Date: 2026-10-10 — Inventory lists, statistics, movements, adjustments, and write-offs use stock RPCs to keep paging/filtering and mutations server-side.
- Date: 2026-10-10 — Product data uses server-side list/stat/import RPCs; cost visibility is decided server-side rather than trusted to client hiding.
- Date: 2026-10-13 — Stock alerts are server-counted, visible to every active signed-in profile, and never include cost-bearing fields. Navigation is permission-gated in the header; seen alert keys are per-user and browser-local. Owner reports the `stock_alerts_summary(integer)` RPC metadata is verified: `SECURITY DEFINER`, `search_path=public`, anon execute false, authenticated execute true.
- Date: 2026-10-13 — Owner reports the corrected `20261013160000_persist_sales_and_returns.sql` migration applied. Owner-shared metadata query verified `SECURITY DEFINER`, `search_path=public`, `anon EXECUTE=false`, and `authenticated EXECUTE=true` for its 13 RPCs and `pos_catalog()`. End-to-end behavior remains unverified. Return totals are capped cumulatively at the sold quantity; multiple partial-return transactions remain possible.
- Date: 2026-10-29 — Part B pack-pricing files are draft-only. Do not enforce global unit-barcode uniqueness until live shop scoping is verified; rollback must not automatically delete migration-created fallback units. Do not begin Part A before the owner confirms Part B is tested.
- Date: 2026-10-12 — Cost access is role-and-permission scoped by `can_view_cost()`; Cashier is always denied, Accountants are read-only, and Manager access requires a relevant module permission. Verify the deployed function and table grants in Supabase.
- Date: 2026-10-09 — Pharmacy Memo uses a shared sanitized renderer for 58mm/80mm and A4; template and paper preferences remain browser-local because shared settings storage is not implemented.

## Current status

- **2026-11-07 — Owner waived staging:** S1 current-only metadata queries, isolated SQL snapshot, guarded data restore, rollback, and smoke-test files are prepared under `supabase/fresh/`. Static review adjusted partition copying; the catalog archive is selected metadata, not a full catalog/schema restore. SQL remains untested and unrun; wait for owner results before S2. No live database was accessed.
- **2026-11-07 — S1 owner guidance provided:** Supplied the exact read-only Q1 query and step-by-step SQL Editor instructions; waiting for its two access booleans before advising further. No database or deployment actions were taken.
- **2026-11-07 — Reviewed owner attachment:** The submitted SQL output is labeled `type_and_aggregate_inventory` (Q11), not the Q1 role check; awaiting the actual Q1 booleans. No database access was performed.
- **2026-11-07 — Git guidance:** Clarified Git install versus GitHub account/authentication, the local commit author identity, and the HTTPS push sign-in flow. The LF/CRLF warning on Windows is harmless.
- **2026-11-07 — Publish status:** `main` was pushed to `origin/main`; see the 2026-11-07 publication changelog below.
- **2026-11-07 — Vercel routing fix:** Added a root SPA rewrite in `vercel.json` after the Ready Vercel deployment returned 404 for direct `/customer-display?channel=...` navigation. Requires a new Vercel deployment and direct-route verification; no custom domain is needed to use the provided `vercel.app` URL.
- **2026-11-07 — Multi-tenant plan reviewed:** Read the local-only `.private/multi-tenant-plan.md` against the user's confirmed rules. The target model is documented under Roles and permissions below; no tenant schema, RLS, RPC, or UI implementation was made.
- **2026-11-03 — Prepared Track A hardening package:** Added `supabase/fresh/trackA/001_revoke_anon_public_execute.sql`, the companion rollback/test files, the optional `002_default_privileges.sql` pair, `SMOKE_TEST.md`, and `README_trackA.md`. No SQL was run or deployed; the branch remains `feature/team-view-manage-users`.
- **Added; migration owner-reported applied and RPC ACL checked:** Header Stock Alert Bell, accessible alert panel, per-user unseen indicators, permission-aware Products/Stock Inventory navigation, and stock-change refresh events. `stock_alerts_summary(integer)` and its rollback are in `supabase/migrations/20261013140000_stock_alerts_summary.sql` and `supabase/rollback/rollback_20261013140000_stock_alerts_summary.sql`; alert counts/data and UI behavior still need runtime testing.
- **Verified in history:** The low-stock alert feature is committed as `da7ed5d` on `feature/low-stock-alerts`; it is present in that commit, not missing from the repository history.
- **Fixed in `b62b547`:** Product-controlled label text is HTML-escaped in generated print markup using the shared receipt helper; hostile markup and quoted attribute payloads are covered by tests. The existing receipt/memo rendering behavior is unchanged.
- **Done:** Phase 1 barcode validation and server-side generation work for `medicines.barcode`: reusable EAN-13 validation helpers, barcode renderer error handling, and product-page bulk generation actions. The corresponding migration files are staged under `supabase/migrations/20261012180000_assign_medicine_barcodes.sql` and the companion unique-index migration.
- **Done:** Product barcode labels now open a dedicated print dialog with size/copies/field controls and a live preview; the old raw popup path was replaced by the reusable label dialog while preserving the product-page barcode generation flow.
- **Done:** Products and Master Data redesigns; Stock Inventory UI and server-function consumers; shared receipt renderer, POS printing, and print-request approval workflow. The owner reported Phase 4a migrations were run and verified. `docs/REDESIGN_PROGRESS.md` still labels Phase 4 pending; the newer source and owner report supersede that stale status.
- **Added:** Barcode/labeling agent prompt at `docs/barcode-labels-agent-prompt.md` for follow-up product barcode generation, assignment, and print workflow work. UI and server-function consumers; shared receipt renderer, POS printing, and print-request approval workflow. The owner reported Phase 4a migrations were run and verified. `docs/REDESIGN_PROGRESS.md` still labels Phase 4 pending; the newer source and owner report supersede that stale status.
- **In progress:** Purchases and Purchase History use RPCs. The owner reports that 4c's direct-table revokes are applied and verified in the test-data Supabase project. Verify the deployed `can_view_cost()` definition and table grants before release.
- **In progress:** Products compact filter toolbar: debounced search, wrapping filter pills, removable active-filter chips, and a tested clear-all/reset helper. No RPC or database behavior changed.
- **Done:** Manage Users list handling now falls back safely when response fields are absent and reports a likely stale `manage-users` deployment instead of crashing.
- **Owner-reported applied; source verified:** POS checkout posts sales through `post_sale`, supports server-recorded cash/online/credit/split payments, and updates customer credit state. Owner reports `20261013160000_persist_sales_and_returns.sql` applied successfully after fixing two SQL syntax errors, and shared query results verify selected RPC ACL/security metadata. Runtime sale/return behavior has not yet been verified.
- **Done in source; migration pending:** Sidebar favorites use a central page registry, role-visible Favorites group, keyboard/touch context menu, oldest-first selection order, an eight-page limit, and per-auth-user Supabase preferences. The Favorites heading appears only when the user has at least one visible favorite. The Dashboard Cash Sales/Credit and Daily Sales Target rows and target modal were removed. The owner confirmed the current database has no shop isolation/helper; `user_favorites` therefore has user-only RLS (no `shop_id`). Apply `20261018230000_sidebar_pins.sql` before enabling persistence.
- **Deployment secret check (2026-10-20):** Current GitHub `main` matches local HEAD; no `.env` or `.env.local` is present in that tree. Local `.env.local` is ignored and untracked; `.env.example` is tracked and contains placeholders. A scan of 20 Markdown files found no credential patterns. This covers the current tree, not all Git history. Do not expose `SUPABASE_SERVICE_ROLE_KEY` in client-side Vite variables.
- **SQL Editor corrections:** Fixed the apostrophe in the payment exception text (`customer''s`) and the missing empty-array fallback closing expression in `pending_sale_returns()`.
- **Done (UI & POS Fixes):** Barcode scanner integrated into search; cart void removed; robust catalog fallback for unconfigured units; customer grid dashed button removed; compact categories/master data table; on-demand expiry timeline in Stock Inventory; compact POS-style cards in Stock Purchase; Sales History redesigned into "Grouped by day" layout with 6-item KPI strip and toolbar print modal; Business Analytics redesigned into "Polished classic grid" with full-width trend chart and 3-card bottom row.
- **Done in source (migration pending deployment):** Cashier print requests submit without a confirmation prompt; admin review displays requester names and can modify pending sale receipt snapshots with audited server-side validation. Changes are receipt-only and do not change completed sale records.
- **Done in source (migration/Edge Function deployment pending):** Admin Trash Bin lists user deletions/restorations, product/supplier deactivations/restorations, and purchase voids with actor names, time, reason, entity filters, and only safe restore actions.
- **Implemented locally:** Barcode validation, medicine-level EAN-13 generation and bulk assignment RPC files, and barcode printing are present. Client package commit `818af6c` adds Edit/Print/Make actions on product rows, cards, and a product-details dialog; per-product label quantities (1–200) with a 1,000-label job cap; a scanner test dialog; and fast keyboard-scanner handling in Products search and POS. Label printing requires an assigned barcode; it no longer falls back to the product code. Missing barcode-generation RPCs show an explicit notice. This package changed no SQL/schema and applied no migration. Real scanner/printer hardware remains untested.
- **W6 TypeScript baseline:** `strict` and `noUnusedParameters` are enabled after both command-line measurements returned zero diagnostics. `noUnusedLocals` remains disabled because its 16 remaining diagnostics are in preserved components and the retained `RepositoryReviewView` import. The broader source cleanup is committed as `cce45bb`; ESLint packages/config remain pending owner approval and TypeScript 7 compatibility review. Details and release-date evidence are in `docs/EXECUTION_PROGRESS.md`.
- **W7 client bundle optimization:** Sidebar screens and modal views load on demand (Dashboard, login, and shell remain eager); Purchase History XLSX, receipt print workflow, and barcode label code are deferred until used. Loading and retryable screen-error states are present. First-load production gzip measured 172.26 kB, down from 418.24 kB and below the 200 kB target. Lint, tests, and build pass; see `docs/EXECUTION_PROGRESS.md` for emitted chunk sizes. Physical slow/offline-network and route-refresh checks remain manual.
- **Security ACL plan:** Owner-reported live ACL audit found `stock_batches` and the other four 4c cost-bearing tables revoked; a later `stock_batches` grant had undone its revoke once. Reassert revokes in the new lockdown migration. Staged files A-D and rollback scripts are proposals only and have not been applied. The owner reports profile DML already revoked; file D reasserts that state.
- **Next:** `docs/MASTER_PLAN.md` records owner decisions. The active checkout is `feature/team-view-manage-users`; owner-run S1 inventory and snapshot results are the gate before S2. Package 3's client-only barcode UI is complete; track further package state in `docs/EXECUTION_PROGRESS.md`. Hardware scanning/printing remains unverified.

## Known issues and Later

- Owner-approved multi-shop decisions and the detailed plan are in `docs/MULTI_SHOP_FULL_PLAN.md` and `docs/MASTER_PLAN.md`. No tenancy implementation or database changes have been made. Private notes require reviewed server/database support, not browser-local storage. S1 results are required before S2; each later owner-run stage has a stop gate.
- Current code conflicts with the target: Admin/Super Admin defaults grant every module, Admin can grant all permission keys, and staff with `manage_users` may manage lower-role accounts. Shop-profile fields remain browser-local; no shop schema exists. Explicit page grants, role boundaries, and server-backed shop identity are still plan-only. Implement after S1 review and ACL reconciliation.
- DBCode VS Code extension reported a SQL language-server startup timeout followed by closed connections in editor logs on 2026-10-13; the exact cause is unknown and no database operation or project runtime failure is indicated by those log lines.
- Live Supabase schema/RPC availability may lag behind checked-in migrations; verify migration state before diagnosing app behavior.
- Sidebar favorites and their one-time tip dismissal are persisted per `auth.uid()` with user-only RLS because the current database has no shop-isolation helper; multi-shop favorite isolation is not provided until the database adds a supported tenant model.
- POS catalog fallback can display demo medicines (`DEMO-MED-*`) when demo data is locally active or the live catalog is empty; checkout still submits those IDs to `post_sale()`, whose medicine/unit IDs must be UUIDs. A sale containing a demo item therefore fails with PostgreSQL `invalid input syntax for type uuid`; use actual database-backed catalog entries and investigate why the live catalog is empty before retrying.
- Part B SQL remains unexecuted and incomplete. Existing `pos_catalog()` still returns inactive/unpriced units using legacy `price_paisa`; database triggers may reject checkout after such a unit is shown. Zero versus unpriced semantics, fallback pricing from batch MRP, strict default-unit behavior, live RPC compatibility, and ACL restoration on rollback need owner review. See `supabase/fresh/features/README_pack_size_pricing.md`.
- Production browser code is delivered as hashed JavaScript and remains inspectable by design; source maps are absent from current production assets. The named `version` import removed local test-file path strings, but cannot hide shipped app code. The frontend reads only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the owner-reported Vercel names do not include these, and `NEXT_PUBLIC_*` names are not read by this Vite app. Verify the Production build environment before redeploying. Historical-only `supabase/.temp/pooler-url` has no embedded password; no credential-shaped values were found by the limited repository/history scan. The earlier source-sighting URL remains unverified.
- Readiness: owner-supplied live read-only audit (2026-10-21, intended development/test project) found 26 public tables, all with RLS enabled/not forced and no shop-like columns; no views, Storage buckets/policies, Realtime publication tables, or migration ledger. Exact baseline counts: audit_logs 4517; brands 1; categories 1; customers 0; khata_entries 0; medicine_units 1; medicines 13; print_requests 4; profiles 4; purchase_items 0; purchase_number_state 1; purchases 0; return_policy_settings 1; sale_item_batch_allocations 0; sale_items 0; sale_payments 0; sale_return_items 0; sale_returns 0; stock_batches 0; stock_movements 12; supplier_ledger 0; suppliers 0; trash_bin_events 28; user_favorites 0; user_sidebar_preferences 2. Profiles contain two active Admins, one Cashier, and one Super Admin; owner confirms both Admins join Default Shop. Catalog lists 57 functions, 55 SECURITY DEFINER, 16 anon-executable and 11 PUBLIC-executable. Read-only body review found guards before business reads/writes in the 16 exposed functions; no runtime anon RPC call was run. No SQL or migration was prepared or applied. DBCode access is not yet confirmed in this workspace; owner is at the existing project's Supabase Connect panel. Supabase's direct connection screen warns it uses IPv6; use Session pooler if the network is IPv4-only. Never use the frontend anon key as a PostgreSQL connection credential. A DBCode setup screenshot exposed a database credential; rotate it before connecting, and do not retain or repeat it.
- A previous sign-in error was reported, but current authentication/runtime status was not tested in this audit. POS source requires active medicine, configured units, and positive eligible stock; the stock alert function requires `min_stock_alert > 0` for both low and out alerts.
- The print-request requester-name and modify RPCs in `20261012160000_modify_print_requests.sql` are local until that migration is applied to the target Supabase project.
- The Manage Users UI requires `api_version: 2`; owner-run CLI output confirms the matching `manage-users` function was deployed to project `itdetfyxrwixhxsfydfz` on 2026-11-04. Refresh and verify in the app; do not redeploy unless the warning remains. If a PowerShell/VS Code terminal cannot resolve Node, restart VS Code to inherit the persisted user PATH or append `C:\Program Files\nodejs` to that terminal's `$env:Path`. Trash Bin event schema/triggers/listing/restore RPCs in `20261012170000_trash_bin_history.sql` remain local until their separate migration/function deployment.
- Barcode workflow is partial: assignment targets `medicines.barcode`; the checked-in unique index is global and does not cover `medicine_units.barcode` or future shops. Client actions, per-product label quantities, scanner test, and POS/Products keyboard scanning are implemented, but live RPC availability, unit-barcode scanning, cross-shop uniqueness, and physical scanner/printer output are unverified. Product label printing supports linear formats only; QR-code generation is not implemented. Owner reported manually running the legacy barcode SQL, but no live schema query was performed in this checkout.
- Supabase bootstrap hazard: `supabase/baseline/00_baseline_schema.sql` is a reconstructed schema reference, not a complete dump. The migration directory also contains timestamped barcode rollback files; do not apply them as forward migrations. Bootstrap instructions and metadata-only comparison queries are in `docs/STAGING_BOOTSTRAP.md`.
- Approved business rule: positive stock in `ACTIVE`/`NEAR_EXPIRY` batches for an active medicine remains sellable through expiry (`expiry_date >= current_date`). `src/utils/fefo.ts` uses this boundary; verify the deployed RPC uses the same rule.
- Trash Bin tracks app product/supplier deactivation and purchase-void workflows; out-of-band physical deletions made through another client or dashboard are not captured.
- Print requests are stored in `public.print_requests`; the admin UI has no permanent-delete action. Removing a request row does not remove its related audit-log history.
- Shared settings across counters are not implemented; receipt templates and some preferences are browser-local.
- Sale-return request/review is implemented in source and the owner reports its SQL migration applied, but end-to-end sale/return behavior is not yet verified against the database. Sales History reprint is not implemented; return memo rendering and print-request review are separate.
- Direct ESC/POS printer-driver support is not implemented; browser printing uses the browser print dialog.
- Several screens still use mock/in-memory data; identify persistence from the current component before changing it.
- Supplier contact insert/update/deactivation is still performed directly by the browser; consider a permission-checked RPC plan.
- Backend role/permission enforcement, API/RPC integration testing, backup, persistent store details, and printer controls need validation/completion.
- POS product browsing uses the permission-checked `pos_catalog()` RPC and its response excludes cost data. Sale posting uses `post_sale()` and sales/customer summaries use RPCs. Dashboard stock KPIs still use sample `INITIAL_PRODUCTS`; Cash Book transactions/expenses remain in memory; sales reports do not yet reconcile persisted return records. The active POS/server sale path does not capture or enforce prescription proof for `requires_prescription` medicines; see `docs/audit/LOGIC_AUDIT.md`.
- Future public tables must explicitly grant only required privileges to `authenticated` and enable appropriate RLS. The 2026-10-21 live catalog found 16 anon-executable and 11 PUBLIC-executable functions; tenancy work must revoke those grants, retain required authenticated EXECUTE, and set safe default function privileges. No pre-login function requirement was identified in the frontend scan; runtime verification remains pending.
- Sale and purchase identifiers are generated in source and constrained by the current single-shop schema; verify uniqueness and retry/concurrency behavior against the deployed database. Per-shop numbering awaits tenant scoping; gap-free guarantees are deferred unless concurrency, rollback, retry, and failure tests prove them.
- Discount rules to enforce inside the future post_sale RPC: per-role maximum percent, discount never above the bill, never below batch cost (cashier only sees a generic 'Discount not allowed'), discount stored in paisa with the sale, audit_logs entry for discounts above a threshold.
- Enforce the Rs 200 maximum discount and the role percent caps inside the future post_sale RPC; make the Rs 200 limit editable in Settings.

## Assumptions

- Split payments are represented by separate payment rows in `post_sale()` source; live tender settlement/reconciliation still needs owner-run verification.
- Admin modifications to pending print requests change the receipt snapshot for printing only; they do not rewrite the completed sale, inventory, or accounting records.
- Trash Bin records user soft-deletes/restores, product/supplier active-state changes, and purchase voids. Purchase records are not physically deleted or directly restorable.

## Changelog

- 2026-11-07 — Prepared owner-run S1 current-only inventory, `backup_20261107` data/selected-definition/ACL/sequence snapshot, guarded data restore, snapshot cleanup, and row-count smoke test. Added the owner's no-staging rollout and Developer Shop/account-boundary decisions to the multi-shop plans. Static review only; no database or deployment actions.
- 2026-11-07 — Fast-forwarded `feature/team-view-manage-users` into `main` and pushed to GitHub (`origin/main` at `10c5441`). This includes the branch's customer-display/manage-users changes, S1/Track A preparation, and docs; test suite and production build had passed before publishing.
- 2026-11-07 — Investigated screenshot of Vercel 404 for `/customer-display`; confirmed the client route exists in source and local `main` is pushed, but Vercel build/alias status remains unverified. Likely deployment freshness or SPA rewrite; owner should check Vercel deployment status.
- 2026-11-07 — Added root `vercel.json` rewrite to `/index.html` to let Vercel serve the Vite SPA for direct client-route requests, including `/customer-display`. Vite production build and JSON config validation pass; deployment and live route remain to verify.
- 2026-11-07 — Reviewed `.private/multi-tenant-plan.md` against the user's confirmed tenant rules and recorded the target model and implementation status in Roles and permissions. No application, database, or plan-file changes.
- 2026-11-06 — Created and retained `docs/DESIGN_REFERENCE.md`, a plain-English visual reference covering the shared themes, workspace shell, responsive patterns, and screen-specific visual layouts. Exclusion scan found no URLs, credential terms, environment names/values, or personal paths/names. No commit or push.
- 2026-11-06 — Removed the cashier manual Show/Hide options panel; alternatives now appear only through the customer Settings preference. Moved theme/text-size/motion and similar-medicine controls to the all-role Settings route as compact segmented controls/toggle rows; shop/business settings remain admin-only. Removed those controls and the auth-status badge from global headers. Added customer display Qty/Batch/Expiry/Amount columns, using only sale FEFO allocations and allowlisted fields. Updated all-role Settings tests. Full tests, TypeScript and build pass. No SQL, deployment, merge or push.
- 2026-11-05 — Confirmed task checkout root `D:/PHARMA CARE WEBSITE` and branch `feature/team-view-manage-users`; prior `E:\PHARMCYYYY1` checkout is absent on this machine. No work was performed outside the available checkout.
- 2026-11-05 — Extended the same-computer customer display locally with payment summary, welcome/thank-you states, safe same-generic/strength in-stock alternatives, cashier line swap/hide controls, and an exact channel payload allowlist. Focused tests (7), full suite (134), TypeScript check, and production build passed. Dosage form is absent from the current POS catalog and therefore not matched. No role, SQL, database, deployment, merge, or push changes.
- 2026-11-04 — Owner deployed `manage-users` to the configured production Supabase project (`itdetfyxrwixhxsfydfz`). CLI output confirmed successful upload of the function entrypoint and policy module; Docker warning was non-blocking. Waiting for UI refresh/runtime verification.
- 2026-11-03 — Diagnosed the Manage Users API-version warning, added Supabase CLI, and documented PATH limitations; direct executable paths worked. No database or deployment action was taken.
- 2026-11-03 — Prepared the Track A SQL hardening package under `supabase/fresh/trackA/` with the 001 lock-down, rollback, test, optional 002 default-privilege files, smoke checklist, and run order README. No SQL was run or deployed; branch remains `feature/team-view-manage-users`.
- 2026-10-29/11-01 — Audited supplied PDFs and drafted Part B SQL Editor preflight/README; completed Task 1 Admin team/access controls and the approved same-device customer display. Tests/build pass; Team policy 18/18; authenticated UI and live display sync unverified. PDF 4 has no production source maps; approved named-version cleanup removes local test-file paths. Production Vercel variables were saved by owner; Preview variables skipped due no test Supabase project. PDF 2 Track A A0 read-only queries provided; awaiting owner results before creating any SQL files. No SQL run, merge, push, or deployment. PDF 1 Part A's four requested additions remain unbuilt; Track B remains off.
- 2026-10-21/23 — Recorded owner-supplied read-only DB inventory and DBCode connection guidance; no SQL migration or DBCode query was run. Exact earlier counts and setup details are historical and must not be treated as current.
- 2026-10-10/19 — Earlier work covered POS/barcode features, alerts/returns, Admin team controls, UI redesigns, performance, ACL proposals, and project-context tooling. Tests and live/deployment status are documented in the relevant plans and current source; historical staging gates have been superseded by S1-S6.

History: Earlier work delivered Products and Master Data redesigns, Pharmacy Memo rendering and print approvals, role/permission UI, and Stock Inventory. See `docs/REDESIGN_PROGRESS.md` and recent Git history for details; that progress document contains some status entries older than the current source.

## Legacy barcode migrations

Do **not** apply `20261012180000_assign_medicine_barcodes.sql` or `20261012181000_medicines_barcode_unique_index.sql` to the current project. They are legacy, pre-multi-shop migrations and are not part of the owner-approved S1-S6 rollout.

The future per-shop barcode cutover must backfill one registry across both `medicines.barcode` and `medicine_units.barcode`, enforce unique `(shop_id, normalized_barcode)`, and replace the global medicine-only index. As part of that cutover, explicitly drop `public.medicines_barcode_unique` with `DROP INDEX IF EXISTS`; replace the old assignment functions and global sequence with shop-scoped registry claims/counters. Do not run the timestamped barcode rollback files as forward migrations. A rollback must not blindly recreate the global index if different shops now share a manufacturer barcode.

## Working agreements with the owner

- Keep messages short.
- Large multi-file changes need a plan and the owner's OK first.
- Updating this file never needs permission.
- Keep factual claims grounded in current code/docs; write **unknown** where verification is missing.

<!-- AUTO:START -->
Generated at (UTC): 2026-11-07T12:54:15.685Z
Git branch: main

Last 5 commit subjects:
- Fix Vercel single-page app deep links
- Document Vercel customer display 404 investigation
- Record main branch publication
- Update published branch status
- Document GitHub push authentication status

npm scripts:
- - `dev`: `vite --port=3000 --host=0.0.0.0`
- - `build`: `vite build`
- - `preview`: `vite preview`
- - `clean`: `rm -rf dist server.js`
- - `prepare`: `node scripts/setup-hooks.mjs`
- - `context:update`: `node scripts/update-context.mjs`
- - `lint`: `tsc --noEmit`
- - `test:fefo`: `tsx --test src/utils/fefo.test.ts`
- - `test:receipt`: `tsx --test src/utils/receipt.test.ts`
- - `test:inventory-ui`: `tsx --test src/components/inventory/inventoryUiLogic.test.ts`
- - `test:stock-inventory`: `tsx --test src/components/inventory/stockInventoryLogic.test.ts`
- - `test:inventory-products`: `tsx --test src/components/inventory/productImportLogic.test.ts`
- - `test:stock-alerts`: `tsx --test src/data/stockAlertLogic.test.ts`
- - `test:pos-catalog`: `tsx --test src/data/posCatalogLogic.test.ts`
- - `test:product-filters`: `tsx --test src/components/inventory/productFilterLogic.test.ts`
- - `test:master-data`: `tsx --test src/components/masterDataSimilarity.test.ts`
- - `test:print-snapshot`: `tsx --test src/utils/printSnapshot.test.ts`
- - `test:print-request-editor`: `tsx --test src/utils/printRequestEditor.test.ts`
- - `test:trash-bin`: `tsx --test src/utils/trashBin.test.ts`
- - `test:report`: `tsx --test src/utils/salesReport.test.ts`
- - `test:discount`: `tsx --test src/utils/discount.test.ts`
- - `test:barcode-scanner`: `tsx --test src/utils/useBarcodeScanner.test.ts`
- - `test:labels`: `tsx --test src/utils/labelUtils.test.ts`
- - `test:permissions`: `tsx --test src/permissions.test.ts`
- - `test:sidebar`: `tsx --test src/components/sidebarPinLogic.test.ts`
- - `test:manage-users-policy`: `tsx --test supabase/functions/manage-users/policy.test.ts`
- - `test:customer-display`: `tsx --test src/utils/customerDisplay.test.ts`
- - `test`: `npm run test:fefo && npm run test:receipt && npm run test:inventory-ui && npm run test:stock-inventory && npm run test:inventory-products && npm run test:stock-alerts && npm run test:pos-catalog && npm run test:product-filters && npm run test:master-data && npm run test:print-snapshot && npm run test:print-request-editor && npm run test:trash-bin && npm run test:report && npm run test:discount && npm run test:barcode-scanner && npm run test:labels && npm run test:permissions && npm run test:sidebar && npm run test:manage-users-policy && npm run test:customer-display`

Dependencies and versions:
- - `@e965/xlsx` ^0.20.3 (dependency)
- - `@google/genai` ^2.4.0 (dependency)
- - `@supabase/supabase-js` ^2.117.3 (dependency)
- - `@tailwindcss/vite` ^4.3.3 (dependency)
- - `@types/express` ^4.17.21 (devDependency)
- - `@types/node` ^22.14.0 (devDependency)
- - `@types/react-dom` ^19.3.0 (devDependency)
- - `@types/react` ^19.3.0 (devDependency)
- - `@vitejs/plugin-react` ^6.1.1 (dependency)
- - `autoprefixer` ^10.4.21 (devDependency)
- - `dotenv` ^17.2.3 (dependency)
- - `esbuild` ^0.28.0 (devDependency)
- - `express` ^4.21.2 (dependency)
- - `jsbarcode` 3.12.3 (dependency)
- - `lucide-react` ^0.546.0 (dependency)
- - `motion` ^12.23.24 (dependency)
- - `react-dom` ^19.0.1 (dependency)
- - `react` ^19.0.1 (dependency)
- - `supabase` ^3.0.0 (devDependency)
- - `tailwindcss` ^4.3.3 (devDependency)
- - `tsx` ^4.21.0 (devDependency)
- - `typescript` ^7.0.2 (devDependency)
- - `vite` ^8.3.0 (dependency)

src/ tree (maximum two directory levels):
```text
src/
  src/App.tsx
  src/components/
    src/components/BarcodeScannerTest.tsx
    src/components/CashBookScreen.tsx
    src/components/ControlledDrugScreen.tsx
    src/components/CustomerDisplayView.tsx
    src/components/CustomerLedgerScreen.tsx
    src/components/DashboardView.tsx
    src/components/DiscountBox.tsx
    src/components/EndOfDayModal.tsx
    src/components/GlowCredit.css
    src/components/GlowCredit.tsx
    src/components/HelpSupportView.tsx
    src/components/inventory/
    src/components/InventoryScreen.tsx
    src/components/labels/
    src/components/LoginView.tsx
    src/components/ManageUsersView.tsx
    src/components/masterDataSimilarity.test.ts
    src/components/masterDataSimilarity.ts
    src/components/MasterDataView.tsx
    src/components/MyPrintRequestsView.tsx
    src/components/PharmaLogo.css
    src/components/PharmaLogo.tsx
    src/components/POSBillingView.tsx
    src/components/POSScreen.tsx
    src/components/PrintRequestsAdminView.tsx
    src/components/PrintSalesReport.tsx
    src/components/PurchaseHistoryView.tsx
    src/components/ReportsScreen.tsx
    src/components/returns/
    src/components/SalesHistoryView.tsx
    src/components/SettingsView.tsx
    src/components/Sidebar.tsx
    src/components/sidebarMenuPosition.ts
    src/components/sidebarPages.ts
    src/components/sidebarPinLogic.test.ts
    src/components/sidebarPinLogic.ts
    src/components/StockAlertBell.tsx
    src/components/StockPurchaseView.tsx
    src/components/SuppliersView.tsx
    src/components/TemplatePreviewModal.tsx
    src/components/TopNav.tsx
    src/components/TrashBinView.tsx
    src/components/UserPreferencesPanel.tsx
    src/components/WhatsAppRemindersView.tsx
  src/config/
    src/config/developer.ts
  src/constants/
    src/constants/brand.ts
  src/data/
    src/data/demoDataManager.ts
    src/data/mockPharmacyData.ts
    src/data/posCatalog.ts
    src/data/posCatalogLogic.test.ts
    src/data/posCatalogLogic.ts
    src/data/returnLogic.test.ts
    src/data/returnLogic.ts
    src/data/saleReturns.ts
    src/data/sales.ts
    src/data/sidebarPreferences.ts
    src/data/stockAlertLogic.test.ts
    src/data/stockAlertLogic.ts
    src/data/stockAlerts.ts
  src/index.css
  src/main.tsx
  src/permissions.test.ts
  src/permissions.tsx
  src/types/
    src/types/pharmacy.ts
  src/utils/
    src/utils/auth.ts
    src/utils/customerDisplay.test.ts
    src/utils/customerDisplay.ts
    src/utils/discount.test.ts
    src/utils/discount.ts
    src/utils/fefo.test.ts
    src/utils/fefo.ts
    src/utils/fetchAllSupabaseRows.ts
    src/utils/labelUtils.test.ts
    src/utils/labelUtils.ts
    src/utils/printRequestEditor.test.ts
    src/utils/printRequestEditor.ts
    src/utils/printRequestTypes.ts
    src/utils/printSnapshot.test.ts
    src/utils/printSnapshot.ts
    src/utils/printWorkflow.ts
    src/utils/receipt.test.ts
    src/utils/receipt.ts
    src/utils/salesReport.test.ts
    src/utils/salesReport.ts
    src/utils/stockAlertsEvents.ts
    src/utils/storageMigration.ts
    src/utils/storeSettings.ts
    src/utils/supabase.ts
    src/utils/supabaseError.test.ts
    src/utils/supabaseError.ts
    src/utils/trashBin.test.ts
    src/utils/trashBin.ts
    src/utils/useBarcodeScanner.test.ts
    src/utils/useBarcodeScanner.ts
    src/utils/userDisplayPreferences.ts
```

Test files:
- src/components/inventory/inventoryUiLogic.test.ts
- src/components/inventory/productFilterLogic.test.ts
- src/components/inventory/productImportLogic.test.ts
- src/components/inventory/stockInventoryLogic.test.ts
- src/components/masterDataSimilarity.test.ts
- src/components/sidebarPinLogic.test.ts
- src/data/posCatalogLogic.test.ts
- src/data/returnLogic.test.ts
- src/data/stockAlertLogic.test.ts
- src/permissions.test.ts
- src/utils/customerDisplay.test.ts
- src/utils/discount.test.ts
- src/utils/fefo.test.ts
- src/utils/labelUtils.test.ts
- src/utils/printRequestEditor.test.ts
- src/utils/printSnapshot.test.ts
- src/utils/receipt.test.ts
- src/utils/salesReport.test.ts
- src/utils/supabaseError.test.ts
- src/utils/trashBin.test.ts
- src/utils/useBarcodeScanner.test.ts
- supabase/functions/manage-users/policy.test.ts

Environment variable names from .env.example files (values are not read into this block):
- APP_URL
- DEMO_MODE
- GEMINI_API_KEY
- SUPABASE_ANON_KEY
- SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_SUPABASE_URL
<!-- AUTO:END -->
