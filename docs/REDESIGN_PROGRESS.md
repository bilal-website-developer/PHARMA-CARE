# Redesign Progress

## Safe demo login

### Implemented

- The login page has demo and manual tabs, five role cards, role-code pills, named demo users, loading/error states, and an alert banner shown only when demo mode is enabled.
- The demo tab is fail-closed: it appears only if `GET /api/auth/config` returns `{ "demoMode": true }`. The client submits a lowercase role to `POST /api/auth/demo-login`; it does not create a session locally.
- `.env.example` documents `DEMO_MODE=false`.
- The app's in-session demo alert is also controlled by the server-provided demo-mode flag.

### Assumptions

- Only the API may decide whether demo mode is enabled. The browser must not infer the flag from a client-side environment variable.
- The API maps `admin`, `pharmacist`, `cashier`, `inventory`, and `accountant` to fixed demo accounts and responds with the same `user` session shape used by normal login.
- “Role code” is shown separately from the fixed account username so the cards communicate both permission role and demo account identity.
- Without an API implementation and data boundary in this workspace, no demo authentication/session is simulated in the frontend.

### Blockers and checks

- This repository currently contains a Vite/React frontend only. There is no API source, auth middleware, database/schema, migration or seed system, or API test suite. The rate-limited login endpoint, isolated demo database/records, password generation, audit trail, and server-side cost/profit/admin authorization cannot be added or verified here without introducing an unrelated backend and inventing the app's authentication and data model.
- `npm run build`, `npm run lint`, and `npm run test:fefo` pass (8 FEFO tests). Browser smoke checks confirmed five cards and the banner in demo mode at 1366x768 and 1920x1080; when disabled there are no tabs or banner and the manual form remains visible.
- The Vite build reports an existing `__dirname` config-loader warning; it is unrelated and unchanged.
