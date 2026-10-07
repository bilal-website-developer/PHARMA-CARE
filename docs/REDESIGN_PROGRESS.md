# Redesign Progress

## Login: safe demo option

### Completed in this workspace

- Updated the login UI with the two requested tabs, five role cards, demo-only warning banner, and demo user codes.
- The demo option remains hidden unless `GET /api/auth/config` explicitly returns `{ "demoMode": true }`.
- Demo card clicks call `POST /api/auth/demo-login`; the frontend does not mint or simulate an authenticated session.
- Added `DEMO_MODE=false` to `.env.example` as an API-only setting.

### Assumptions

- `DEMO_MODE` is controlled by the API and is never exposed as a Vite client environment variable.
- Demo cards send the lowercase role value (`admin`, `pharmacist`, `cashier`, `inventory`, or `accountant`); the API must map that value to its fixed demo account and return the usual authenticated user response.
- The login warning is shown only when the API confirms demo mode is enabled. The existing in-app warning is likewise gated by that config.
- No backend, database, or user records were created or modified because none of those project components are present in this workspace.

### Blockers and validation

- This workspace contains only the Vite frontend: no API source, auth middleware, database schema, migration/seed infrastructure, or API tests are available. The rate-limited demo endpoint, random-password accounts, sample database data, audit logging, and server-enforced cashier/admin permissions therefore remain unimplemented and unverified.
- There is no `.git` repository in this workspace. No commit was created; creating a new repository here would incorrectly treat the entire pre-existing project as new content.
- `npm run build`, `npm run lint`, and `npm run test:fefo` pass (8 tests).
- Browser smoke check with a mocked enabled config found all five cards and the warning at both 1366x768 and 1920x1080. API-backed authentication and the API test cases were not available to run.
- The Vite build emits the existing warning about `__dirname` in `vite.config.ts`; this unrelated configuration was not changed.
