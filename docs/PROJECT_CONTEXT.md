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
- `src/components/POSBillingView.tsx`: active POS workflow, cart, and completed-sale printing.
- `src/utils/receipt.ts`, `printSnapshot.ts`, `printWorkflow.ts`: Pharmacy Memo rendering, safe print snapshots, and print-request workflow.
- `src/components/SettingsView.tsx`, `TemplatePreviewModal.tsx`: receipt template/paper settings and preview.
- `src/components/InventoryScreen.tsx`, `src/components/inventory/`: Products and Stock Inventory UI, shared inventory UI, and pure logic.
- `src/components/StockPurchaseView.tsx`, `PurchaseHistoryView.tsx`: purchasing and purchase history.
- `src/components/CustomerLedgerScreen.tsx`, `Customers`-related screens in `src/components/`: customer balances, ledger, and payment slips. Some data remains demo/in-memory; inspect the current page before assuming persistence.
- `src/components/ManageUsersView.tsx`, `src/permissions.tsx`, `src/utils/auth.ts`: staff, roles, UI permission checks, and profile/auth helpers.
- `src/components/TrashBinView.tsx`: Admin Trash Bin with one-at-a-time permanent deletion for eligible users/products/suppliers; voided purchases remain audit-only, and referenced catalog records cannot be purged.
- Other feature screens in `src/components/` include Dashboard, Reports, Suppliers, Cash Book, Master Data, and print-request administration.
- `src/utils/`, `src/types/`, `src/data/`: reusable logic, TypeScript domain shapes, and mock pharmacy data.
- `supabase/migrations/`, `supabase/functions/`, `supabase/baseline/`: database migrations, Edge Functions, and a supplied schema snapshot.
- `docs/`: database references, `MASTER_PLAN.md`, `MULTI_SHOP_FULL_PLAN.md`, execution progress, redesign notes, and this context.
- `scripts/`, `.githooks/`: context generation and commit-hook tooling.
- `public/`: static assets and fonts.

## Data and storage

- Supabase Auth/Postgres: shared across clients connected to the same configured project. Products, Stock Inventory, purchase workflows, and supplier writes use server RPCs; supplier, product-unit, and profile reads still include direct table reads. Authorization and persistence are not uniform across every screen.
- Supabase Edge Functions: the `manage-users` function exists; print approval, requester-name listing, audited receipt-only modification, and profile Trash Bin events use database RPCs/Edge Functions.
- Supabase CLI is available as a local development dependency (`npx supabase`); hosted deployment still requires an authenticated CLI session and the correct project ref.
- Browser `localStorage`: per-browser/device preferences, saved inventory views, purchase drafts, receipt settings, per-user stock-alert keys seen, and other UI settings. These do not synchronize across counters.
- S1 owner-run SQL recovery package is under `supabase/fresh/`: it snapshots `public` table data, selected catalog metadata, and sequence state into an isolated forced-RLS schema. Owner reports successful snapshot execution and smoke test `complete: true` with all 26 table counts matching. Catalog metadata is not a complete schema restore. It is not a full database backup and does not include Auth users, Storage objects, or platform configuration.
- Personal theme, text size, animation, and similar-medicine display preferences are available from the Settings page to every signed-in role and are stored per user in this browser. They are presented as compact segmented controls and toggle rows. Shop identity, billing, and business settings remain hidden from non-admin roles.
- Mixed persistence: the active POS catalog uses `pos_catalog()`; the client calls `post_sale_with_customer_details()` (which delegates to `post_sale()`). Owner reports the POS customer-details migration and smoke test passed, and S5 batches 027, 029, 032, and supplier Batch 039 passed their owner-run smoke tests. Query 033 found five unscoped purchase RPCs; Query 034 confirmed no purchase rows, a valid unique `(shop_id, pr_no)` index, one counter assigned at `last_number = 0`, and two suppliers with NULL `shop_id` before Batch 039. Queries 035-038 found six unscoped print RPCs, unscoped Trash routines, and unscoped `stock_alerts_summary()`; their authenticated grants deny anon/PUBLIC. The supplier backfill/scope batch is owner-reported successful. Print had four shop-assigned requests and none pending; Trash had 56 shop-assigned events, and `restore_trash_medicine(uuid)` was absent. `stock_alerts_list()` is absent; `stock_alerts_summary()` is present and unscoped. Query 040 initially failed because it joined `stock_batches.purchase_id`, a column that does not exist; the purchase-to-batch relationship is through `purchase_items`. Query 050 supersedes it with a consolidated read-only preflight for all remaining S5 groups. Dashboard stock/expiry KPIs still use `INITIAL_PRODUCTS` sample data, and Cash Book transactions/expenses remain React in-memory state.
- Other storage: unknown; no general file/object-storage workflow is established by the checked-in frontend docs.
- Shared production data behavior depends on Supabase deployment and the live schema, which may differ from checked-in migrations.

## Roles and permissions

Role names in `src/types/pharmacy.ts`: `admin`, `super_admin`, `manager`, `cashier`, `accountant`.

Permission keys in `src/permissions.tsx`: `pos`, `products`, `categories`, `suppliers`, `customers`, `sales_history`, `purchase_history`, `purchases`, `expenses`, `stock_inventory`, `reports`, `manage_users`, plus POS print toggles `pos_print_sale` and `pos_print_payment`.

UI defaults: Admin and Super Admin get every module. Manager gets POS, Products, Categories, Suppliers, Customers, Sales History, Purchase History, Purchases, Stock Inventory, and Reports. Cashier gets POS and Customers. Accountant gets Customers, Suppliers, Sales History, Purchase History, Expenses, and Reports. Non-admin permissions can be configured; admin roles use their full defaults. Dashboard/help, personal print requests, and the Settings route are available to all; non-admin Settings contains personal display/accessibility preferences only. Shop/business Settings, Trash Bin, and print-request administration remain Admin/Super Admin-only. UI checks do not replace database/server authorization.

Cost visibility target: Admin and Super Admin may view cost; Manager may view it only with at least one of `products`, `stock_inventory`, `purchases`, or `purchase_history`; Accountant may view it read-only through `purchase_history` or `reports`; a Cashier explicitly granted `products` may view product cost on Products/Add Product screens only, never in POS or other interfaces. This is view-only access and does not grant purchase, batch-cost, profit, or margin access. Current `can_view_cost()` excludes Cashiers, so this approved change is not yet implemented; production behavior still requires live verification.

- Confirmed multi-tenant target: Super Admin is platform-only (`shop_id = NULL`), manages shops/Admin accounts/page grants, and has no shop-business access or catalog-seeding exception. The initially empty Developer Shop uses a separate Admin login; all retained current non-Super-Admin accounts/data map to Shop 1. A shop may have multiple Admins. Super Admin grants each Admin's pages; Shop Admins may manage only Manager/Cashier staff in their shop and may grant only permissions they hold. Staff cannot manage accounts; only Super Admin manages Admins, shop assignment, and account status. Preserve creator-scoped Team view behavior. Only Super Admin may see shop IDs or read/edit private Admin notes through protected server paths. S1/S2 ACL and backup checks passed by owner report; owner chose no cleanup. S3 preparation/backfill/smoke checks passed by owner report: 24 business tables are assigned to one active Pharma Care shop, Super Admin is unassigned, 24 shop FKs/indexes exist, and privacy checks pass. Owner confirms `tenant_private` is unchecked in Data API Exposed schemas and Dashboard, Products, POS, and Sales History open without errors. Owner's inventory confirms all 24 tenant tables and `shops` have RLS enabled (not forced), no public views, and two self-scoped preference tables. S4 duplicate preflight passed. Diagnostic found four null-shop Super Admin audit events, no other unassigned business rows, and zero objects from the failed 011 attempt. Owner applied 011 (16 scoped indexes and 27 composite FKs); 011/013 smoke tests passed, validating all 27. Owner applied 014 and its smoke test passed, confirming old global keys and parent-only FKs were removed. Owner's 008 RLS metadata smoke test passed for all 24 tenant tables, shop-ID concealment, Super Admin own-profile/platform-event scope, and helper grants. Owner reports the app/role checks work; S4 is complete for the current single-shop phase. Cross-shop isolation remains a later release gate. Owner's S5 inventory found 70 routines (67 SECURITY DEFINER), none executable by anon, 58 executable by authenticated, and no SECURITY DEFINER routine missing a configured search_path. Owner reports batches 017, 019, 021, 023, 025, 027, 029, 032, and 039 with their smoke tests passed; Query 050 consolidates the remaining S5 preflight. Earlier inventories found five unscoped purchase RPCs and the global purchase counter; the live PR uniqueness index was already shop-scoped. Queries 036-038 found unscoped print, Trash, and stock-alert RPCs; `restore_trash_medicine(uuid)` is absent. Review Query 050 before preparing grouped S5 migrations.

Permission review findings from current source: Admin and Super Admin bypass assigned page permissions in both UI defaults and database `has_any_permission`; Super Admin can therefore reach business pages despite the platform-only target. Shop Admin user management can grant any permission and is scoped by `created_by`, not shop. Non-admin users granted `manage_users` can manage lower-role accounts, contrary to the approved staff boundary. Cashier defaults are POS and Customers; POS catalog omits cost, but `can_view_cost()` also denies Cashiers with `products`, so the approved Products-only cost exception is not implemented. Client page checks are UX controls; database/RPC/Edge Function checks remain authoritative.

Owner Q6 ACL evidence: direct authenticated writes exist on customers, khata_entries, medicine_units, medicines, sale_payments, sales, stock_movements, and supplier_ledger; the earlier inventory also found authenticated access to medicine_barcode_seq. Later ACL changes removed those barcode-sequence grants, and query 024 confirms anon/authenticated lack USAGE. Profiles and suppliers retain REFERENCES/TRIGGER/MAINTAIN alongside SELECT. Direct per-user CRUD on user_favorites and user_sidebar_preferences is protected by own-row RLS. Sixteen current routines expose EXECUTE to anon and/or PUBLIC. Future-object defaults expose postgres-owned functions to anon/authenticated and sequences to authenticated; supabase_admin defaults expose tables, sequences, and functions to anon/authenticated. The five cost-bearing base tables have no anon/authenticated ACL listed in Q6. ACL lockdown files now match the six-argument save_supplier signature and exact rollback grants; table ACL migration also removes excess MAINTAIN and barcode-sequence grants. Supplier activation and demo cleanup no longer fall back to direct table writes. `npm run lint`, `npm run build`, and `git diff --check` pass; SQL has not been runtime-tested or applied.

## Business rules

- Persisted money columns and calculation fields use integer paisa; `sale_items.discount_percent` is numeric.
- POS customer type and optional phone, WhatsApp, address, and notes are stored on each sale by the additive `20261112190000_pos_customer_details.sql` migration. Its scoped `sales_history_range()` RPC fetches the complete selected interval for Business Analytics without returning customer contact details. The owner must apply the migration before deploying the client changes; the assistant has not run SQL against the live database.
- Barcode package 025 is owner-reported applied with its smoke test passing: the package adds a shop-scoped medicine/unit registry, immutable per-shop prefixes/counters for Code 128 values, and preserves valid manual EAN-13 support. The legacy global sequence is left in place but no longer used by the revised writers.
- Batch sale allocation in `src/utils/fefo.ts` uses FEFO: positive eligible stock only, `ACTIVE`/`NEAR_EXPIRY`, expiry today or later, then received date and ID for tie-breaking. It rejects an insufficient allocation rather than returning a partial sale. Server-side enforcement depends on the deployed RPC/schema and must be verified there.
- Expiry is a stock-batch field, not a medicine/product-master field. Product setup does not require expiry, but every purchase batch currently requires a future expiry date; no-expiry batches are not supported by the schema or sale/alert rules.
- Do not permit negative stock. Verify the server transaction and constraints as well as frontend allocation before relying on this in production.
- Stock alerts use sellable stock from positive, unexpired (`expiry_date >= current_date`), `ACTIVE`/`NEAR_EXPIRY` batches for active medicines. Alert low/out counts require `min_stock_alert > 0`; the alert RPC returns no cost, MRP, supplier, or cost-derived value and is available to every active, non-deleted profile regardless of module permission. The existing Products `out_of_stock` KPI does not apply the positive-reorder-threshold condition, so its count may exceed alert out counts. Owner-supplied live results show `stock_alerts_summary` exists with anon EXECUTE false/authenticated true; no migration-history result or end-to-end behavior was supplied.
- Cost and profit/margin are internal data, not Pharmacy Memo print fields. Receipt rendering displays sale amounts/totals and is styled black on white. Do not add cost, purchase price, profit, or margin to customer-facing slips.
- Cost-bearing base tables stay inaccessible to `anon` and `authenticated`; read cost only through permission-checked RPCs. Do not grant direct `SELECT` on `stock_batches`, because its RLS read policy includes `pos` and exposes all selectable columns to Cashier.
- Pharmacy Memo supports 58mm and 80mm thermal layouts (and A4); black text on white background. Return/payment memo rendering exists. The owner reports the rollback-only return RPC smoke test passed, covering test-sale return processing, rejection, and foreign-shop denials. Full app/UI, cash payout, and accounting reconciliation remain unverified.
- Implemented return policy in source and migration: only sealed, intact, same-sale-batch units meeting configured shelf-life/window/class/storage rules may be restocked; a Manager/Admin must approve, with `sales_history` and `stock_inventory` required for restock. Cashiers with POS may request returns but cannot approve. `QUARANTINE` and `WRITE_OFF` do not increase sellable stock. Refunds use original line totals in integer paisa; credit-sale returns update customer credit/ledger. Cumulative returns cannot exceed sold quantity, while multiple partial-return transactions are allowed. Query 030's seven live RPC bodies match the reviewed Batch 029 replacements and their read/write scope was reviewed. Latest Query 029 confirms the per-shop policy primary key and one-shop row coverage; owner reports the rollback-only runtime smoke test passed. Runtime isolation beyond the smoke fixtures and accounting reconciliation remain unverified. New-shop provisioning must seed a `return_policy_settings` row.
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
- Date: 2026-10-12 — Historical cost-access rule: Cashier was always denied, Accountants were read-only, and Manager access required a relevant module permission. The 2026-11-07 approved Products-only Cashier exception is a target decision; current `can_view_cost()` still denies Cashiers.
- Date: 2026-10-09 — Pharmacy Memo uses a shared sanitized renderer for 58mm/80mm and A4; template and paper preferences remain browser-local because shared settings storage is not implemented.

## Current status

- **S1/S2 owner-reported status:** S1 snapshot and S2 ACL checks passed; the 26-table backup-only verification passed and the owner chose to preserve all data. A1 is applied; optional A2 remains gated on its preflight. S3/S4 single-shop tenant foundations are owner-reported complete; two-shop isolation remains a release gate. See `docs/EXECUTION_PROGRESS.md` and `docs/MASTER_PLAN.md`.
- **S2 known mismatch:** The expected `restore_trash_medicine(uuid)` RPC is absent from the live catalog despite the checked-in migration. Do not rerun `20261012170000_trash_bin_history.sql` wholesale; reconcile the RPC separately. A prior privilege check also found authenticated write privileges and barcode-sequence grants that needed the later ACL package.
- **Owner workflow:** Prefer one copyable read-only result per verification stage, keep forward and rollback SQL separate, and gate every database stage on owner-run checks. Owner prefers the Supabase SQL Editor and does not want DBCode connected; never ask for or record credentials. A credential appeared in a historical DBCode setup screenshot; ensure it has been rotated before reuse. Prior customer-display, user-management, SPA/PWA, alerts, and Track A hardening work is in feature docs and Git history.
- **S4/S5 status:** Owner reports S4 stages 011/013/014/008 passed; all 24 tenant tables have `shop_id` and RLS, and 27 composite FKs plus shop-scoped indexes are validated. Two-shop isolation remains a release gate. Owner reports S5 batches 017, 019, 021, 023, 025, 027, 029, 032, and 039 and their smoke tests passed. Query 050A-C report zero purchase/reference mismatches, no purchase rows, one shop counter at 0, four shop-scoped print requests with none pending, and 56 shop-scoped Trash events with no null shop IDs; `restore_trash_medicine()` is absent. Query 050E found unscoped `customer_accounts_summary()`; owner reports 050F applied and its cross-shop smoke test passed. Query 050G now confirms other authenticated business RPCs are unscoped; grouped 040-043 remains blocked.
- **Fixed in `b62b547`:** Product-controlled label text is HTML-escaped in generated print markup using the shared receipt helper; hostile markup and quoted attribute payloads are covered by tests. The existing receipt/memo rendering behavior is unchanged.
- **Done/history:** Barcode generation/printing, Products/Master Data/Stock Inventory redesigns, shared receipts/POS printing, and Phase 4a owner-reported migrations are recorded in feature docs. `docs/REDESIGN_PROGRESS.md` has stale Phase 4 status; newer source and owner report supersede it. Barcode follow-up prompt: `docs/barcode-labels-agent-prompt.md`.
- **In progress:** Purchases and Purchase History use RPCs. The owner reports that 4c's direct-table revokes are applied and verified in the test-data Supabase project. Verify the deployed `can_view_cost()` definition and table grants before release.
- **In progress:** Products compact filter toolbar: debounced search, wrapping filter pills, removable active-filter chips, and a tested clear-all/reset helper. No RPC or database behavior changed.
- **Done:** Manage Users list handling now falls back safely when response fields are absent and reports a likely stale `manage-users` deployment instead of crashing.
- **Owner-reported applied; source verified:** POS checkout posts sales through `post_sale`, supports server-recorded cash/online/credit/split payments, and updates customer credit state. Owner reports `20261013160000_persist_sales_and_returns.sql` applied successfully after fixing two SQL syntax errors, and shared query results verify selected RPC ACL/security metadata. Runtime sale/return behavior has not yet been verified.
- **Implemented in source; migration pending:** POS now captures customer type and optional contact details, and Custom Business Analytics fetches the selected local-date interval through a shop-scoped RPC. Apply `supabase/migrations/20261112190000_pos_customer_details.sql` and run `supabase/fresh/021_pos_customer_details_smoke_test.sql` before deploying the updated frontend. The rollback removes the new RPCs but intentionally retains the additive columns and existing values.
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
- **Next:** 050H's smoke test reached its synthetic `sale_items` fixture and failed the configured unit-price validation. The fixture has been corrected to match configured unit sale prices. The owner then reported “successful, no rows”; the script's final `ROLLBACK` could hide the earlier PASS result. The script now rolls back before its final PASS `SELECT`. Owner should recopy and rerun only `supabase/fresh/050H_scope_authenticated_business_rpcs.smoke_test.sql`; do not rerun the migration. Grouped 040-043 stays blocked until the visible PASS row is returned. The assistant has not run live SQL or pushed.

## Known issues and Later

- Query 050G owner output confirms authenticated `master_data_overview()`, `pos_customers()`, `sales_history(integer)`, and `record_customer_payment(uuid, integer, text)` lacked current-shop checks; the first three read across all shops, while payment used a customer ID without a same-shop guard. `save_customer(...)` relied on the shop-assignment trigger rather than explicit RPC scope. 050H scoped replacements and safe rollback are prepared. Its smoke test passed function preflight; after correcting the fixture prices, the owner reported success with no rows. The PASS `SELECT` now follows `ROLLBACK` so the result is visible; owner must rerun the updated smoke test. Anon and PUBLIC execute were false in the supplied 050G result.
- Owner-approved multi-shop decisions and the detailed plan are in `docs/MULTI_SHOP_FULL_PLAN.md` and `docs/MASTER_PLAN.md`. S3/S4 single-shop tenant foundations are applied by owner report; cross-shop isolation and later S6 remain incomplete. Private notes require reviewed server/database support, not browser-local storage. Keep owner-run SQL stages gated on reviewed outputs.
- Optional A2 default-privilege changes remain unapplied. The Q6 inventory omits global default ACLs; do not apply A2 or run either rollback until `supabase/fresh/trackA/002_default_privilege_preflight.sql` has been run by the owner and the rollback has been matched to its output.
- Current code conflicts with some role targets: Admin/Super Admin defaults grant every module, Admin can grant all permission keys, and staff with `manage_users` may manage lower-role accounts. The shop schema exists, but explicit page grants and platform-only Super Admin business boundaries still need implementation and owner verification.
- DBCode VS Code extension reported a SQL language-server startup timeout followed by closed connections in editor logs on 2026-10-13; the exact cause is unknown and no database operation or project runtime failure is indicated by those log lines.
- Live Supabase schema/RPC availability may lag behind checked-in migrations; verify migration state before diagnosing app behavior.
- Sidebar favorites and their one-time tip dismissal are persisted per `auth.uid()` with user-only RLS and no `shop_id`; they are not yet isolated by shop even though the tenant helper exists.
- POS catalog fallback can display demo medicines (`DEMO-MED-*`) when demo data is locally active or the live catalog is empty; checkout still submits those IDs to `post_sale()`, whose medicine/unit IDs must be UUIDs. A sale containing a demo item therefore fails with PostgreSQL `invalid input syntax for type uuid`; use actual database-backed catalog entries and investigate why the live catalog is empty before retrying.
- Part B SQL remains unexecuted and incomplete. Existing `pos_catalog()` still returns inactive/unpriced units using legacy `price_paisa`; database triggers may reject checkout after such a unit is shown. Zero versus unpriced semantics, fallback pricing from batch MRP, strict default-unit behavior, live RPC compatibility, and ACL restoration on rollback need owner review. See `supabase/fresh/features/README_pack_size_pricing.md`.
- Production browser code is delivered as hashed JavaScript and remains inspectable by design; source maps are absent from current production assets. The named `version` import removed local test-file path strings, but cannot hide shipped app code. The frontend reads only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the owner-reported Vercel names do not include these, and `NEXT_PUBLIC_*` names are not read by this Vite app. Verify the Production build environment before redeploying. Historical-only `supabase/.temp/pooler-url` has no embedded password; no credential-shaped values were found by the limited repository/history scan. The earlier source-sighting URL remains unverified.
- Historical readiness baseline (2026-10-21, intended development/test project; superseded by later S3/S4 owner reports): 26 public tables had RLS enabled/not forced and no shop columns; no views, Storage buckets/policies, Realtime publication tables, or migration ledger were listed. The inventory found 57 functions, 55 SECURITY DEFINER, 16 anon-executable and 11 PUBLIC-executable. No runtime anon RPC call was run at that time. The owner later reported completing the S3/S4 tenant foundation and ACL stages. Do not use this historical baseline as current schema evidence.
- A previous sign-in error was reported, but current authentication/runtime status was not tested in this audit. POS source requires active medicine, configured units, and positive eligible stock; the stock alert function requires `min_stock_alert > 0` for both low and out alerts.
- The print-request requester-name and modify RPCs in `20261012160000_modify_print_requests.sql` are local until that migration is applied to the target Supabase project.
- The Manage Users UI requires `api_version: 2`; owner-run CLI output confirms the matching `manage-users` function was deployed to project `itdetfyxrwixhxsfydfz` on 2026-11-04. Refresh and verify in the app; do not redeploy unless the warning remains. If a PowerShell/VS Code terminal cannot resolve Node, restart VS Code to inherit the persisted user PATH or append `C:\Program Files\nodejs` to that terminal's `$env:Path`. Trash Bin event schema/triggers/listing/restore RPCs in `20261012170000_trash_bin_history.sql` remain local until their separate migration/function deployment.
- Barcode workflow is partial: assignment targets `medicines.barcode`; the checked-in unique index is global and does not cover `medicine_units.barcode` or future shops. Client actions, per-product label quantities, scanner test, and POS/Products keyboard scanning are implemented, but live RPC availability, unit-barcode scanning, cross-shop uniqueness, and physical scanner/printer output are unverified. Product label printing supports linear formats only; QR-code generation is not implemented. Owner reported manually running the legacy barcode SQL, but no live schema query was performed in this checkout.
- Supabase bootstrap hazard: `supabase/baseline/00_baseline_schema.sql` is a reconstructed schema reference, not a complete dump. The migration directory also contains timestamped barcode rollback files; do not apply them as forward migrations. Bootstrap instructions and metadata-only comparison queries are in `docs/STAGING_BOOTSTRAP.md`.
- Approved business rule: positive stock in `ACTIVE`/`NEAR_EXPIRY` batches for an active medicine remains sellable through expiry (`expiry_date >= current_date`). `src/utils/fefo.ts` uses this boundary; verify the deployed RPC uses the same rule.
- Trash Bin tracks app product/supplier deactivation and purchase-void workflows; out-of-band physical deletions made through another client or dashboard are not captured.
- Print requests are stored in `public.print_requests`; the admin UI has no permanent-delete action. Removing a request row does not remove its related audit-log history.
- Shared settings across counters are not implemented; receipt templates and some preferences are browser-local.
- Sale-return request/review is implemented in source; the owner reports the rollback-only RPC smoke test passed. Cash payout/accounting reconciliation, broader UI workflows, and Sales History reporting remain unverified. Sales History reprint is not implemented; return memo rendering and print-request review are separate.
- Direct ESC/POS printer-driver support is not implemented; browser printing uses the browser print dialog.
- Several screens still use mock/in-memory data; identify persistence from the current component before changing it.
- Supplier reads still include direct table access; create/update/activation/deactivation now use shop-scoped, permission-checked RPCs by owner report after Batch 039 and its smoke test passed.
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

- 2026-11-14 — Owner reports 050F applied and its smoke test passed: same-shop customer and ledger visible, foreign-shop data hidden, and platform Super Admin denied. The 050F smoke test uses synthetic fixtures and rolls them back. Remaining grouped S5 work awaits review of other 050D SECURITY DEFINER definitions; marker flags alone are not proof of tenant safety.
- 2026-11-14 — The owner no longer had the earlier 050D output, so prepared 050G as one read-only JSON query for remaining public SECURITY DEFINER candidates. Reviewed the owner-provided result: four authenticated business RPCs were unscoped, and `save_customer` relied on the shop-assignment trigger. The owner chose scoped fixes; prepared 050H migration, disable-only rollback, and rollback-only two-shop smoke test. SQL parsed locally only; no live SQL was run.
- 2026-11-14 — The owner-reported 050H smoke test failed sale-item unit-price validation; its foreign unit fixture was 1,000 paisa while the sale item used 9,000,000 paisa. Corrected both synthetic unit fixtures to set explicit matching sale prices, and added a fixture-price assertion. Rerun the smoke test only; migration is not to be rerun. No live SQL was run by the assistant.
- 2026-11-14 — The owner reported the corrected 050H smoke test returned “successful, no rows.” Moved its PASS result query after the final fixture-cleanup `ROLLBACK` so SQL Editor displays the result; owner must rerun the updated smoke test. The assistant has not run live SQL.
- 2026-11-14 — At the owner's explicit request, pushed the prepared S5 SQL package and related documentation to `feature/team-view-manage-users` in commit `ac76eb8`. No live SQL or deployment was performed by the assistant.
- 2026-11-12 — Added POS customer-type/details capture and compact POS-only layout, plus inclusive local-date Custom Analytics backed by a shop-scoped date-range RPC. TypeScript, tests, and build pass; database migration is owner-run and unapplied here.
- 2026-11-11 — S2 backup-only verification passed: 26 tables, complete, and no checks. The owner chose no cleanup; preserve all current data.
- 2026-11-11 — S3 preflight found 26 RLS-enabled tables, no shop objects, and 66 policies. Owner chose Shop 1 `Pharma Care`; privilege/RPC checks found table-wide SELECT and a `request_print` response exposing whole-row data. S3 therefore uses safe column grants/projections and removes `shop_id` from that response; no Admin UUID is needed, and client-supplied shop IDs are not trusted.
- 2026-11-12 — Initial S3 DDL/backfill failed with PostgreSQL 55006 and left no objects behind; schema preparation and locked backfill were split. Owner reports revised prep/backfill/smoke passed: 24 tables assigned to one active Pharma Care shop, Super Admin unassigned, 24 FKs/indexes, privacy checks pass, and `tenant_private` remains unexposed; Dashboard, Products, POS, and Sales History open without errors.
- 2026-11-12–13 — Owner prefers Supabase SQL Editor, not DBCode. S4 is complete for the single-shop phase by owner report. Owner reports S5 batches 017, 019, 021, 023, 025, 027, 029, and 032 passed. Queries 034-038 found no purchases, a valid per-shop PR index and counter, two active unreferenced suppliers without shop assignment, six unscoped print RPCs, unscoped Trash operations with one missing restore function, and an unscoped stock-alert summary. No live SQL was run by the assistant or push performed.
- 2026-11-10–11 — Added the Vercel SPA fallback and per-user customer-display links; polished installation, Trash Bin, password visibility, design tokens/icons, and TopNav password access. Tests, TypeScript, and build passed; hosted SQL/Edge Function deployment and authenticated visual verification remain owner work.
- 2026-11-03–09 — Owner-run S1/S2 and Manage Users deployment completed. Earlier barcode/returns, Admin controls, UI, performance, and POS work is documented in feature plans and Git history.

## Legacy barcode migrations

Do **not** apply `20261012180000_assign_medicine_barcodes.sql` or `20261012181000_medicines_barcode_unique_index.sql` to the current project. They are legacy, pre-multi-shop migrations and are not part of the owner-approved S1-S6 rollout.

The future per-shop barcode cutover must backfill one registry across both `medicines.barcode` and `medicine_units.barcode`, enforce unique `(shop_id, normalized_barcode)`, and replace the global medicine-only index. As part of that cutover, explicitly drop `public.medicines_barcode_unique` with `DROP INDEX IF EXISTS`; replace the old assignment functions and global sequence with shop-scoped registry claims/counters. Do not run the timestamped barcode rollback files as forward migrations. A rollback must not blindly recreate the global index if different shops now share a manufacturer barcode.

## Working agreements with the owner

- Keep messages short.
- Large multi-file changes need a plan and the owner's OK first.
- Updating this file never needs permission.
- Keep factual claims grounded in current code/docs; write **unknown** where verification is missing.

<!-- AUTO:START -->
Generated at (UTC): 2026-11-14T00:14:25.895Z
Git branch: feature/team-view-manage-users

Last 5 commit subjects:
- Prepare S5 tenant-scope SQL stages
- Complete POS, analytics, and tenant rollout work
- Fix Vercel customer display deep links
- Persist customer display link per account
- Complete POS settings and access-control updates

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
- - `test:store-settings`: `tsx --test src/utils/storeSettings.test.ts`
- - `test:install-prompt`: `tsx --test src/utils/installPrompt.test.ts`
- - `test:pos-customer`: `tsx --test src/utils/posCustomer.test.ts`
- - `test:report`: `tsx --test src/utils/salesReport.test.ts`
- - `test:discount`: `tsx --test src/utils/discount.test.ts`
- - `test:barcode-scanner`: `tsx --test src/utils/useBarcodeScanner.test.ts`
- - `test:labels`: `tsx --test src/utils/labelUtils.test.ts`
- - `test:permissions`: `tsx --test src/permissions.test.ts`
- - `test:sidebar`: `tsx --test src/components/sidebarPinLogic.test.ts`
- - `test:manage-users-policy`: `tsx --test supabase/functions/manage-users/policy.test.ts`
- - `test:customer-display`: `tsx --test src/utils/customerDisplay.test.ts`
- - `test`: `npm run test:fefo && npm run test:receipt && npm run test:inventory-ui && npm run test:stock-inventory && npm run test:inventory-products && npm run test:stock-alerts && npm run test:pos-catalog && npm run test:product-filters && npm run test:master-data && npm run test:print-snapshot && npm run test:print-request-editor && npm run test:trash-bin && npm run test:store-settings && npm run test:install-prompt && npm run test:pos-customer && npm run test:report && npm run test:discount && npm run test:barcode-scanner && npm run test:labels && npm run test:permissions && npm run test:sidebar && npm run test:manage-users-policy && npm run test:customer-display`

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
    src/components/CustomerDisplayView.tsx
    src/components/CustomerLedgerScreen.tsx
    src/components/DashboardView.tsx
    src/components/DiscountBox.tsx
    src/components/EndOfDayModal.tsx
    src/components/GlowCredit.css
    src/components/GlowCredit.tsx
    src/components/HelpSupportView.tsx
    src/components/InstallAppPrompt.tsx
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
    src/components/PrintRequestsAdminView.tsx
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
    src/utils/installPrompt.test.ts
    src/utils/installPrompt.ts
    src/utils/labelUtils.test.ts
    src/utils/labelUtils.ts
    src/utils/posCustomer.test.ts
    src/utils/posCustomer.ts
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
    src/utils/storeSettings.test.ts
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
- src/utils/installPrompt.test.ts
- src/utils/labelUtils.test.ts
- src/utils/posCustomer.test.ts
- src/utils/printRequestEditor.test.ts
- src/utils/printSnapshot.test.ts
- src/utils/receipt.test.ts
- src/utils/salesReport.test.ts
- src/utils/storeSettings.test.ts
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
