# Pharma Care Read-Only Scan Report

**Scan date:** 2026-10-09  
**Scope:** React, TypeScript, Vite, Tailwind, Supabase frontend/functions/migrations and current production build artifacts.  
**Method:** Read-only source/configuration inspection, existing scripts, local Vite login-page smoke check and route entry checks while unauthenticated. No database session or project URL was inspected.

## 1. Summary

**Overall health: 3/10** for a pharmacy system expected to process real transactions. The app compiles, and the focused FEFO/receipt/report test suites pass, but the central point-of-sale, inventory, customer ledger, expenses, analytics and settings workflows mostly operate on demo or browser-local state. The repository does not contain the core pharmacy schema migrations. There are also checkout, permission and misleading-control defects.

| Severity | Count |
|---|---:|
| Critical | 1 |
| High | 3 |
| Medium | 6 |
| Low | 4 |

### Ten most important problems

1. **POS and core pharmacy records are not persisted.** “Completed” sales, stock deductions, customers, ledger entries, expenses, and the displayed reports are React state or sample data; refreshing loses changes. See PCC-001.
2. **Split payment is recorded as cash, and cash underpayment is not rejected.** See PCC-002.
3. **The role-specific discount ceiling is imported but not enforced.** See PCC-003.
4. **The repository lacks the core medicines, sales, customers, ledger, and expense schema/migrations.** Purchase SQL depends on pre-existing base tables. See PCC-004.
5. **An Admin with no explicit module permissions cannot access ordinary modules**, despite the requested “Admin = everything” matrix. See PCC-005.
6. **Categories/brands/units are hardcoded and temporary; several Edit/Delete/View controls have no handlers.** See PCC-006.
7. **Quotation, quotation search, barcode, cart-layout, and advertised F2/F4 controls do not implement the named behavior.** See PCC-007.
8. **Settings reports success after persisting only the shop name; other displayed settings are not saved.** See PCC-008.
9. **Dashboard refresh only triggers a rerender; it does not reload data.** See PCC-009.
10. **The production JavaScript is a single 1,013.64 kB minified chunk (289.75 kB gzip).** See PCC-010.

## 2. Safety statement and verification

### Actions performed

- Read source, package/config files, the checked-in SQL migration and Edge Function.
- Ran `npm run lint` (`tsc --noEmit`): **passed**.
- Ran `npm run build`: **passed**. Vite emitted a `__dirname` config-loader warning and a >500 kB chunk warning; build details are in Section 8.
- Ran `npm run test:fefo`: **8 passed**.
- Ran `npm run test:receipt`: **14 passed**.
- Ran `npm run test:report`: **4 passed**.
- Ran `npm test`: **failed because package.json has no `test` script**; this did not install or change packages.
- Ran `npm audit`: **0 vulnerabilities** reported.
- Started the requested local Vite frontend and opened its login route. Captured browser console warnings/errors and failed/HTTP-error requests after reload: **none observed**. The login navigation measured 623 ms in this local run.
- Entered each requested application route and one invalid route directly while unauthenticated. Each resolved to `/login`. No login credentials were entered.
- Checked login horizontal overflow at 1440, 820 and 390 CSS pixels: none observed.
- Searched source for `/api` fetches, active `fetch`/Axios calls, key patterns, unsafe HTML sinks, console logging, old-branding strings, `any`, placeholder language, and dead-looking components/controls. Key-shaped values are never reproduced in this report.
- Security review agent found **no high-confidence exploitable vulnerability** in reviewed source. A JWT-shaped value in the shipped bundle had the `anon` role; no service-role key was found in `src/`, `public/` or `dist/`.

### Deliberately not performed

- No source, configuration, dependency manifest, lockfile, build output or database file was edited by the scan. The only created files are this report and `issues.csv` in `scan-report/`.
- No login, write, purchase, sale, delete, void, restore, password-change, user-management, reminder-send or export controls were executed.
- No Supabase database query, even SELECT, was issued: the project target could not be confirmed as staging. `.env.local` was not read or emitted; no secret, URL, or key is recorded here.
- No migration, SQL write, `supabase db push/reset`, dependency installation, commit or push was performed.
- Full authenticated runtime/role testing was not possible safely: no shared account/session was available and staging could not be established. The browser’s DevTools UI was not opened; page event instrumentation was used for the login reload only.

### Git proof

The worktree was **already dirty before the scan**. The initial status was:

```text
 M index.html
 M package-lock.json
 M package.json
 M src/App.tsx
 M src/components/Sidebar.tsx
 M src/components/TopNav.tsx
 M src/index.css
 M src/permissions.test.ts
 M tsconfig.json
?? src/components/GlowCredit.css
?? src/components/GlowCredit.tsx
?? src/components/HelpSupportView.tsx
?? src/components/PurchaseHistoryView.tsx
?? src/components/StockPurchaseView.tsx
?? src/config/
?? supabase/migrations/
```

Initial `git diff --stat`:

```text
 index.html                 |   2 +-
 package-lock.json          |  13 +++++
 package.json               |   1 +
 src/App.tsx                |  57 ++++-----------------
 src/components/Sidebar.tsx |  39 +++++----------
 src/components/TopNav.tsx  | 121 +++++++++++++++++++++++++++++++++++++++------
 src/index.css              |  27 +---------
 src/permissions.test.ts    |   4 ++
 tsconfig.json              |   1 +
 9 files changed, 148 insertions(+), 117 deletions(-)
```

The same status and diff stat were observed again before report creation, with no scan-created project changes. After creating this report, final verification was run:

```text
 M index.html
 M package-lock.json
 M package.json
 M src/App.tsx
 M src/components/Sidebar.tsx
 M src/components/TopNav.tsx
 M src/index.css
 M src/permissions.test.ts
 M tsconfig.json
?? scan-report/
?? src/components/GlowCredit.css
?? src/components/GlowCredit.tsx
?? src/components/HelpSupportView.tsx
?? src/components/PurchaseHistoryView.tsx
?? src/components/StockPurchaseView.tsx
?? src/config/
?? supabase/migrations/
```

Final `git diff --stat` is identical to the initial stat above. It does not include untracked files; `scan-report/` is the only new untracked project path. All previously dirty paths are preserved.

## 3. Page-by-page inventory

**Runtime notation:** all authenticated page results below are **not runtime-verified**. Route requests while logged out redirected to `/login`; no evidence about page data, signed-in console/network, theme rendering, user permissions, or mobile layout should be inferred from that redirect.

| Page | Works with real data (Yes/Partly/No) | Broken or fake elements | Console/network errors | Role access OK? | Mobile OK? | Both themes OK? |
|---|---|---|---|---|---|---|
| Dashboard | No | Sample/in-memory totals, no reload; refresh control is a no-op. | Not observed behind login. Login reload: no console warning/error or failed/HTTP-error request. | Not runtime-tested. Client guard only; role matrix issue PCC-005. | Not verified. | Not verified. |
| POS Billing | No | In-memory checkout; split/underpayment and discount defects; quotation/barcode/layout/shortcut controls are incomplete. | Not observed behind login. | Not runtime-tested; UI gating does not persist sales. | Not verified. | Not verified. |
| Products | No | Sample products; Add Product fabricates values and changes local state only. | Not observed behind login. | Not runtime-tested. | Not verified. | Not verified. |
| Categories | No | Hardcoded categories, brands, units; additions temporary; Edit/Delete/View buttons lack handlers. | Not observed behind login. | Not runtime-tested. | Not verified. | Not verified. |
| Stock Inventory | No | Same `InventoryScreen` and local sample data as Products; no stock database query. | Not observed behind login. | Not runtime-tested. | Not verified. | Not verified. |
| Customer Ledger | No | Sample customers and entries; customer creation and payment only mutate memory. | Not observed behind login. | Not runtime-tested. | Not verified. | Not verified. |
| WhatsApp Reminders | Partly | WhatsApp deep link is real, but balance/customer records are local samples; send is not delivery-tracked. | Not observed behind login. | Not runtime-tested. | Not verified. | Not verified. |
| Sales History | No | Uses in-memory sales, including seeded demo sale; no persisted query. | Not observed behind login. | Not runtime-tested. | Not verified. | Not verified. |
| Suppliers | Yes, conditional | Supabase CRUD is present; requires configured project, deployed schema and working RLS. | Not observed behind login. | Not runtime-tested; RLS unverified. | Not verified. | Not verified. |
| Purchases | Yes, conditional | Supabase catalog/RPC posting exists; held drafts are local; depends on base schema and purchase migration. | Not observed behind login. | Not runtime-tested; RPC permission checks are present in migration. | Not verified. | Not verified. |
| Purchase History | Yes, conditional | Supabase RPC list/detail/export/void exists; depends on purchase migration and base tables. | Not observed behind login. | Not runtime-tested; RPC permission checks exist; deployed behavior unverified. | Not verified. | Not verified. |
| Expenses | No | Expense entries and cashbook are in-memory; shift close/reconciliation is not persisted. | Not observed behind login. | Not runtime-tested. | Not verified. | Not verified. |
| Business Analytics | No | Renders the same `ReportsScreen` as Sales History, using in-memory sales rather than persisted analytics. | Not observed behind login. | Not runtime-tested. | Not verified. | Not verified. |
| Manage Users | Yes, conditional | Uses Supabase `manage-users` Edge Function; deployment/configuration required. | Not observed behind login. | Not runtime-tested; function checks active Admin/Super Admin server-side. | Not verified. | Not verified. |
| Settings | Partly | Shop name/template persist in browser storage; phone, city, footer and reminder template do not persist. Save status overstates what was saved. | Not observed behind login. | Not runtime-tested; page is client-gated. | Not verified. | Not verified. |
| Trash Bin | Yes, conditional | User restore/list uses Edge Function; only deleted users, not general records. | Not observed behind login. | Not runtime-tested; function checks administrator role. | Not verified. | Not verified. |
| Help & Support | Yes for current static purpose | Static guide and external contact links; no ticketing or Supabase-backed support. | Not observed behind login. | Not runtime-tested; client code grants active users. | Not verified. | Not verified. |

### Route smoke check

`/`, `/pos`, `/products`, `/categories`, `/stock-inventory`, `/customer-ledger`, `/whatsapp-reminders`, `/sales-history`, `/suppliers`, `/purchases`, `/purchase-history`, `/expenses`, `/reports`, `/users`, `/settings`, `/trash-bin`, `/help`, and `/not-a-route` all ended at `/login` in an unauthenticated local browser. This confirms the unauthenticated shell redirect only, **not** route behavior after authentication. There is no custom not-found route; with a valid session, an unknown path is reset to `/` and Dashboard rather than a 404 (PCC-014).

## 4. Button/control inventory

Write-affecting actions below were **code-reviewed only, not executed**. “Local-only” means the handler updates component state or browser storage, not Supabase.

| Page | Control | Expected behaviour | Result | Evidence |
|---|---|---|---|---|
| Dashboard | Refresh summary | Fetch current metrics | **Fake/no-op**; increments unused state. | [DashboardView.tsx:54](../src/components/DashboardView.tsx#L54), [DashboardView.tsx:131](../src/components/DashboardView.tsx#L131) |
| Dashboard | Set target / Save | Store personal daily target | Works in browser storage only; local change not executed. | [DashboardView.tsx:397](../src/components/DashboardView.tsx#L397) |
| Dashboard | Close Day | Persist/close shift and present reconciliation | Opens modal only; source totals are local and close is not persisted. Not executed. | [App.tsx:758](../src/App.tsx#L758), [EndOfDayModal.tsx](../src/components/EndOfDayModal.tsx) |
| POS Billing | Sale / Quotation / Search Quotation / Barcode Scan tabs | Show each distinct mode | **Fake/incomplete**; changes tab state/style, but no associated mode content/flow. | [POSBillingView.tsx:74](../src/components/POSBillingView.tsx#L74), [POSBillingView.tsx:275](../src/components/POSBillingView.tsx#L275) |
| POS Billing | Search/category/brand filters | Filter product catalog | Works only against in-memory sample products. | [POSBillingView.tsx:99](../src/components/POSBillingView.tsx#L99) |
| POS Billing | Product `+` / cart quantity buttons | Add/update cart | Works locally; no Supabase write until none—sale handler also only updates parent memory. Not executed. | [POSBillingView.tsx:118](../src/components/POSBillingView.tsx#L118), [App.tsx:417](../src/App.tsx#L417) |
| POS Billing | 2-Stage / Dock / Side / Quick | Change cart presentation | **Fake**; stored `cartLayout` only changes selected styling. | [POSBillingView.tsx:85](../src/components/POSBillingView.tsx#L85), [POSBillingView.tsx:424](../src/components/POSBillingView.tsx#L424) |
| POS Billing | Discount pills | Apply discount within role allowance | Applies selected percentage, but does not use imported role maximum. | [POSBillingView.tsx:556](../src/components/POSBillingView.tsx#L556) |
| POS Billing | Tendered / Exact / quick cash | Enter cash and compute change | Local calculation only; no underpayment guard at completion. Not executed. | [POSBillingView.tsx:589](../src/components/POSBillingView.tsx#L589), [POSBillingView.tsx:193](../src/components/POSBillingView.tsx#L193) |
| POS Billing | Cash / Online / Credit / Split | Assign tender type correctly | **Broken for Split**; it falls through to Cash; Credit/Online have only local representation. | [POSBillingView.tsx:663](../src/components/POSBillingView.tsx#L663), [POSBillingView.tsx:243](../src/components/POSBillingView.tsx#L243) |
| POS Billing | Charge / F4 | Complete sale after validation | Click opens confirmation; completing is local-only. No F4 key handler found. Not executed. | [POSBillingView.tsx:678](../src/components/POSBillingView.tsx#L678), [POSBillingView.tsx:255](../src/components/POSBillingView.tsx#L255) |
| POS Billing | Product search / F2 | Focus/search catalog | Search input works; no F2 handler found. | [POSBillingView.tsx:337](../src/components/POSBillingView.tsx#L337) |
| POS Billing / Settings | Quick View / Preview template | Open receipt preview | Handler is wired; not opened because signed-in page unavailable. No database writes expected. | [POSBillingView.tsx:318](../src/components/POSBillingView.tsx#L318), [SettingsView.tsx:134](../src/components/SettingsView.tsx#L134) |
| Products / Stock Inventory | Add Product | Create catalog item and valid stock setup | **Local-only demo**; fabricates identifiers, batch and supplier; not executed. | [InventoryScreen.tsx](../src/components/InventoryScreen.tsx) |
| Categories | Add category/brand/unit | Persist master data | **Local-only**; in-memory arrays. Not executed. | [MasterDataView.tsx:44](../src/components/MasterDataView.tsx#L44) |
| Categories | Edit / Delete / View Products | Open editor, delete or navigate | **Dead controls**; no handler. | [MasterDataView.tsx:196](../src/components/MasterDataView.tsx#L196), [MasterDataView.tsx:255](../src/components/MasterDataView.tsx#L255), [MasterDataView.tsx:325](../src/components/MasterDataView.tsx#L325) |
| Customer Ledger | Receive Payment / Add Customer | Update balance and ledger durably | **Local-only** parent state; no database call. Not executed. | [CustomerLedgerScreen.tsx:24](../src/components/CustomerLedgerScreen.tsx#L24), [App.tsx:678](../src/App.tsx#L678) |
| WhatsApp Reminders | Send Reminder | Compose and send through user’s WhatsApp | Opens external `wa.me` URL; no app delivery confirmation. Not executed. | [WhatsAppRemindersView.tsx:18](../src/components/WhatsAppRemindersView.tsx#L18) |
| Suppliers | Add / Edit / Deactivate / Refresh | Supabase supplier CRUD | Direct Supabase operations; not executed. | [SuppliersView.tsx:69](../src/components/SuppliersView.tsx#L69), [SuppliersView.tsx:120](../src/components/SuppliersView.tsx#L120) |
| Purchases | Refresh / Hold draft / Resume | Load catalog or preserve local draft | Refresh queries Supabase; held draft storage is local. No write action executed. | [StockPurchaseView.tsx:141](../src/components/StockPurchaseView.tsx#L141), [StockPurchaseView.tsx:94](../src/components/StockPurchaseView.tsx#L94) |
| Purchases | Save / Post Purchase | Atomically record purchase and stock | Calls `post_purchase` RPC; code-reviewed only, not executed. | [StockPurchaseView.tsx:288](../src/components/StockPurchaseView.tsx#L288) |
| Purchase History | Search/filter/page/detail | Query records | Wired to RPC; not loaded due no authenticated session. | [PurchaseHistoryView.tsx:121](../src/components/PurchaseHistoryView.tsx#L121) |
| Purchase History | Export / Print / Void | Export file / print / reverse posted purchase | Export/print and void are wired; void writes via RPC. Not executed. | [PurchaseHistoryView.tsx:159](../src/components/PurchaseHistoryView.tsx#L159), [PurchaseHistoryView.tsx:215](../src/components/PurchaseHistoryView.tsx#L215), [PurchaseHistoryView.tsx:229](../src/components/PurchaseHistoryView.tsx#L229) |
| Expenses | Record Expense / close shift | Persist expense and reconciliation | Adds an in-memory transaction; no persistent write. Not executed. | [CashBookScreen.tsx](../src/components/CashBookScreen.tsx) |
| Manage Users | Add / Edit / Delete / Change password | Manage real accounts | Supabase Edge Function/Auth writes; code-reviewed only, not executed. | [ManageUsersView.tsx:40](../src/components/ManageUsersView.tsx#L40), [ManageUsersView.tsx:138](../src/components/ManageUsersView.tsx#L138) |
| Settings | Update Profile | Save every displayed preference | **Misleading success**; only shop name callback persists. Other fields are not saved. | [SettingsView.tsx:53](../src/components/SettingsView.tsx#L53) |
| Trash Bin | Restore user | Restore account | Edge Function/Auth write; code-reviewed only, not executed. | [ManageUsersView.tsx:333](../src/components/ManageUsersView.tsx#L333) |
| Help & Support | Call / WhatsApp / Report | Open support contact | External links; report opens WhatsApp; not executed. | [HelpSupportView.tsx:30](../src/components/HelpSupportView.tsx#L30) |
| Header | Theme / UI size / animations | Toggle visual preferences | Wired in browser; persisted locally. Not tested on authenticated shell. | [TopNav.tsx:115](../src/components/TopNav.tsx#L115) |
| Header | Notifications bell | Open notifications | **Fake/inert**; button has no handler and red dot is unconditional. | [TopNav.tsx:196](../src/components/TopNav.tsx#L196) |
| Header | SYSTEM ONLINE | Show backend health | **Misleading**; reflects `navigator.onLine`, not Supabase or app health. | [TopNav.tsx:37](../src/components/TopNav.tsx#L37), [TopNav.tsx:185](../src/components/TopNav.tsx#L185) |

## 5. Issue list

No production screenshot or authenticated console/network excerpt was captured. For signed-in issues, reproduction is by following the listed handler/code path; these actions were not executed.

### PCC-001 — Critical — Core transactions are demo/in-memory, not durable

- **Category/page:** Data integrity; Dashboard, POS, Products, Stock Inventory, Customer Ledger, Sales History, Expenses, Business Analytics.
- **Files/lines:** [App.tsx:311](../src/App.tsx#L311), [App.tsx:316](../src/App.tsx#L316), [App.tsx:417](../src/App.tsx#L417), [App.tsx:652](../src/App.tsx#L652); sample records in [mockPharmacyData.ts](../src/data/mockPharmacyData.ts).
- **Reproduce:** Sign in; complete a sale or add a product/customer/expense; reload or open the app in a new session.
- **Expected:** A posted sale and its stock/ledger/cash movements are durably stored and reload consistently.
- **Actual:** The initial sales/products/customers/ledger/cashbook come from hardcoded sample state; handlers use React setters, not Supabase. Changes disappear on reload, while demo rows can look like real pharmacy records.
- **Evidence:** `INITIAL_PRODUCTS`, `INITIAL_CUSTOMERS`, `INITIAL_LEDGER_ENTRIES`, `INITIAL_CASH_TRANSACTIONS` initialize the primary page data; a `demo-sale-1` is seeded. No sale-related Supabase calls were found in `src/`.
- **Suggested fix:** Replace demo state with Supabase reads under RLS and transactional Postgres RPCs for posting a sale, decrementing FEFO allocations, recording tender/customer ledger/cash movements, and refreshing the relevant views.

### PCC-002 — High — Split tender is mislabeled; cash underpayment is not rejected

- **Category/page:** Bug/Data integrity; POS Billing.
- **Files/lines:** [POSBillingView.tsx:193](../src/components/POSBillingView.tsx#L193), [POSBillingView.tsx:243](../src/components/POSBillingView.tsx#L243), [POSBillingView.tsx:248](../src/components/POSBillingView.tsx#L248), [POSBillingView.tsx:663](../src/components/POSBillingView.tsx#L663), [POSBillingView.tsx:791](../src/components/POSBillingView.tsx#L791).
- **Reproduce:** Add an item; select Split and finish checkout, or select Cash and enter less than the total before completion.
- **Expected:** Split tender records its component tenders; cash checkout blocks insufficient payment.
- **Actual:** `SPLIT` falls through to `PaymentMethod.CASH`; there is no required tender breakdown. No underpayment guard exists in the completion path. A zero tender value is replaced with the total; a non-zero lesser value can be retained.
- **Evidence:** Static path only; completion was not clicked.
- **Suggested fix:** Define an explicit typed tender model and validate paid total against due amount in the database transaction and UI before committing.

### PCC-003 — High — Role discount ceiling is unused

- **Category/page:** Security/business rule; POS Billing.
- **Files/lines:** [POSBillingView.tsx:37](../src/components/POSBillingView.tsx#L37), [POSBillingView.tsx:90](../src/components/POSBillingView.tsx#L90), [POSBillingView.tsx:556](../src/components/POSBillingView.tsx#L556); role caps in [pharmacy.ts](../src/types/pharmacy.ts).
- **Reproduce:** Log in as a role whose configured maximum is below 20%; add an item and choose the 20% discount pill.
- **Expected:** Cashier/manager discount selections cannot exceed the assigned maximum; server-side sale posting rejects violations.
- **Actual:** `ROLE_MAX_DISCOUNT` is imported but never read; the same 0/2/5/10/15/20% controls are available regardless of role. Sale posting is not implemented in this frontend.
- **Evidence:** Source search shows only the unused import and unrestricted pills.
- **Suggested fix:** Enforce role limits in the control and validate the maximum in an authenticated Postgres posting function; do not rely on client checks.

### PCC-004 — High — Core database schema is not supplied

- **Category/page:** Bug/Data integrity; all pharmacy pages and Supabase deployment.
- **Files/lines:** [supabase/migrations/20261008230000_complete_purchase_workflow.sql:3](../supabase/migrations/20261008230000_complete_purchase_workflow.sql#L3) alters existing `purchases`, `purchase_items`, and `suppliers`; [migration:359](../supabase/migrations/20261008230000_complete_purchase_workflow.sql#L359) and later define purchase functions using pre-existing `medicines`, `medicine_units`, `stock_batches`, `stock_movements`, and `profiles`.
- **Reproduce:** Provision a Supabase project using only the tracked migrations, then load a page that expects pharmacy data.
- **Expected:** Versioned schema, constraints, indexes, grants/RLS and bootstrap path provide the tables required by the app.
- **Actual:** The repository contains no creation migration for the core pharmacy tables (`medicines`, batches, sales, customers, ledger, expenses, profiles). The purchase migration assumes several base tables exist. Live-project tables were not queried.
- **Evidence:** Only the purchase workflow migration and super-admin setup SQL are present under `supabase/`.
- **Suggested fix:** Add reviewed schema migrations for every supported table, relations, constraints, indexes and RLS policies; verify in a disposable staging project before deployment.

### PCC-005 — Medium — Admin role defaults to no module access

- **Category/page:** UX/Permissions; sidebar routes.
- **Files/lines:** [permissions.tsx:29](../src/permissions.tsx#L29), [permissions.tsx:54](../src/permissions.tsx#L54), [permissions.tsx:61](../src/permissions.tsx#L61), [Sidebar.tsx:104](../src/components/Sidebar.tsx#L104).
- **Reproduce:** Give an Admin profile an empty `permissions` array and open the app.
- **Expected:** Per the requested matrix, Admin can open all functional modules.
- **Actual:** Only Super Admin receives an unconditional full module list. Admin's empty list denies ordinary modules; admin-only pages remain visible through the separate role check. Admin may access modules only if explicit permissions are stored.
- **Evidence:** Existing permission tests assert `ADMIN, []` cannot access expenses. No authenticated role was tested.
- **Suggested fix:** Align the role defaults and server-side policy model with the intended Admin matrix, then test an Admin with no manually populated module list.

### PCC-006 — Medium — Master-data screen is hardcoded and its row actions are dead

- **Category/page:** Bug/UX; Categories.
- **Files/lines:** [MasterDataView.tsx:8](../src/components/MasterDataView.tsx#L8), [MasterDataView.tsx:20](../src/components/MasterDataView.tsx#L20), [MasterDataView.tsx:32](../src/components/MasterDataView.tsx#L32), [MasterDataView.tsx:196](../src/components/MasterDataView.tsx#L196), [MasterDataView.tsx:255](../src/components/MasterDataView.tsx#L255), [MasterDataView.tsx:325](../src/components/MasterDataView.tsx#L325).
- **Reproduce:** Open Categories; inspect sample rows; click Edit/Delete/View Products.
- **Expected:** Master records and counts reflect persisted catalog records and row actions are wired.
- **Actual:** Arrays contain fixed sample entries; Add actions update only local component state. Edit/Delete/View Products buttons have no handlers.
- **Evidence:** Static code review; no write action was executed.
- **Suggested fix:** Back master data with Supabase tables/RPCs and connect or remove each unsupported action; derive counts from the catalog.

### PCC-007 — Medium — POS modes, layouts and shortcuts are cosmetic/incomplete

- **Category/page:** UX/Bug; POS Billing.
- **Files/lines:** [POSBillingView.tsx:74](../src/components/POSBillingView.tsx#L74), [POSBillingView.tsx:85](../src/components/POSBillingView.tsx#L85), [POSBillingView.tsx:275](../src/components/POSBillingView.tsx#L275), [POSBillingView.tsx:337](../src/components/POSBillingView.tsx#L337), [POSBillingView.tsx:683](../src/components/POSBillingView.tsx#L683).
- **Reproduce:** Select Quotation, Search Quotation, Barcode Scan or a different cart layout; use advertised F2/F4.
- **Expected:** Each mode/layout changes the workflow, barcode input is handled, and documented shortcuts execute.
- **Actual:** Tab state changes presentation state but no matching workflow is implemented; `cartLayout` is only used for active button styling; no F2/F4 handler was found.
- **Evidence:** Static code search; controls were not exercised while signed in.
- **Suggested fix:** Implement distinct page state/flows and keyboard bindings, or remove controls and shortcut claims until they work.

### PCC-008 — Medium — Settings reports a false save

- **Category/page:** Bug/UX; Settings.
- **Files/lines:** [SettingsView.tsx:45](../src/components/SettingsView.tsx#L45), [SettingsView.tsx:53](../src/components/SettingsView.tsx#L53), [SettingsView.tsx:59](../src/components/SettingsView.tsx#L59), [SettingsView.tsx:90](../src/components/SettingsView.tsx#L90), [SettingsView.tsx:239](../src/components/SettingsView.tsx#L239).
- **Reproduce:** Edit phone, city, invoice footer or debt template; submit Update Profile; revisit/reload Settings.
- **Expected:** All displayed preferences persist or the UI identifies unsaved fields.
- **Actual:** `handleSave` calls only `onSaveCompanyName(shopName)` and then shows “Changes saved successfully”; the other values are component state and reset.
- **Evidence:** Static handler trace; form was not submitted.
- **Suggested fix:** Persist each supported setting and surface per-field errors, or remove unsupported fields and the broad success message.

### PCC-009 — Medium — Dashboard refresh is a no-op

- **Category/page:** Bug/UX; Dashboard.
- **Files/lines:** [DashboardView.tsx:54](../src/components/DashboardView.tsx#L54), [DashboardView.tsx:131](../src/components/DashboardView.tsx#L131).
- **Reproduce:** Click the Refresh dashboard summary button after records change elsewhere.
- **Expected:** Reload current dashboard source data.
- **Actual:** Only increments unused `refreshCount`; no data fetch or recalculation is tied to it.
- **Evidence:** Static handler trace; click not executed.
- **Suggested fix:** Connect refresh to a shared data-loading action or remove the control.

### PCC-010 — Medium — Oversized single JavaScript chunk

- **Category/page:** Performance; application shell.
- **Files/lines:** Build output; production bundle `dist/assets/index-CVWdOnOx.js` (generated build artifact, not source).
- **Reproduce:** Run `npm run build`.
- **Expected:** Initial bundle is split so unauthenticated/login users do not download all application screens and XLSX code.
- **Actual:** One 1,013.64 kB minified JavaScript chunk (289.75 kB gzip); Vite warns about chunks over 500 kB.
- **Evidence:** Build log in Section 8; plugin timing shows 4.0 s of Tailwind transform callbacks within a 33.15 s build.
- **Suggested fix:** Lazy-load authenticated/page modules and defer export/report libraries; measure production load before tuning.

### PCC-011 — Low — Generic test command is missing

- **Category/page:** UX/quality; repository scripts.
- **Files/lines:** [package.json](../package.json).
- **Reproduce:** Run `npm test`.
- **Expected:** A documented project-wide test entry point, or clear documented alternatives.
- **Actual:** npm exits with `Missing script: "test"` although focused scripts exist and pass.
- **Evidence:** `npm test` output recorded in Section 8.
- **Suggested fix:** Add a test script aggregating the established test suites or document the focused commands for CI and contributors.

### PCC-012 — Low — Unused legacy components/dependency surface

- **Category/page:** Dead code; source and dependencies.
- **Files/lines:** [POSScreen.tsx](../src/components/POSScreen.tsx), [ControlledDrugScreen.tsx](../src/components/ControlledDrugScreen.tsx), [RepositoryReviewView.tsx](../src/components/RepositoryReviewView.tsx), [App.tsx:29](../src/App.tsx#L29), [App.tsx:34](../src/App.tsx#L34), [package.json](../package.json).
- **Reproduce:** Search component references/imports; inspect package dependencies.
- **Expected:** Active modules are routed and dependencies reflect actual runtime requirements.
- **Actual:** POSScreen and ControlledDrugScreen are not rendered; ControlledDrugScreen and RepositoryReviewView have unused App imports. No active Express server was found, but Express and `@types/express` remain dependencies and the clean script names `server.js`.
- **Evidence:** Reference search; no server was started or created.
- **Suggested fix:** Remove or deliberately route/use legacy components and remove unused server packages/scripts after confirming no external tooling depends on them.

### PCC-013 — Low — Stale docs describe a missing server API

- **Category/page:** UX/Dead code; documentation/configuration.
- **Files/lines:** [REDESIGN_PROGRESS.md:8](../docs/REDESIGN_PROGRESS.md#L8), [REDESIGN_PROGRESS.md:9](../docs/REDESIGN_PROGRESS.md#L9), [.env.example:20](../.env.example#L20).
- **Reproduce:** Read the demo-login and configuration notes.
- **Expected:** Documentation matches the current Supabase-backed architecture and supported login behavior.
- **Actual:** It describes `/api/auth/config`, `/api/auth/demo-login`, and demo behavior that is not implemented in current `src/`. The active app scan found no `fetch('/api/...')`.
- **Evidence:** Whole-repository text search; no active API call found in `src/`.
- **Suggested fix:** Rewrite or archive stale docs/config text to describe the actual Supabase Auth and local-only behavior.

### PCC-014 — Low — Unknown signed-in paths silently become Dashboard

- **Category/page:** UX; routing.
- **Files/lines:** [App.tsx:278](../src/App.tsx#L278), [App.tsx:280](../src/App.tsx#L280).
- **Reproduce:** With an authenticated session, navigate directly to an unknown path.
- **Expected:** A not-found page or explicit invalid-route result.
- **Actual:** `routeToNavItem` returns null; the route sync resets history to `/` and selects Dashboard.
- **Evidence:** Static route trace. Unauthenticated route probe necessarily redirected all paths to login, so signed-in route behavior was not dynamically observed.
- **Suggested fix:** Render an explicit 404/unknown-route state and preserve normal Back/Forward semantics.

## 6. Security findings

Security review found no high-confidence exploitable vulnerability in the reviewed repository code. This is **not** a certification of the deployed project: live RLS, grants, database functions and storage configuration were not queried.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| — | — | — | — | No high-confidence exploitable vulnerability confirmed by the read-only source review. | — |

- A JWT-shaped value was found in the existing production bundle and its decoded claim was `role=anon`; the value is **[redacted]** and not stored in this report. A Supabase anon/publishable key is intended for browser use; security relies on RLS and server-side authorization.
- No service-role key pattern was found in the searched `src/`, `public/` or built `dist/` files. No value is reproduced.
- No `dangerouslySetInnerHTML` usage or `console.log`/debug calls were found in app source. Purchase print generation uses `document.write`; inspected interpolated purchase fields pass through `safeHtml`. Receipt tests include escaping cases.
- Local/browser storage stores UI preferences, shop name, template preferences, dashboard target, and held-purchase drafts. No password/session secret is explicitly copied into app-managed localStorage by the code found. Supabase Auth SDK manages its own session persistence.
- UI route/role checks are client-side and are not security boundaries by themselves. User management Edge Function checks bearer identity/profile role server-side; purchase RPCs check permissions and use fixed `search_path`. Direct supplier CRUD depends on deployed table RLS.
- Unknown/unreviewed security-critical database state: whether every table has RLS enabled, whether supplier/base-table policies are safe, actual grants, `has_any_permission` implementation, storage policies, and deployed function definitions. No claims are made about these.

## 7. Database findings

### Repository-declared objects

The checked-in `20261008230000_complete_purchase_workflow.sql` modifies or expects:

- Assumed pre-existing base tables: `purchases`, `purchase_items`, `suppliers`, `stock_movements`, `stock_batches`, `medicines`, `medicine_units`, `profiles`.
- Explicitly creates: `purchase_number_state`, `supplier_ledger`.
- Defines RPC functions: `post_purchase`, `purchase_catalog`, `purchase_history`, `purchase_detail`, `void_purchase`.
- Enables RLS for `purchase_number_state` and `supplier_ledger`; revokes direct access to the counter table; adds read policies for supplier ledger, purchases and purchase items. The functions use `SECURITY DEFINER`, set `search_path = public, pg_temp`, and apply permission checks.
- Adds purchase-related indexes (purchase date, purchase-item purchase ID, stock movement reference ID, supplier ledger supplier/time) and constraints around purchase fields. This migration does not establish the base schema or its RLS.

### Expected by the UI but absent from tracked base migrations

`medicines`, `medicine_units`, `stock_batches`, `stock_movements`, `sales`, `sale_items`, customer records, customer ledger/payment entries, expense/cashbook and shift-close records, categories/brands, settings, and `profiles` are expected by UI concepts or SQL references but are not created by checked-in base migrations. Exact live table/column existence is **unknown**.

### RLS, constraints and indexes

- Purchase RPC/table policies can be reviewed in the migration; no `USING (true)` broad policy was found there.
- `profiles`/base-table RLS policy definitions and the implementation of `has_any_permission` are not in the checked-in migration files inspected.
- Missing indexes, foreign keys and constraints for base tables cannot be verified because their DDL is absent. The purchase workflow adds some indexes but not a full schema.
- No live `SELECT` was issued, so no RLS allow/deny result can be reported for any role.
- Suppliers uses direct client CRUD, not a multi-step RPC; the page requires RLS to restrict active roles and writes. This policy is not included in the inspected migration.

## 8. Performance and accessibility

### Performance/build

| Check | Result |
|---|---|
| TypeScript `npm run lint` | Passed, no diagnostics |
| Vite build duration | 33.15 s |
| JS | 1,013.64 kB minified; 289.75 kB gzip; single chunk; >500 kB warning |
| CSS | 76.84 kB; 14.39 kB gzip |
| HTML | 2.51 kB; 0.94 kB gzip |
| Local login navigation timing | 623 ms in this run; not a production or multi-page benchmark |
| Runtime failed/HTTP-error requests | None observed during instrumented login-page reload only |
| Slow Supabase queries / N+1 | Not measurable: no authenticated session, database calls or data pages accessed |
| Memory/re-render/animation CPU | Not measured |
| Lighthouse | Not run; not installed/available as an existing script |
| npm audit | 0 vulnerabilities reported |
| Vite config warning | Uses `__dirname` with native config loader; warning says future config-loader behavior may not support it |

### Accessibility observations

- `prefers-reduced-motion` handling exists in logo/glow and global CSS; the app animation toggle also disables animations via a root data attribute.
- Global `:focus-visible` styling exists. Some header controls expose `aria-pressed`/labels; login inputs have accessible names in the browser snapshot.
- Accessibility was not audited on authenticated pages, in both themes, or with keyboard-only interaction. No contrast ratios or screen-reader checks were measured.
- The 1440/820/390 no-horizontal-overflow check covers **login only**. It does not establish mobile correctness for POS tables, inventory, purchases, or the sidebar.

## 9. Not verified / limitations

- No credentials were requested or entered; no account was created. The requested staging exception could not be used because a separate test project URL was not confirmed.
- All role-specific page access (Cashier, Manager, Accountant, Admin), actual sidebar contents, direct RLS reads, and RLS denials remain unverified at runtime.
- Authenticated pages, their loading/empty/error states, form validation edge cases, all button/link/tab behavior, keyboard controls, normal/large UI, both themes, animation modes, Back/Forward after auth, expiry/logout, and page refresh behavior remain code-reviewed only or untested.
- The app was not checked with a physical barcode scanner, thermal printer, receipt printer, or actual device/browser popup policy.
- No production bundle source maps or production deployment were inspected. No live schema, indexes, policies, RPC versions or database response times were queried.
- Purchase SQL was read, not executed. It references base tables not defined in the repository; whether the existing Supabase project has them is unknown.
- Only login-page rendering was sampled across screen sizes; no 390/820/1440 authenticated page layout, dark-theme contrast, Lighthouse or memory benchmark is claimed.

## 10. Recommended fix order

### Batch 1 — Security and data-loss risks

1. Decide whether Admin means full access or explicitly permission-scoped Admin; make the default matrix and server authorization agree.
2. Implement real Supabase sale posting as an authenticated RPC transaction: validate role discount, tender/split amounts, product/batch eligibility and current stock under row locks; write sale, item, stock movement and customer/cash ledger changes atomically.
3. Add and review complete core schema/RLS migrations; verify in a separate staging project before applying anywhere.

**Ready-to-paste prompt:**  
> In the Pharma Care React/Vite app, replace in-memory POS sales and stock/customer/cash mutations with Supabase-js reads and an authenticated Postgres RPC for atomic sale posting. Use row locks/constraints to prevent overselling, enforce FEFO, role discount limits and sufficient cash tender on the server, and model split tenders explicitly. Add tests for races, insufficient stock, wrong role and accounting totals. First inspect the existing schema; add forward-only migrations and RLS in this repository. Do not create an Express/Node server. Validate only against a confirmed staging Supabase project; do not touch production.

### Batch 2 — Broken pages and features

1. Persist product/catalog, categories/units, customers/ledger, expenses and shift-close data with Supabase RLS/RPCs.
2. Replace demo arrays and demo sale with empty/loading/error-aware database reads; make Dashboard, Sales History and Business Analytics use persisted records.
3. Complete or remove unsupported POS quotation, barcode, layout and shortcut controls; correct split/underpayment flow.
4. Persist every Settings field or remove nonfunctional fields; make success messaging reflect actual saves.

**Ready-to-paste prompt:**  
> Audit and implement the incomplete Pharma Care pages identified in `scan-report/SCAN_REPORT.md`, Batch 2 only. Use Supabase-js in the frontend with RLS and Postgres RPCs for multi-step operations; do not add Express, Node API routes, placeholder “requires a server” text or fake fallback data. Remove demo sample records from user-facing pages, implement explicit loading/empty/error states, persist supported settings and master data, and either complete or remove unsupported controls. Add focused tests and do not change unrelated behavior.

### Batch 3 — UX/performance

1. Split the large initial bundle by route and defer XLSX/export code.
2. Make notifications either real or remove the red dot; distinguish browser-offline from backend health.
3. Improve accessible keyboard semantics, form constraints and responsive tables; run authenticated theme/viewport checks in staging.
4. Add an explicit unknown-route screen and generic test command.

**Ready-to-paste prompt:**  
> Address Batch 3 findings in `scan-report/SCAN_REPORT.md`: add route-level lazy loading and defer export libraries; fix or remove inert notification/status controls; provide an explicit 404; and audit keyboard/focus/labels/contrast and mobile overflow across authenticated screens in a confirmed staging account. Add a project-wide test script for the existing suites. Do not make database or production writes and do not introduce a server API.

### Batch 4 — Polish and cleanup

1. Remove or restore unused legacy UI components and stale imports/dependencies after checking intended product scope.
2. Update stale `/api` demo documentation to the current Supabase architecture.
3. Re-run static checks, tests, npm audit, accessibility and full safe staging browser matrix.

**Ready-to-paste prompt:**  
> Complete Batch 4 from `scan-report/SCAN_REPORT.md`: verify and remove unused legacy components/dependencies and stale server/API demo documentation, without deleting supported product behavior. Then run lint, build, all test suites and `npm audit`; document results. Preserve the Supabase-only backend architecture and do not commit or alter production.

