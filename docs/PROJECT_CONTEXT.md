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

- `src/App.tsx`: app shell, navigation state, demo/mock data and page routing.
- `src/components/POSScreen.tsx`, `POSBillingView.tsx`: POS workflow, cart and completed-sale printing.
- `src/utils/receipt.ts`, `printSnapshot.ts`, `printWorkflow.ts`: Pharmacy Memo rendering, safe print snapshots, and print-request workflow.
- `src/components/SettingsView.tsx`, `TemplatePreviewModal.tsx`: receipt template/paper settings and preview.
- `src/components/InventoryScreen.tsx`, `src/components/inventory/`: Products and Stock Inventory UI, shared inventory UI, and pure logic.
- `src/components/StockPurchaseView.tsx`, `PurchaseHistoryView.tsx`: purchasing and purchase history.
- `src/components/CustomerLedgerScreen.tsx`, `Customers`-related screens in `src/components/`: customer balances, ledger, and payment slips. Some data remains demo/in-memory; inspect the current page before assuming persistence.
- `src/components/ManageUsersView.tsx`, `src/permissions.tsx`, `src/utils/auth.ts`: staff, roles, UI permission checks, and profile/auth helpers.
- Other feature screens in `src/components/` include Dashboard, Reports, Suppliers, Cash Book, Controlled Drugs, Master Data, and print-request administration.
- `src/utils/`, `src/types/`, `src/data/`: reusable logic, TypeScript domain shapes, and mock pharmacy data.
- `supabase/migrations/`, `supabase/functions/`, `supabase/baseline/`: database migrations, Edge Functions, and a supplied schema snapshot.
- `docs/`: database references, redesign progress, and this context.
- `scripts/`, `.githooks/`: context generation and commit-hook tooling.
- `public/`: static assets and fonts.

## Data and storage

- Supabase Auth/Postgres: shared across clients connected to the same configured project. Products, Stock Inventory, and purchase workflows use server RPCs; Suppliers still has direct table reads/writes. Authorization and persistence are not uniform across every screen.
- Supabase Edge Functions: the `manage-users` function exists; print approval workflows also use database RPCs.
- Browser `localStorage`: per-browser/device preferences, saved inventory views, purchase drafts, receipt settings, and other UI settings. These do not synchronize across counters.
- In-memory/mock data: POS sales, customers/ledgers, cash transactions, and controlled-drug logs are initialized from `src/data/mockPharmacyData.ts` in `App.tsx`; these app-state values do not persist or synchronize. The Products and Stock Inventory screens separately load server data.
- Other storage: unknown; no general file/object-storage workflow is established by the checked-in frontend docs.
- Shared production data behavior depends on Supabase deployment and the live schema, which may differ from checked-in migrations.

## Roles and permissions

Role names in `src/types/pharmacy.ts`: `admin`, `super_admin`, `manager`, `cashier`, `accountant`.

Permission keys in `src/permissions.tsx`: `pos`, `products`, `categories`, `suppliers`, `customers`, `sales_history`, `purchase_history`, `purchases`, `expenses`, `stock_inventory`, `reports`, `manage_users`, plus POS print toggles `pos_print_sale` and `pos_print_payment`.

UI defaults: Admin and Super Admin get every module. Manager gets POS, Products, Categories, Suppliers, Customers, Sales History, Purchase History, Purchases, Stock Inventory, and Reports. Cashier gets POS and Customers. Accountant gets Customers, Suppliers, Sales History, Purchase History, Expenses, and Reports. Non-admin permissions can be configured; admin roles use their full defaults. Dashboard/help and personal print requests are available to all in the UI; Settings, Trash Bin, and print-request administration are admin-only. UI checks do not replace database/server authorization.

Cost visibility decision: Admin and Super Admin may view cost; Manager may view it only with at least one of `products`, `stock_inventory`, `purchases`, or `purchase_history`; Accountant may view it read-only through `purchase_history` or `reports`; Cashier never may. There is no Pharmacist role in the current app. The migration implementing this server rule is local and has not been applied.

## Business rules

- Persisted money columns and calculation fields use integer paisa; `sale_items.discount_percent` is numeric.
- Batch sale allocation in `src/utils/fefo.ts` uses FEFO: positive eligible stock only, `ACTIVE`/`NEAR_EXPIRY`, expiry strictly after today, then received date and ID for tie-breaking. It rejects an insufficient allocation rather than returning a partial sale. Server-side enforcement depends on the deployed RPC/schema and must be verified there.
- Do not permit negative stock. Verify the server transaction and constraints as well as frontend allocation before relying on this in production.
- Cost and profit/margin are internal data, not Pharmacy Memo print fields. Receipt rendering displays sale amounts/totals and is styled black on white. Do not add cost, purchase price, profit, or margin to customer-facing slips.
- Cost-bearing base tables stay inaccessible to `anon` and `authenticated`; read cost only through permission-checked RPCs. Do not grant direct `SELECT` on `stock_batches`, because its RLS read policy includes `pos` and exposes all selectable columns to Cashier.
- Pharmacy Memo supports 58mm and 80mm thermal layouts (and A4); black text on white background. Return/payment memo rendering exists, but an end-to-end return workflow is not established.
- Gap-free sequential memo numbering is a desired business rule, but the current checkout does not establish a persisted server-side allocator for Pharmacy Memo numbers: enforcement is **unknown**. Do not promise gap-free numbering until implemented and verified.

## Conventions and decisions

- Keep business logic in reusable pure helpers when practical, with tests alongside the helper.
- Use server RPCs for workflows needing atomic multi-table writes or server-side filtering/authorization; use Supabase directly only where the current code does so intentionally.
- Keep client-facing cost fields nullable/redacted by the server when visibility is denied; never turn unknown cost into zero in UI.
- Date: 2026-10-10 — Inventory lists, statistics, movements, adjustments, and write-offs use stock RPCs to keep paging/filtering and mutations server-side.
- Date: 2026-10-10 — Product data uses server-side list/stat/import RPCs; cost visibility is decided server-side rather than trusted to client hiding.
- Date: 2026-10-12 — Cost access is role-and-permission scoped by `can_view_cost()`; Cashier is always denied, Accountants are read-only, and Manager access requires a relevant module permission. The migration is pending application.
- Date: 2026-10-09 — Pharmacy Memo uses a shared sanitized renderer for 58mm/80mm and A4; template and paper preferences remain browser-local because shared settings storage is not implemented.

## Current status

- **Done:** Products and Master Data redesigns; Stock Inventory UI and server-function consumers; shared receipt renderer, POS printing, and print-request approval workflow. The owner reported Phase 4a migrations were run and verified. `docs/REDESIGN_PROGRESS.md` still labels Phase 4 pending; the newer source and owner report supersede that stale status.
- **In progress:** Purchases and Purchase History use RPCs. The owner reports that 4c's direct-table revokes are applied and verified in the test-data Supabase project. The role-and-permission-scoped `can_view_cost()` migration is local and awaits application.
- **Next:** Reconcile context/docs with live Supabase state when the owner supplies verification; build server-backed POS posting, Sales History, Dashboard/Reports, and POS-safe product catalog as approved.

## Known issues and Later

- Live Supabase schema/RPC availability may lag behind checked-in migrations; verify migration state before diagnosing app behavior.
- Shared settings across counters are not implemented; receipt templates and some preferences are browser-local.
- No end-to-end return workflow or Sales History reprint path; the renderer supports return memos and print-request review separately.
- Direct ESC/POS printer-driver support is not implemented; browser printing uses the browser print dialog.
- Several screens still use mock/in-memory data; identify persistence from the current component before changing it.
- Supplier contact insert/update/deactivation is still performed directly by the browser; consider a permission-checked RPC plan.
- Backend role/permission enforcement, API/RPC integration testing, backup, persistent store details, and printer controls need validation/completion.
- POS, Dashboard, and Reports still use local demo sales/product data that can carry cost and profit values client-side; rebuild those pages around permission-checked RPCs before treating their hidden fields as a security boundary.
- Memo-number sequencing and gap-free guarantees are unknown.

## Changelog

- 2026-10-12 — Audited `src/` for direct Supabase queries to the tables in the direct-access revoke migration; none found. This is a source-only audit and does not verify live database state.
- 2026-10-12 — Added a role-and-permission-scoped `can_view_cost()` migration; direct table revokes remain owned by the already-applied 4c migration. The new migration is not applied.
- 2026-10-10 — Added maintained project context, generator, hook setup, and AI working agreements; `docs/PROJECT_CONTEXT.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `package.json`, `scripts/`, `.githooks/`.

History: Earlier work delivered Products and Master Data redesigns, Pharmacy Memo rendering and print approvals, role/permission UI, and Stock Inventory. See `docs/REDESIGN_PROGRESS.md` and recent Git history for details; that progress document contains some status entries older than the current source.

## Working agreements with the owner

- Keep messages short.
- Large multi-file changes need a plan and the owner's OK first.
- Updating this file never needs permission.
- Keep factual claims grounded in current code/docs; write **unknown** where verification is missing.

<!-- AUTO:START -->
Generated at (UTC): 2026-10-12T08:18:41.905Z
Git branch: security/cost-visibility-permissions

Last 5 commit subjects:
- Tooling: context update script and hook
- Docs: add project context
- feat: rebuild stock inventory page
- style: align inventory pages with design reference
- feat: build categories master data card grid

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
- - `test:master-data`: `tsx --test src/components/masterDataSimilarity.test.ts`
- - `test:print-snapshot`: `tsx --test src/utils/printSnapshot.test.ts`
- - `test:report`: `tsx --test src/utils/salesReport.test.ts`
- - `test:permissions`: `tsx --test src/permissions.test.ts`
- - `test:manage-users-policy`: `tsx --test supabase/functions/manage-users/policy.test.ts`
- - `test`: `npm run test:fefo && npm run test:receipt && npm run test:inventory-ui && npm run test:stock-inventory && npm run test:inventory-products && npm run test:master-data && npm run test:print-snapshot && npm run test:report && npm run test:permissions && npm run test:manage-users-policy`

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
- - `tailwindcss` ^4.3.3 (devDependency)
- - `tsx` ^4.21.0 (devDependency)
- - `typescript` ^7.0.2 (devDependency)
- - `vite` ^8.3.0 (dependency)

src/ tree (maximum two directory levels):
```text
src/
  src/App.tsx
  src/components/
    src/components/CashBookScreen.tsx
    src/components/ControlledDrugScreen.tsx
    src/components/CustomerLedgerScreen.tsx
    src/components/DashboardView.tsx
    src/components/EndOfDayModal.tsx
    src/components/GlowCredit.css
    src/components/GlowCredit.tsx
    src/components/HelpSupportView.tsx
    src/components/inventory/
    src/components/InventoryScreen.tsx
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
    src/components/RepositoryReviewView.tsx
    src/components/SettingsView.tsx
    src/components/Sidebar.tsx
    src/components/StockPurchaseView.tsx
    src/components/SuppliersView.tsx
    src/components/TemplatePreviewModal.tsx
    src/components/TopNav.tsx
    src/components/WhatsAppRemindersView.tsx
  src/config/
    src/config/developer.ts
  src/constants/
    src/constants/brand.ts
  src/data/
    src/data/mockPharmacyData.ts
  src/index.css
  src/main.tsx
  src/permissions.test.ts
  src/permissions.tsx
  src/types/
    src/types/pharmacy.ts
  src/utils/
    src/utils/auth.ts
    src/utils/fefo.test.ts
    src/utils/fefo.ts
    src/utils/fetchAllSupabaseRows.ts
    src/utils/printRequestTypes.ts
    src/utils/printSnapshot.test.ts
    src/utils/printSnapshot.ts
    src/utils/printWorkflow.ts
    src/utils/receipt.test.ts
    src/utils/receipt.ts
    src/utils/salesReport.test.ts
    src/utils/salesReport.ts
    src/utils/storageMigration.ts
    src/utils/storeSettings.ts
    src/utils/supabase.ts
    src/utils/supabaseError.test.ts
    src/utils/supabaseError.ts
```

Test files:
- src/components/inventory/inventoryUiLogic.test.ts
- src/components/inventory/productImportLogic.test.ts
- src/components/inventory/stockInventoryLogic.test.ts
- src/components/masterDataSimilarity.test.ts
- src/permissions.test.ts
- src/utils/fefo.test.ts
- src/utils/printSnapshot.test.ts
- src/utils/receipt.test.ts
- src/utils/salesReport.test.ts
- src/utils/supabaseError.test.ts
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
