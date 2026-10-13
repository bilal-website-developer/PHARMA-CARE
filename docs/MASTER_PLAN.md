# Pharma Care — Master Implementation Plan

**Status:** Approved for execution with the owner's decisions recorded below. Execution is stopped at the staging-bootstrap checkpoint pending the owner's SELECT-only comparison results. No application code or migration files have been changed for implementation, and no query has been run against any database by the assistant.

**Execution branch:** `master-plan/implementation`, created from clean commit `adf3606` (`barcode/labels`). No merge or push.

**Git state at planning time:** `git status --short --branch` showed `## barcode/labels` with no changed-file entries; `git branch --show-current` returned `barcode/labels`. The recent history is reproduced in the chat accompanying this file.

## Owner-approved execution amendments

- Tenancy is one shared Supabase project. Every shop-owned table is scoped by `shop_id`; medicines, categories, brands, suppliers, customers, sales, stock, purchases, settings, and print requests are shop-owned. Proceed only after two-shop isolation tests and staging acceptance.
- One person/user belongs to exactly one shop. `super_admin` is platform-level: manages shop/account metadata but does not browse shop business data. An explicit exception allows separate, audited, target-shop catalog seeding by Super Admin; it does not grant general shop access. Shop 1 belongs to the owner-designated existing admin account; the current super-admin login will not operate shop pages.
- Suspension blocks sign-in and business operations while preserving shop data. Licence/renewal and billing dates are deferred. No routine platform-owner support access to business data; emergency access must be explicit and audited where technically possible.
- Shop name and receipt identity come from one server-backed shop profile editable only by Super Admin. Admin/staff may read their own identity but cannot change it. Keep the logo and WhatsApp Reminders feature; replace the highlighted fixed header branding text with the configured shop name.
- Shop Admins retain all modules for their own shop. Add a selectable Settings permission for staff roles; it grants operational Settings access only and never shop-identity editing. This supersedes the previous permission design where it conflicts. Verify and widen the live profile permission constraint on staging.
- Creating a shop and Auth Admin spans separate Auth and Postgres systems; use a stepwise provisioning workflow with compensating undo, surfaced cleanup failures, idempotent retry, and an orphan cleanup check. Do not claim cross-system atomicity.
- Invoice, memo, and purchase numbers are sequential and unique per shop. Do not promise gap-free numbering unless concurrency, rollback, retry, and failure tests prove it.
- Table, policy, trigger, and function counts are staging inventory results to verify, not fixed facts; the reconstructed baseline may omit live objects.
- Sellable stock is positive quantity, `ACTIVE` or `NEAR_EXPIRY`, active medicine, and `expiry_date >= current_date`. Locate and align every conflicting helper, test, document, and SQL predicate.
- Do not enable TypeScript `strict` in the main quality package. Measure `noUnusedLocals`, `noUnusedParameters`, and `strict` separately. Enable unused checks and `react-hooks` ESLint first; evaluate strict in a separate final package only if the measured error count is manageable.
- Split W5: after the staging checkpoint, do the client UI/scanner work early. Every product row/card must expose Edit, Print barcode (with per-product quantity), and Make barcode; include a scanner test tool and scan handling in POS and Products search. Cap at 200 labels per product and 1,000 per job.
- Do not add a QR workflow. Remove `express` or `@types/express` only if repository usage is confirmed absent.
- First execution package is the staging bootstrap and SELECT-only catalog comparison in [STAGING_BOOTSTRAP.md](./STAGING_BOOTSTRAP.md). Stop and wait for CURRENT and STAGING results before writing any multi-shop migration. The assistant never runs SQL or deploys. Migrations and rollback files are authored for the owner to apply.
- Preserve cashier cost confidentiality. Do not change RLS or `is_staff`, `is_admin`, or `has_any_permission` without presenting old and proposed definitions for approval.
- Progress is recorded in [EXECUTION_PROGRESS.md](./EXECUTION_PROGRESS.md).
- The detailed tenant design and owner decisions are recorded in [MULTI_SHOP_FULL_PLAN.md](./MULTI_SHOP_FULL_PLAN.md).

## A. Reality check

Evidence below is from the checked-out source, supplied baseline, local migrations, and project docs. A migration file proves only that SQL is checked in. It does not prove the SQL is applied to any Supabase project. “Owner-reported applied” is not independent live verification.

| Prompt claim / work item | Status | What the repository actually shows |
|---|---|---|
| React 19, TypeScript, Vite, Tailwind v4 | **Partly verified** | React 19 and Vite are declared in `package.json:43-45`; `src/index.css:1` begins the Tailwind `@theme` block. `tsconfig.json:1-29` has no `strict`, `noUnusedLocals`, or `noUnusedParameters` setting, so the “TypeScript strict” assertion is **wrong for the current config**. No `tailwind.config.*` file was found. |
| Supabase Auth/Postgres/RLS and `manage-users` Edge Function | **Verified in source** | Supabase client is used by app components; the supplied schema is `supabase/baseline/00_baseline_schema.sql`; `supabase/functions/manage-users/index.ts` implements the user-management edge function. Deployment state remains **unknown**. |
| No Express/Node server; no react-router | **Partly wrong / verified** | No react-router dependency or route package is declared in `package.json`; page state is handled in `src/App.tsx`. However, `express` is a declared runtime dependency (`package.json:38`); whether an Express server is used by a separate script is not established by the claim and must be checked before removing it. |
| Roles are cashier, manager, accountant, admin, super_admin | **Verified** | `src/types/pharmacy.ts:1-7` enumerates these roles. |
| Money is integer paisa | **Verified as the DB/domain convention** | `docs/DATABASE.md` documents paisa columns; the baseline contains integer monetary columns. Some UI calculations use PKR for display/input and convert to paisa; retain integer-paisa persistence. |
| Sellable stock uses positive quantity, expiry `>= today`, ACTIVE/NEAR_EXPIRY, active medicine | **Current code conflicts with approved rule** | The owner has approved expiry through the date (`expiry_date >= current_date`). `src/utils/fefo.ts`, its tests, docs, and any server SQL using a strict `>` predicate must be aligned and tested to that rule. |
| Mint theme and Normal/Large UI | **Partly verified** | `src/index.css:1` defines theme tokens and the CSS uses `data-theme="night"`; `index.html` initializes theme preferences. Exact branded names “Light Mint / Emerald Night” and the UI-size controls need confirmation from the settings implementation, not assumption. |
| Installed libraries include `jsbarcode`, `qrcode`, `react-to-print`, `@e965/xlsx`, `lucide-react`, `motion`, `@google/genai` | **Partly wrong** | `package.json:33-40` declares `@e965/xlsx`, `@google/genai`, `jsbarcode`, `lucide-react`, and `motion`. `qrcode` and `react-to-print` are not declared in the checked-in manifest and no use was found. XLSX is dynamically imported in Products/Stock Inventory but statically imported by Purchase History. |
| Products already has saved views/import/export/bulk actions/Code128 labels | **Partly verified** | `src/components/InventoryScreen.tsx:199-381` stores saved views, `:638-790` handles export/import/bulk changes, `:792-858` handles barcode print/generation, `:979-1015` renders barcode column/generate, and `:1244-1248` supplies Edit through row actions. `src/components/labels/LabelPrintDialog.tsx:1-250` supports label sizes, preview and print. Current features do **not** equal W5: it has one shared copy count (`LabelPrintDialog.tsx:53-68,195`), a toolbar print entry (`InventoryScreen.tsx:1119`), and EAN-13 server assignment; not a per-product three-button row/card/detail workflow or per-product quantity. |
| “No Express/Node server” | **Not safe to claim** | `express` is a production dependency in `package.json:38`. Search `server.js`, scripts, and deployment config in execution before treating it as unused. |
| Test scripts and `npm test` chain | **Verified** | `package.json:14-30` defines the test scripts, including `test:barcode-scanner` and `test:labels`, and chains them through `npm test`. Current `lint` is only `tsc --noEmit` (`package.json:13`); no ESLint script/config was found. |
| Actual permission set | **Verified with baseline/migration distinction** | UI module keys are in `src/permissions.tsx:4-21`; separate print keys are at line 21. Baseline `profiles_permissions_valid` in `supabase/baseline/00_baseline_schema.sql:20` omits the two print keys; `20261009201000_add_pos_print_permissions.sql` widens it. The live constraint cannot be confirmed from local files. No `stock_alerts` key exists. |
| D1: POS sales, Sales History, Customer Ledger, Cash Book, Controlled Drugs and Dashboard are mock/not persisted | **Mostly verified; screen-by-screen trace still required** | `src/App.tsx:18,416,421,534-535` imports mock data, initializes product/sale state locally, and adds completed sales with `setCompletedSales`. `POSBillingView` receives products and emits `onSaleComplete`; ledger, cashbook, controlled-drug, reports/dashboard are passed app-owned values. No `complete_sale`/`post_sale` RPC exists in local SQL. Products/Stock Inventory are separately server-backed. Exact per-screen persistence must be traced while implementing W4. |
| D2: about 65 unused-symbol errors if noUnused flags are enabled | **Unverified; do not rely on old measurement** | `tsconfig.json:1-29` has neither flag. No build/lint-with-flags was run for this plan. W6 will turn the flags on and fix the measured compiler diagnostics rather than assume 65. |
| D3: dead `POSScreen.tsx`, `RepositoryReviewView.tsx` | **Partly wrong** | `POSScreen` has only its own declaration/props in `src/components/POSScreen.tsx:40-48` and no other source reference was found; it is a dead-file candidate. `RepositoryReviewView` is imported by `src/App.tsx:35` and therefore is **not confirmed dead**. Do not delete it without checking whether the route is intentionally retained. |
| D4: three explicit `any` uses | **Verified** | Explicit type annotations are at `src/data/mockPharmacyData.ts:351`, `src/components/DashboardView.tsx:26`, and `src/components/POSScreen.tsx:155`. Replace with proper types; also run a full search during W6. |
| D5: no ESLint config | **Verified in checkout** | No flat config or legacy ESLint config was found. `package.json:13` only runs TypeScript checking. |
| D6: main JS chunk about 1 MB | **Unverified** | No production build/bundle analysis was run for this planning task. W7 will record the real baseline before changing chunk strategy; the 200 kB gzip target must be measured, not asserted. |
| W1 lockdown A-D | **Files written; live application unknown** | A: `20261012140000_lockdown_anon_public_access.sql:3-8` revokes anon access and changes `postgres` defaults. B: `20261012140500_optional_lockdown_supabase_admin_defaults.sql:3-8` is explicitly optional and may fail without role membership. C: `20261012141000_revoke_authenticated_table_dml.sql:3-14`, `20261012142000_supplier_write_rpcs.sql:3-119`, and `20261012143000_revoke_authenticated_supplier_dml.sql:3-5` cover listed DML and supplier RPC migration. D: `20261012144000_lockdown_profile_dml.sql:3-6` revokes profile DML. Matching rollback scripts exist in `supabase/rollback/` for this group. `docs/DATABASE.md` §“ACL lockdown proposal” labels the ACL set a proposal/files-only, not applied. The current live ACL needs SELECT-only verification; never assume it matches. |
| W2 multi-shop | **Missing** | No `shops` table, `shop_id` column or tenant-scoping implementation was found in the baseline/migrations/source. Existing `is_admin()` / `has_any_permission()` semantics include `super_admin` (latest local override migration `20261008220000...sql:3-32`). |
| W3 stock alerts | **Missing as a per-shop feature** | Dashboard has local near-expiry/expired display but there is no stock-alert RPC, `stock_alerts` permission, persistent unseen state, 60-second poll, or real alert bell panel. `Sidebar.tsx` has a bell icon for “My print requests”, not stock-alert notifications. |
| W4 persistence and `complete_sale` | **Missing** | No `complete_sale` or `post_sale` definition is present in migrations. `post_purchase` exists, but it is not a sale-posting RPC. App-level sale state is local, as shown above; no `src/data/` server repositories for the requested six domains are wired end-to-end. FEFO helper exists client-side, not as an atomic sale transaction. |
| W5 barcode — validation, print and assignment | **Partly implemented; not fully production-verified** | `src/utils/labelUtils.ts:1-48` validates supported formats; `src/components/labels/BarcodeRenderer.tsx:1-65` renders/guards; `LabelPrintDialog.tsx:1-250` supports preview, 30×20/50×30/58×40/A4, fields (no cost field), and 1–20 copies per selected product (`:53-68,195`). `InventoryScreen.tsx:792-858,979-1015,1119-1128` has a per-row Generate action for empty medicine barcodes, bulk missing assignment, and toolbar print for selected/current visible products. `20261012180000_assign_medicine_barcodes.sql:3-10,41-209` has EAN-13 sequence/RPCs, active-profile + `products` permission checks (`:61-64,164-167`), and audit rows (`:98-107,129-138`); it writes `medicines.barcode`, not `medicine_units.barcode`. `20261012181000_medicines_barcode_unique_index.sql:1-10` only adds a **global** unique index on `medicines.barcode`, not cross-table uniqueness and not shop-scoped. Neither migration grants or reads cost tables; the assignment RPC writes the barcode value to audit details. Owner reported running barcode migrations in a prior turn, but this session did not query the DB: live status is **owner-reported, not independently verified**. Existing migration rollback files are in `supabase/migrations/`, unlike the requested `supabase/rollback/` convention. |
| W5 barcode — scanning/buttons/hardware | **Partly implemented; critical gaps remain** | `src/utils/useBarcodeScanner.ts:9-27,29-110` captures keyboard keydown bursts; `src/components/POSBillingView.tsx:111,287-315,538-575` enables POS Barcode mode, matches local product `barcode` or `code`, and adds it. It does not query server/shop scope, match unit barcodes, strip scanner prefix/suffix, handle duplicate matches explicitly, or wire Products search/barcode editor to scanner capture. Not-found is reported, but no create-product offer. Products has Edit in a row action menu (`InventoryScreen.tsx:1244-1248`), Generate in the barcode column when empty (`:1001-1015`), and toolbar Print barcodes (`:1119`). It does **not** show the required always-present row/card/detail Edit + Print barcode + Make barcode trio. Real scanner/printer testing has not been performed. |
| W6 code quality | **Missing / baseline not measured** | No `noUnusedLocals`, `noUnusedParameters`, ESLint flat config, or `lint:eslint` script. Explicit `any` findings above. `RepositoryReviewView` is referenced; only remove files proven unused by import, route, and component-name search. |
| W7 performance/hygiene | **Partly implemented / mostly missing or unverified** | Some XLSX imports are dynamic, but Purchase History imports XLSX statically. `jsbarcode` is statically imported by label components. No QR library is installed. Route-level `React.lazy` was not found. Google Fonts link uses `display=swap` in `index.html`; one receipt font is self-hosted. No `noscript` content was found. `.gitignore` and initial gzip size need explicit audit/build measurement. `docs/ARCHITECTURE.md` does not exist. |

### Current screen and feature boundary

- **DB-backed:** Products uses `products_list`, `products_overview_stats`, import/bulk RPCs and fetches units; Stock Inventory consumes server RPCs. Purchases/Purchase History use purchase RPCs according to the checked-in migrations.
- **Local/demo state:** the app shell initializes domain state from `mockPharmacyData` and holds sales in React state; screens consuming these props are not durable across reloads until W4 replaces the store and write paths.
- **Unknown until staging checks:** whether any local migrations have been applied to a particular Supabase project; whether scanner/printer output meets hardware requirements; the actual bundle size and latent unused-symbol count.

## B. Approved decisions and remaining gates

1. **Shared tenancy:** one Supabase project with `shop_id` on all shop-owned data. Medicines, categories, brands, suppliers, customers, sales, stock, purchases, settings, and print requests are shop-owned. Require two-shop isolation tests and staging acceptance.
2. **Platform role:** `super_admin` is platform-only for account metadata, Shops page, and Details. Shop 1 belongs to the owner-designated existing admin account. The super-admin login will not operate shop pages.
3. **Helper/RLS change gate:** the current helper behavior and proposed platform-only behavior are compared in C.2. Before implementation changes RLS or `is_staff`, `is_admin`, or `has_any_permission`, show the exact current and replacement definitions and obtain the owner's approval. The approved role outcome does not waive this review.
4. **Barcode invariant:** unique within a shop across both medicine and medicine-unit barcodes; different shops may reuse a value. Replace the current global `medicines.barcode` index with the shared registry only after staging catalog review and duplicate inventory. Do not ask the owner to apply the two legacy barcode migrations to the current project.
5. **Expiry boundary:** approved sellable-through-expiry rule is `expiry_date >= current_date`, with positive quantity, `ACTIVE`/`NEAR_EXPIRY`, and active medicine. Reconcile every client, test, document, and server SQL predicate.
6. **Quality scope:** keep `strict` off in the main package. Measure each of `noUnusedLocals`, `noUnusedParameters`, and `strict` separately; add unused checks and `react-hooks` ESLint first. Decide on strict in its own final package based on measured diagnostics.
7. **Barcode UI and print limits:** after the staging checkpoint, prioritize client-side W5. Each product row/card has Edit, Print barcode with per-product label quantity, and Make barcode. Include scanner test and POS/Products search scanning. Limit 200 labels per product and 1,000 per print job.
8. **QR and Express:** QR is out of scope. Remove `express` or `@types/express` only after repository usage is confirmed absent.
9. **Staging gate:** bootstrap a separate staging project and return CURRENT/STAGING SELECT-only catalog results as documented in [STAGING_BOOTSTRAP.md](./STAGING_BOOTSTRAP.md). Do not write a multi-shop migration until the results are reviewed.
10. **Open measurement:** unused-symbol counts and production bundle/gzip size are not measured. W6/W7 use actual output rather than historical estimates.

## C. Work items W1–W7

### C.1 W1 — Security prerequisites and lockdown status

**Files already written locally:** `20261012140000_lockdown_anon_public_access.sql` (A); optional `20261012140500_optional_lockdown_supabase_admin_defaults.sql` (B); `20261012141000_revoke_authenticated_table_dml.sql`, `20261012142000_supplier_write_rpcs.sql`, and `20261012143000_revoke_authenticated_supplier_dml.sql` (C); `20261012144000_lockdown_profile_dml.sql` (D). Rollbacks are in `supabase/rollback/`. They are proposals/files, not proof of live application. The optional `supabase_admin` statements are kept separate because owner docs warn that the SQL role may lack role membership.

**Plan:** compare the target staging project's grants/default privileges to the intended A-D state using SELECT-only catalog checks; verify supplier writes call `save_supplier` / `deactivate_supplier`; preserve the five cost-bearing table revokes; keep `profiles` authenticated SELECT if the app requires it while revoking client DML. Do not touch RLS policies or the three protected helper functions until the B approval is recorded. Any missing ACL behavior gets a new forward migration and matching rollback in `supabase/rollback/`, not a live manual patch.

### C.2 W2 — Shared-database multi-shop tenancy

**Proposed schema and ownership model**

- Add `public.shops` with immutable UUID, display name, status, created timestamp, owner admin profile, creator profile, and an immutable short barcode prefix. Restrict full shop metadata to active platform super_admin; tenant users get only their own shop context through permission-checked functions.
- Add nullable `shop_id` to tenant-owned relations, backfill, validate, then set NOT NULL where each row must belong to a shop. `profiles.shop_id` is nullable only for platform super_admin; each active shop admin/staff profile has exactly one shop.
- `current_shop_id()` returns an active caller's shop or NULL for platform super_admin; `is_platform_admin()` recognizes only an active non-deleted `super_admin`. Both are fixed-search-path helpers; caller must never supply an arbitrary shop id and get authority from it.
- Existing admin profile becomes Shop 1 owner. All existing business rows become Shop 1. Existing platform super_admin remains `shop_id = NULL`; it sees shop/account metadata only. No business rows are copied to the platform account.
- Shop name and receipt identity are stored in one server-backed shop profile. Only platform super_admin can edit identity; tenant users may read only their own profile. Existing browser-local identity fields cease to be authoritative. The logo remains; replace fixed header text with the configured shop name while keeping the WhatsApp Reminders feature.
- A separate Super Admin catalog-seeding operation may create products/suppliers in one explicitly selected shop. It must be narrowly write-scoped and audited; it grants no general shop business read/edit access. Default initial scope is create-only; any broader operation needs separate approval.

**Table inventory (current relations; all rows are one-shop-owned unless marked platform/global)**

| Relation(s) | Target ownership and enforcement |
|---|---|
| `shops` (new) | Platform metadata table. Platform-only policies/RPCs; no general business data access for super_admin. Separate, logged catalog-seeding operations may write only to an explicitly selected shop. |
| `profiles` | Shop staff rows carry `shop_id`; super_admin rows have NULL. Self/profile list policies constrain staff to current shop. Platform list is limited to account metadata needed by Shops page. |
| `customers`, `khata_entries` | Shop-owned. `khata_entries` must agree with the referenced customer and sale shop; enforce by constraints and checked RPCs, not merely client-supplied shop id. |
| `suppliers`, `supplier_ledger` | Shop-owned; ledger references a supplier in the same shop. |
| `categories`, `brands` | Shop-owned in this proposal, seeded from existing values for Shop 1; CRUD/import RPCs scope writes and reads by caller shop. |
| `medicines`, `medicine_units` | Shop-owned and parent/child shop consistency enforced. `code` unique per shop. Barcode values use a central per-shop registry so medicine and unit values cannot collide with each other. |
| `stock_batches`, `stock_movements` | Shop-owned via batch and medicine relationships; both parent IDs must resolve inside caller shop. Preserve complete revocation of direct cost-bearing table grants. |
| `purchases`, `purchase_items` | Shop-owned; purchase, supplier, item medicine/unit, and batch must all resolve to same shop. |
| `sales`, `sale_items`, `sale_item_batch_allocations`, `sale_payments` | Shop-owned; allocations and batch/medicine references are constrained to same shop. All sale posting is transactional. |
| `purchase_number_state` | One counter row per shop; primary/unique key includes `shop_id`. |
| `audit_logs`, `print_requests` | Rows carry `shop_id` for tenant events/requests. Platform user-management events are account metadata and must not contain business detail. Preserve existing requester/approver authorization within shop. |
| `medicine_barcode_seq` / future barcode registry | Replace single global sequence assumptions with per-shop counter and one unique normalized barcode registry key per shop. |
| W4 cashbook/expense and controlled-drug records; W3 alert-seen state (new if absent) | Shop-scoped with explicit least-privilege grants and RLS; per-user seen state belongs to a profile in that same shop. Verify existing schema before creating any of these rather than duplicating an existing table. |

**Uniqueness and numbering changes:** replace global keys with shop-scoped constraints: `(shop_id, medicines.code)`; `(shop_id, normalized barcode)` in a single registry spanning medicine and unit barcodes; normalized supplier/category/brand names per shop where existing product rules require name uniqueness; batch number scoped at least by `(shop_id, medicine_id, batch_number)` unless the verified schema/business rule requires a broader key; `(shop_id, invoice_number)` for sales; and `(shop_id, purchase_number)` with a per-shop purchase counter. Invoice, memo, and purchase numbering must be sequential and unique per shop. Do not promise gap-free numbering unless concurrency, rollback, retry, and failure tests prove it. Preserve UUID primary keys. Audit every existing unique constraint/index before replacing it.

**Every existing RLS policy:** inventory policies from `supabase/baseline/00_baseline_schema.sql` and all added policies in migrations. For each policy on a tenant table, add the same-shop predicate to both `USING` and `WITH CHECK` where applicable, while preserving permission predicates; scope joins through the row's parent when a direct `shop_id` is not present. Platform super_admin gets no policy path to tenant rows. On `shops` and metadata RPCs, super_admin can list only shop/admin metadata. Create a tested table→policy inventory before touching policies. No policy is dropped or widened casually.

**Every SECURITY DEFINER function:** inventory function declarations in the baseline and migration tree and classify into:

- `has_any_permission`, `is_admin`, `is_staff`: protected helper changes gated by B.1 approval; see exact behavior comparison below.
- Product/catalog and cost policy: `can_view_cost`, `save_medicine`, `products_overview_stats`, `products_list`, `products_import_preview`, `products_bulk_update`, `products_bulk_import`, `save_category`, `delete_category`, `save_brand`, `delete_brand`. Filter reads by `current_shop_id()`; constrain every target row and referenced category/brand; insert `shop_id` server-side; retain role/permission cost redaction.
- Stock: `adjust_stock`, `stock_overview_stats`, `stock_batches_list`, `stock_expiry_buckets`, `stock_adjustments_log`, `write_off_expired_batch`. Check batch and medicine belong to current shop; cost output stays permission-redacted; preserve direct table revokes.
- Purchasing: `post_purchase`, `purchase_catalog`, `purchase_history`, `purchase_detail`, `void_purchase`. Shop-scope suppliers, lines, counter, batches, ledger and audit atomically.
- Supplier: `save_supplier`, `deactivate_supplier`; shop-scope target and insert, prevent cross-shop id access.
- Print: `request_print`, `decide_print_request`, `pending_print_count`, `mark_printed_request`, `list_print_requests`, `modify_print_request`; enforce requester/reviewer within caller shop, and platform super_admin gets no receipt/business snapshot access.
- Trash/audit: `capture_trash_bin_event`, `trash_bin_events_list`, `restore_trash_supplier`, `restore_trash_medicine`; trigger derives tenant from row, listing/restoration filters tenant.
- Barcode: `ean13_check_digit` remains a pure format helper; `assign_medicine_barcode` and `assign_missing_barcodes` validate current shop, lock/check barcode registry and write audit without exposing cost.
- New sale/alert/shop APIs listed below. No current sale RPC, stock-alert RPC, or Shops RPC was found.

For every function retain `SECURITY DEFINER` only where required, fixed `search_path = public`, active/non-deleted caller validation, explicit permission test, server-derived shop scope, restricted EXECUTE grants, and transactional writes. Do not grant direct access to cost tables. Every RPC used by the UI has a negative cross-shop test.

**Protected helpers — current behavior versus proposed behavior (approval gate):**

| Helper | Current checked-in behavior | Proposed tenant behavior |
|---|---|---|
| `is_admin()` | Returns true for active `admin` **or** `super_admin` (`20261008220000...sql:3-15`). | Shop-admin predicate only; super_admin must use the separate `is_platform_admin()`. |
| `has_any_permission(perms)` | Returns true for active `admin`/`super_admin` or a profile with any matching permission (`20261008220000...sql:17-31`). | Shop admins get shop-level admin permission, staff require requested permission; super_admin receives no business permission bypass. Separate platform metadata APIs check `is_platform_admin()`. |
| `is_staff()` | True for any active non-deleted profile (`supabase/baseline/00_baseline_schema.sql:307-321`). | True only for active shop staff in the current shop (or remain a generic active-profile test and introduce a new shop helper; choose during implementation after call-site inventory). Never use it alone to authorize cross-shop reads. |

**Edge function and UI:** `supabase/functions/manage-users/index.ts` uses elevated server credentials, so every operation must explicitly apply role rules and shop scope. Super_admin may create a shop and its first admin, see only shop/staff metadata, and cannot access business APIs except the separate audited target-shop catalog-seeding write. Shop admin may add/edit/deactivate only non-admin staff in their own shop and may not create another admin. Add Shops page and Details panel with requested shop/admin metadata, status, creator/time, last sign-in, staff totals split by status, staff list, and recent user-management audit. User list/detail and add/edit forms must send no trusted shop id; server derives it.

Shop plus Admin creation crosses the Auth and Postgres systems and is not atomic. Provision in explicit steps using a durable operation ID: create pending shop; create Auth identity through the server Admin API; transactionally create/link profile and initial settings and mark complete. On failure, compensate in reverse order, surface compensation failures, permit safe idempotent retry, and run an orphan cleanup check for incomplete shops/Auth identities. Never report success while either system is inconsistent.

**Permission defaults:** shop Admins keep all shop modules for their own shop. Add selectable `settings` access for staff roles alongside the approved `stock_alerts` permission; staff permissions are server-validated and the actual `profiles.permissions` CHECK must be inspected on staging and widened for approved keys with a rollback. Settings access permits approved operational settings only; shop identity remains Super Admin-only. `super_admin` has no general shop-module bypass or business permission grant; platform management is role-gated by dedicated metadata APIs rather than a shop permission key. This owner-approved rule replaces the former conflicting Admin/Settings permission design.

### C.3 W3 — Stock alerts

- Add `stock_alerts` and staff-selectable `settings` permission keys: widen the actual `profiles.permissions` check constraint in a migration and update TypeScript validators and user forms. Shop Admin retains all own-shop modules; staff retain their role/configured module permissions, with alerts and Settings individually grantable; platform super_admin receives no shop permissions.
- New RPC signature proposal: `stock_alerts_list()` returns shop-filtered typed records containing medicine ID/name/code, category, stock state, relevant quantity/expiry, alert type and stable alert key; never cost, margin, profit, or batch cost.
- Alert classes: out-of-stock active products; low stock below reorder threshold; stock expiring in 30/90 days; expired stock remaining. Use the same server sellable/expiry semantics as stock inventory.
- Add a real header bell, unread badge and accessible panel; poll on a 60-second interval with in-flight cancellation and clear error state. Persist per-user seen alert keys/last-seen timestamp (not full notification history) to avoid an event-history table until history/audit requirements justify one.
- Row links navigate to existing Products/Stock Inventory with medicine filter and tenant scoping.
- Email/SMS/WhatsApp push is out of scope; later requires verified contacts/consent, provider credentials kept server-side, delivery retries/idempotency, opt-out, template/privacy review, audit and cost controls. Do not put provider secrets in client code.

### C.4 W4 — Persistence and POS sale posting

- Build typed `src/data/` repositories for products, customers, sales, customer ledger, cashbook/expenses and controlled-drug records. Reuse `fetchAllSupabaseRows` and `getSupabaseErrorMessage`; no success-shaped mock fallback in a configured production app. If offline demo fallback remains for local development, make the mode explicit and show “Offline demo data”.
- New RPC signature proposal: `complete_sale(p_customer_id uuid, p_items jsonb, p_tenders jsonb, p_discount_mode text, p_discount_paisa bigint, p_discount_percent numeric, p_idempotency_key uuid) returns jsonb`. Server derives actor, role and shop; validates the selected discount input, rejects malformed/duplicate item/tender shapes and replay conflicts; returns persisted sale id, per-shop invoice number, totals, and safe receipt snapshot. All monetary JSON fields and persisted values are integer paisa.
- In one DB transaction: lock eligible stock rows; validate active product/unit/shop; allocate across FEFO batches with `quantity_remaining > 0`, eligible status and agreed expiry boundary; prevent oversell; validate role percent cap and Rs 200 hard maximum; validate explicit split tender totals and reject cash underpayment; enforce customer credit limit; decrement stock; persist sale, sale lines, payment rows, per-batch cost snapshots, movements and audit; reserve a sequential, unique per-shop invoice number. No partial sale. Do not promise gap-free numbering unless concurrency, rollback, retry, and failure tests prove it.
- Save a safe server-backed shop-identity snapshot with each completed sale so later profile edits do not rewrite historical receipts. New receipts use the current server-backed shop profile; browser-local shop identity is not authoritative.
- Do not return batch cost/cost snapshot to cashier clients. Returns/voids need permission-checked RPCs and safe return-price/cost handling; cashier UI/API must not expose cost.
- Wire POSBillingView, Sales History (locate actual view in App before editing), Customer Ledger, Cash Book, Dashboard and Reports to shop-scoped repositories/RPCs and persist mutations so reload reconstructs the same records. Products and Stock Inventory stay on their existing RPC path with added tenant filters.

### C.5 W5 — Barcode, labels and scanner

**What exists now:** validation/format helper and visible invalid-value state; EAN-13 sequence assignment to medicine rows; permission-checked single/bulk assignment; product table/card control, Edit row action, label print dialog, shared per-product copies 1–20 and bulk selected/current-page print. Labels expose name, strength, generic, expiry and MRP fields; there is no cost/profit/margin field. These are source facts, not live deployment/hardware verification.

**Security/uniqueness corrections:** review both existing migrations before any shop migration. The assignment migration checks active/non-deleted profile + `products`, uses `SECURITY DEFINER SET search_path=public`, writes an audit record, and does not read/grant cost tables. It nevertheless targets only `medicines`, permits arbitrary non-13-digit custom text, and its collision check is not atomic under concurrent requests. The unique-index migration is a global, medicine-only uniqueness rule; it cannot prevent duplicate barcode values in `medicine_units`. Neither migration is shop-aware. After shops are backfilled, replace the global index with a per-shop barcode registry spanning medicine and units; serialize allocation/claim through a registry row/unique key in the same transaction. Keep manufacturer codes unchanged; reject duplicates clearly rather than overwrite.

**Barcode RPC proposals:**

- Keep a compatibility wrapper for `assign_medicine_barcode(p_medicine_id uuid, p_barcode text default null, p_replace boolean default false) returns text`, but scope the target to current shop and claim generated/manual values in the registry.
- Add unit counterpart `assign_medicine_unit_barcode(p_medicine_unit_id uuid, p_barcode text default null, p_replace boolean default false) returns text`.
- Keep/update bulk RPC `assign_missing_barcodes(p_medicine_ids uuid[]) returns jsonb` to work in one request, same-shop only, preserve existing values, and report assigned/skipped/failed without swallowing systemic errors.
- Proposed server-generated Code128 internal barcode: `PC` + immutable shop prefix + `-` + nine-digit shop-local sequence (example shape `PCS01-000000001`); keep counter per shop, collision-check/claim across both barcode target types. Manual values use same validation and registry. Do not call it a GS1 retail code.

**UI and scanner:**

- Every product row and card gets visible Edit, Print barcode and Make barcode actions; detail form retains edit and unit barcode fields. Print is disabled with explanation when no barcode exists; Make is available only when empty (manual custom value through permission-checked RPC/form).
- Per-product print action opens the existing dialog with product label count, label size, live preview and print. Retain bulk print; allow an independent count per product, capped at 200 labels per product and 1,000 labels per job with explicit validation. Include only name, strength, MRP and barcode by default; no cost fields ever.
- Extend scanner parsing to detect fast burst plus Enter, remove configured symbology prefix/suffix safely, expose raw text/length/timing in Scanner Test, and handle the POS search input, Products search and medicine/unit barcode form. Server lookup RPC resolves barcode across both tables inside current shop. A unique match selects product/unit; zero matches offers authorized product creation; multiple matches show a non-destructive ambiguity error and never add an arbitrary item.
- The current POS hook is a local keyboard listener and matches passed medicine barcode/code only; real scanner and printer manual acceptance remains outstanding.

**Manual hardware checklist (must report “not verified” until owner tests):** test at least one scanner’s normal scan, rapid repeated scans, configured prefix/suffix, Enter and focus behavior in POS/Product search/form, unknown barcode, duplicate/ambiguous scenario, leading zero, and unit barcode. Print each supported label size and A4 on intended printer/media; verify actual physical dimensions, quiet zones/bar width, sharpness/readability, alignment, cut/gap and copies; scan printed labels back into POS; verify no cost/profit/margin appears.

### C.6 W6 — Code quality

- Measure `noUnusedLocals`, `noUnusedParameters`, and `strict` separately. Enable the unused checks in this package; keep `strict` disabled here and decide whether to enable it in a separate final package only if the measured diagnostics are manageable. Fix genuine unused symbols, not by broad suppressions.
- Add ESLint flat config with TypeScript parser/plugin, `react-hooks/rules-of-hooks`, and `react-hooks/exhaustive-deps`; add `lint:eslint` and chain into `lint`. Keep `npm test`, every existing `test:*` script and exports functioning.
- Replace explicit `any` with accurate domain types/unknown guards. Confirm dead files by searching file path, export/component identifier, imports, route switches and lazy-loader references. `POSScreen.tsx` is a confirmed candidate; `RepositoryReviewView.tsx` is currently imported and must not be deleted unless its route use is separately removed intentionally.

### C.7 W7 — Performance and hygiene

- Capture a clean production build’s raw and gzip sizes first. Add dynamic imports for heavy features actually used (`@e965/xlsx`, `jsbarcode`, `@google/genai`); preserve lazy failure reporting. No qrcode dependency currently exists—do not add an unused library unless owner confirms an actual QR feature.
- Apply `React.lazy`/`Suspense` to heavy screen boundaries and configure Vite manual chunks only after bundle analysis; measure whether initial JS is at or below ~200 kB gzip and eliminate the >500 kB warning where practical without fragile over-splitting.
- Preserve self-hosted fonts where available; keep `font-display: swap`; add concise `<noscript>` text; verify `.gitignore` excludes `node_modules`, `dist`, `.env`, `.env.*` but not `.env.example`.
- Add `docs/ARCHITECTURE.md` describing actual DB-backed surfaces, RPC responsibilities, shop model, permission rules, and where offline demo data is permitted.

## D. Security test plan

All authorization tests run on staging after the owner applies the approved migration sequence. Do not run the checks against production during implementation. Query checks are SELECT-only and must never expose sensitive values.

### D.1 Isolation matrix

Create Shop A and Shop B with separate admins and staff; also use the platform super_admin. Seed sentinel IDs/names per shop. For every table below, test authenticated list/detail/search/export and attempted writes/updates/deactivations using the other shop's UUID. Verify zero cross-shop rows and zero side effects. Verify super_admin cannot read business rows but can read only shop/staff account metadata.

| Table family | A admin/staff | B admin/staff | super_admin |
|---|---|---|---|
| profiles / shops | Own staff/own shop; no B or platform secrets | Own staff/own shop; no A | Shop/account metadata only; no business relations |
| customers / khata_entries | Own rows and linked same-shop references only | Own rows and linked same-shop references only | No rows |
| suppliers / supplier_ledger | Own rows; RPC mutation own shop only | Own rows; RPC mutation own shop only | No rows |
| categories / brands / medicines / medicine_units | Own catalog only; parent-child enforced | Own catalog only | No rows |
| stock_batches / stock_movements | Own shop via authorized RPC; no direct cost-bearing table access | Same | No rows |
| purchases / purchase_items / purchase_number_state | Own purchase, supplier, batches, counters | Own only | No rows |
| sales / sale_items / sale_item_batch_allocations / sale_payments | Own records and allocations | Own records and allocations | No rows |
| audit_logs / print_requests | Own business/request events; roles constrained | Own events | Only safe user-management metadata for Shops details |
| barcode registry / alert state (new) | Own shop keys and per-user state | Own shop keys and per-user state | No barcode or business alert values |

Also test RLS-enabled and RPC-only paths; direct PostgREST reads must fail or return only permitted rows. A forged `shop_id` parameter must not change server-derived tenancy.

### D.2 RPC and Edge Function negative tests

Test all existing SECURITY DEFINER functions discovered in baseline/migrations, not just new ones: product/catalog RPCs; stock list/adjust/write-off RPCs; `post_purchase` and purchase catalog/history/detail/void; supplier save/deactivate; print request/list/decision/count/mark/modify; Trash Bin list/restore and trigger behavior; barcode assignment/bulk; new `complete_sale`, stock alerts, Shops metadata and user management. For each, test unauthenticated, inactive/deleted profile, missing permission, cross-shop IDs, wrong role, duplicate/replay/idempotency, and normal authorized path. Confirm every multi-row mutation rolls back entirely on a forced invalid line. Test `manage-users` Edge Function with super_admin creating admin+shop, admin creating staff only within own shop, admin trying create admin, and cross-shop profile IDs. Check audit attribution and ensure no service-role key reaches the browser bundle.

### D.3 Cost confidentiality tests

- Cashier: API/RPC response schemas for Products, POS, sales, receipts, labels, reports, imports/exports, alerts, and Edge Function must contain no cost price, batch cost, profit, margin, or cost-derived totals.
- Manager/accountant/admin: compare returned cost to existing role/permission decision; cashier-denied values are omitted/null, never zero-filled.
- Ensure `stock_batches`, `purchases`, `purchase_items`, `sale_items`, `sale_item_batch_allocations` remain ungranted to `anon` and `authenticated`; test only privilege metadata, never select cost data.
- Labels and generated HTML/SVG/export snapshots are scanned for cost/profit/margin field names and values. Keep Pharmacy Memo renderer unchanged except for any separately approved necessary wiring.

### D.4 SELECT-only staging checks and manual checks

The following are **planned staging checks only**. They were not executed. They inspect metadata or identifiers; do not use `UPDATE`, `DELETE`, DDL, or data-returning queries on protected cost tables in this checklist.

Function signatures:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;
```

RLS state and policy definitions:

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Index/permission metadata and the permissions constraint:

```sql
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.profiles'::regclass;
```

Barcode duplicate inventory across both target tables (do this before building the registry):

```sql
select barcode, count(*) as occurrences
from (
  select btrim(barcode) as barcode
  from public.medicines
  where barcode is not null and btrim(barcode) <> ''
  union all
  select btrim(barcode) as barcode
  from public.medicine_units
  where barcode is not null and btrim(barcode) <> ''
) codes
group by barcode
having count(*) > 1
order by occurrences desc, barcode;
```

Run equivalent **identifier-only** checks for duplicates by `shop_id` after backfill; do not select cost-bearing columns. Use counts to compare pre/post-backfill row totals and verify every tenant-owned row has exactly one valid shop assignment.

Manual checks: login as each role in both shops; Shops details and staff count accuracy; add/edit/deactivate staff and reject cross-shop/admin creation; alert bell counts/types/seen behavior and 60-second refresh; complete cash/card/split/credit sale, insufficient stock, expiry boundary, discount cap and idempotent retry; reload and verify persistence; customer ledger/cashbook/controlled-drug/report values; each product Edit/Print/Make action in table and cards; barcode scan including product and unit; and the scanner/printer checklist in C.5.

## E. Dependency-ordered execution sequence

Estimated engineering sizes are relative effort, not calendar commitments. Every work package gets one isolated commit on the implementation branch, contains only its own task files, and is checked with `git show --stat` afterward. Run `npm run lint`, `npm test`, and `npm run build` after each applicable code package; repair failures before committing the next package. No push/merge. Each migration gets a matching rollback under `supabase/rollback/`. The barcode client UI/scanner package is already complete. The next work follows the staging comparison → ACL reconciliation → multi-shop migrations and acceptance on staging → production release order.

| Order | Work package | Dependencies / owner action | Estimate | Migration / rollback and acceptance |
|---:|---|---|---|---|
| 0 | Branch and staging bootstrap/catalog comparison | Written approval; implementation branch exists. Owner creates separate staging project, applies only the listed baseline/forward files, and returns SELECT-only results. | M | Catalog inventory/counts for relations, functions/overloads, policies, triggers, grants, indexes and constraints; reconcile CURRENT vs STAGING. No multi-shop migration. Current checkpoint; stop here until results are reviewed. |
| 1 | W1 ACL prerequisites | 0; review CURRENT/STAGING results and reconcile migration history. | M | Add only missing forward/rollback files; optional `supabase_admin` stays separate; preserve cost-table revokes. Owner applies and verifies on staging. |
| 2 | W2 schema foundation and safe Shop 1 backfill | 1; staging ACL reconciliation, backup/restore readiness, and exact helper/RLS changes approved. | XL | Shops/profile/shop_id changes, verified object inventory, counters/constraints and backfill validation; apply on staging; do not enable tenant access until relationships/counts validate. |
| 3 | W2 tenant RLS, RPC and Edge Function isolation | 2; owner applies schema foundation to staging and returns checks. | XL | Shop-aware policies/RPCs/Edge Function with rollback. Two-shop isolation tests are release blockers. |
| 4 | W4 typed data layer and `complete_sale` | 3 | XL | Transactional sale posting, repositories, rollback and FEFO/cost tests; sequential/unique per-shop numbers. |
| 5 | W3 alert permission and alert service | 3 | L | `stock_alerts` and staff `settings` permission constraints, alert RPC/state, bell and user permission UI. |
| 6 | W5 per-shop barcode registry and RPCs | 2 | L–XL | Cross-table per-shop registry and counter; remove the legacy global index only after duplicate/backfill validation; no cost data. |
| 7 | W5 barcode UI/scanner client work | Complete (client-only package already delivered); staging review is the original dependency gate. | Complete | Product row/card actions, per-product label quantities and scanner support are implemented; physical hardware and live RPC/schema behavior remain unverified. |
| 8 | W6 unused checks and ESLint | 4–7 | M–L | Enable unused checks and `react-hooks` ESLint; report separate unused/strict measurements. Keep `strict` disabled in this package. |
| 9 | W7 lazy loading and architecture/hygiene | 8 | L | Measured chunks, dynamic imports, `.gitignore`/noscript/font check, `docs/ARCHITECTURE.md`. |
| 10 | Final strict TypeScript decision | 9 | S–M | Separate measurement and optional enablement only if error count is manageable; otherwise record why deferred. |
| 11 | Consolidated staging security/feature verification | 2–10; owner applies approved migrations to staging and performs physical scanner/printer tests. | L | Two-shop isolation, provisioning compensation, role/Settings, number concurrency, receipt snapshot and hardware verification. No production writes. |
| 12 | Production release | 11; explicit owner go/no-go, verified backup/restore, reviewed migration/rollback sequence. | Owner-controlled | Owner applies/deploys after staging acceptance; capture verification and rollback readiness. No production action by the assistant. |

**Migration run order:** first staging bootstrap and CURRENT/STAGING catalog comparison; then W1 ACL reconciliation; then write/review and owner-apply multi-shop migrations on staging: W2 shop/profile and nullable tenant columns → Shop 1 backfill/inventory validation → scoped keys/counters → tenant policies/functions; W4 sale tables/counter/RPC; W3 `stock_alerts` and `settings` permission constraints/state/RPC; W5 barcode registry/backfill/uniqueness/RPCs; integration migrations. The exact timestamp filenames and SELECT-only verification queries are presented after staging comparison. Do not apply the current global `medicines_barcode_unique` unchanged as the final multi-shop index. After staging acceptance and explicit owner approval, prepare a backed-up production release with matching rollback files.

## F. Risks and open questions

- **Shared database tenancy is high impact.** One missed RLS predicate, SECURITY DEFINER filter, nested foreign-key check, Edge Function guard, export filter or cache key can disclose or corrupt another shop's data. The table/function/policy inventory and two-shop tests are release blockers.
- **Platform account behavior changes:** all existing data becomes Shop 1 owned by the selected existing admin; current super_admin becomes platform-level and loses general access to business data by design. A separate shop admin login is necessary for that person to operate the pharmacy. The only planned business-data exception is a separate audited Super Admin create-only product/supplier seed action targeting one shop.
- **Backfill and rollback:** if existing rows have broken references, inconsistent profile roles, duplicate invoice/barcode identifiers, or null parents, stop before setting NOT NULL or replacing indexes. Take a verified staging backup and preserve row counts/checksums. Rollback must not delete business rows or silently merge shops.
- **Barcode global index:** if the owner has already applied it, it currently prevents different shops sharing the same manufacturer barcode. Replace it only after cross-table/per-shop registry migration, duplicate normalization and index verification are ready. Cross-table unique constraints cannot be solved by two independent unique indexes.
- **Existing database state is unknown:** `docs/DATABASE.md` describes a supplied schema snapshot, not a live connection. Prior owner reports that barcode migrations were run are acknowledged but were not checked here. All migrations must be reconciled against staging first.
- **Protected helper/RLS changes need written approval:** especially changing super_admin's present admin/permission bypass. Show exact before/after and all call sites, get approval, then proceed.
- **Sale accounting details:** define the credit-limit treatment with outstanding sales, returns/void policy, split-tender rounding, sequential/unique counter behavior and concurrency locking, idempotency retention, controlled-drug audit fields, and the final eligible expiry boundary before implementation. Gap-free numbering remains unpromised unless verified by tests.
- **Alert noise/privacy:** define whether expired stock should include inactive products and whether “unseen” is per-user or per-device. Email/SMS/WhatsApp push remains out of scope.
- **Operational checks unavailable in checkout:** live staging/production SQL, Supabase Edge Function deployment, physical scanner behavior, and physical printer output are owner-controlled. Report all as written/not applied/verified until evidence exists.
- **Performance target is aspirational until measured:** ~200 kB initial gzip may require more than chunk configuration and could increase navigation latency. Keep route error boundaries and measure on production build.
- **ESLint strictness may expose more than the historical estimate;** fix genuine errors and avoid broad suppression. `express` dependency disposition and whether QR output is a real product requirement remain open.

**Owner decisions recorded in `MULTI_SHOP_FULL_PLAN.md`:** one user per shop; Super Admin has a separate audited target-shop catalog-seeding exception but no general business-data access; platform-owner business-data access is emergency-only and audited where technically possible; suspension blocks sign-in and business operations; licence/billing dates are deferred; staff may receive Settings permission while shop Admins retain all own-shop modules and cannot edit shop identity.

**Execution gate:** The plan is approved, but implementation remains stopped at staging bootstrap/catalog comparison. Follow `STAGING_BOOTSTRAP.md`: owner builds a separate staging project and returns CURRENT/STAGING SELECT-only results; review and reconcile inventory counts/differences; reconcile ACL prerequisites; then author/review and owner-applies multi-shop migrations on staging; complete two-shop isolation/recovery/concurrency tests; only then prepare production with verified backup and rollback. Do not write multi-shop migrations until staging results are reviewed. Never run SQL or deploy functions on the owner's behalf.
