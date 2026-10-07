# Redesign Progress

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

- This repository currently contains a Vite/React frontend only. There is no API source, auth middleware, database/schema, migration or seed system, or API test suite. The rate-limited login endpoint, isolated demo database/records, password generation, audit trail, and server-side cost/profit/admin authorization cannot be added or verified here without introducing an unrelated backend and inventing the app's authentication and data model.
- `npm run build`, `npm run lint`, and `npm run test:fefo` pass (8 FEFO tests). Browser smoke checks logged all five roles into the app without calling the missing demo-login endpoint; Cashier opened POS, could not see product/user admin links, and saw profit redacted in Sales History. Admin sees Manage Users. The login layout was checked at 1366x768 and 1920x1080, with demo-off retaining only the manual form.
- The Vite build reports an existing `__dirname` config-loader warning; it is unrelated and unchanged.

## Billing and reference UI work

### Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| B0 | Partly | Inspected the Vite frontend; the checkout is `main`, not `redesign`, and reference screenshots are unavailable. |
| B1 | Partly | Billing-template cards are implemented; preferences are browser-local, not backed by Admin-only API settings. |
| B2 | Done (frontend) | Responsive preview modal supports 58mm, 80mm, and A4 and applies or cancels local preferences. |
| B3 | Done (frontend) | Shared renderer, POS printing, and rendering/security tests are implemented. Sales-history and ledger reprint paths are not present in this frontend. |
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

- The attached billing/UI specification targets a different monorepo and `redesign` branch. The available checkout is the Vite-only frontend on `main`; no screenshots under `docs/reference/`, API, PostgreSQL, Settings persistence API, or role permission service are present.
- Browser-local storage is used for the billing template and paper format as a frontend-only stand-in. It is not a server-enforced/admin-only preference.
- The template picker/apply action is hidden from editing for non-Admin roles in the UI; this is not a substitute for server-side authorization.
- Receipt header values use the product name and sample medicine items; real store profile persistence cannot be connected without the missing settings backend.

### Completed in this frontend

- Added a shared sanitizer-backed receipt renderer for Simple, Classic, Professional, and Modern in thermal 58mm/80mm and A4 formats, and hooked it to the receipt preview and POS completed-sale print action.
- Reworked Billing Template cards and the preview modal in the existing Settings page. Selection/default format persist locally; applying preview settings saves both and Cancel discards modal changes.
- Added 13 receipt rendering/security tests (4 templates × 3 formats plus HTML escaping). Existing login/demo behavior remains unchanged.
- Refreshed the top header with online/offline status, per-user Normal/Large UI preference, and current user details; moved logout into the sidebar footer and removed third-party attribution. Cashier sidebar navigation is reduced to the supported day-to-day pages in this frontend.

### Blocked / remaining

- Server-enforced billing settings, API tests and data permissions, print-sales-report endpoint/data, database migrations/backup, and persistent real store details are blocked by the absent API/database monorepo. Do not enable these features for production until server-side enforcement is implemented.
- Print Sales Report UI/data, full collapsible sidebar, dashboard/POS reference matching, comprehensive role/colour audit, broader sales-history/ledger reprint integration, and API tests remain incomplete.
- Validation: `npm run build`, `npm run lint`, `npm run test:receipt` (13 tests), and `npm run test:fefo` (8 tests) pass. Receipt preview was checked with medicine names, batch/expiry, total and no cost/profit fields. API tests cannot run in this repository.
- Branch differs from the referenced prompt: work was found on `main`; it was not moved to a new `redesign` branch.
