# Execution Progress

`docs/MASTER_PLAN.md` is the source of truth for scope. This checklist records execution state so work can resume without guessing. No secrets or database connection details belong here.

## Branch and baseline

- [x] Created `master-plan/implementation` from clean commit `adf3606` on `barcode/labels`; no merge or push.
- [ ] Confirm full migration/bootstrap assumptions against the owner's CURRENT and STAGING catalog results.

## Work packages

| Package | Status | Commit hash | Migrations written | Migrations applied by owner | Tests / checks |
|---|---|---|---|---|---|
| 0. Branch and read-only baseline | Complete; repository/branch audit only | — | None | None | `git branch -a`, `git branch --merged main`, branch divergence and diff inspected; no application tests |
| 1. Staging bootstrap and catalog comparison | Waiting for owner to build staging and return results | `b05cfa4`, `e9319a7` | None | None; SQL has not been run by assistant | Bootstrap/query documentation committed; no database query executed by assistant |
| 2. W1 ACL prerequisite reconciliation | Blocked on package 1 results | — | None | None | Not run |
| 3. W5 barcode UI/scanner improvements (early client-only package) | Complete; client-only, no schema/database work | `818af6c` | None | None | `npm test`, `npm run lint`, `npm run build` passed; targeted scanner (4) and label (5) tests passed |
| 4. W2 schema foundation and Shop 1 backfill | Blocked on package 1 and prerequisite approvals | — | None | None | Not run |
| 5. W2 tenant RLS, RPC, and Edge Function isolation | Blocked on package 4, two-shop test design, and staging | — | None | None | Not run |
| 6. W4 persistence and transactional `complete_sale` | Blocked on package 5 | — | None | None | Not run |
| 7. W3 stock alerts | Blocked on package 5 | — | None | None | Not run |
| 8. W5 per-shop cross-table barcode registry and RPCs | Blocked on package 4 and duplicate inventory | — | None | None | Not run |
| 9. W6 unused checks and ESLint (`react-hooks`) | Unused cleanup committed; strict/noUnusedParameters enabled; noUnusedLocals and ESLint await owner decision | `cce45bb` + this commit | None | None | `npm run lint`, `npm test`, `npm run build` passed |
| 10. W7 performance and hygiene | Pending | — | None | None | Not run |
| 11. Final strict TypeScript measurement/decision | Complete; strict diagnostics were zero and strict is enabled | This commit | None | None | `--strict`: 0 before/after cleanup; combined strict + noUnusedParameters: 0 |
| 12. Consolidated staging security and feature verification | Blocked on all implementation packages and owner-applied staging migrations | — | None | None | Not run |

## Baseline measurements

Measured 2026-10-13 on `master-plan/implementation`; no compiler/build configuration was changed.

### Production build and first-load gzip

`npm run build` passed. Vite reported these generated output chunks:

| Output | Raw size | Gzip size |
|---|---:|---:|
| `dist/index.html` | 2.51 kB | 0.94 kB |
| `dist/assets/index-DmS7fu4v.css` | 85.24 kB | 15.69 kB |
| `dist/assets/index-DBnErXly.js` | 1,421.14 kB | 401.61 kB |
| **First-load total** | **1,508.89 kB** | **418.24 kB** |

First-load total includes the HTML document and the stylesheet/script it loads. At 418.24 kB gzip, it exceeds the 200 kB target by 218.24 kB (about 2.09× the target). Build warnings: the XLSX dynamic imports do not split the library because Purchase History statically imports it, and the minified JS chunk exceeds Vite's 500 kB warning threshold.

### TypeScript command-line diagnostics

Each flag was run separately with `npx.cmd tsc --noEmit`; no config files were edited.

| Flag | Errors | Top files by diagnostic count |
|---|---:|---|
| `--noUnusedLocals` | 88 | `InventoryScreen.tsx` 15; `POSBillingView.tsx` 15; `POSScreen.tsx` 6; `CustomerLedgerScreen.tsx` 6; `ReportsScreen.tsx` 6; `SettingsView.tsx` 5; `EndOfDayModal.tsx` 5; `ControlledDrugScreen.tsx` 5; `RepositoryReviewView.tsx` 4; `WhatsAppRemindersView.tsx` 4 |
| `--noUnusedParameters` | 1 | `SettingsView.tsx` 1 |
| `--strict` | 0 | None |

The one unused-parameter diagnostic is `currentRole` in `SettingsView.tsx`. The 88 unused-local diagnostics comprise 87 TS6133 diagnostics and one TS6198 unused destructuring diagnostic. Twenty-one unused import bindings were reported: `App.tsx` (`ControlledDrugScreen`, `RepositoryReviewView`); `EndOfDayModal.tsx` (`Moon`, `CheckCircle2`, `Wallet`, `ArrowDownLeft`, `ArrowUpRight`); `InventoryScreen.tsx` (`React`, `useMemo`); `MyPrintRequestsView.tsx` (`React`); `PrintRequestsAdminView.tsx` (`React`); `PurchaseHistoryView.tsx` (`React`); `StockPurchaseView.tsx` (`React`); `TemplatePreviewModal.tsx` (`useMemo`); `TrashBinView.tsx` (`React`); `WhatsAppRemindersView.tsx` (`Send`, `CheckCircle2`, `Phone`, `AlertCircle`); `inventory/InventoryUi.tsx` (`React`); and `labels/LabelPrintDialog.tsx` (`React`). Keep `RepositoryReviewView` as requested: it is imported by `App.tsx` even though the current unused-local check flags that binding.

After the client cleanup in `cce45bb`: `--noUnusedLocals` reports 16 errors, all left in the protected `ControlledDrugScreen.tsx` (5), `POSScreen.tsx` (6), and `RepositoryReviewView.tsx` (4), plus the intentionally retained `RepositoryReviewView` import in `App.tsx` (1). Those three component files were not edited or deleted. `--noUnusedParameters` reports 0 and `--strict` reports 0; their combination also reports 0. Accordingly, `strict` and `noUnusedParameters` are enabled in `tsconfig.json`; `noUnusedLocals` is not enabled pending the owner's decision on those preserved diagnostics.

Cleanup removed 72 of 88 initial unused-local diagnostics and the sole unused-parameter binding without changing app behavior. `ControlledDrugScreen`, `RepositoryReviewView`, and `POSScreen` remain present for the owner's decision. `npm run lint`, `npm test`, and `npm run build` all passed after the config update.

### ESLint proposal (not installed; pending approval)

Registry release dates verified 2026-10-13. Proposed exact development dependencies: `eslint@10.11.0` (2026-09-18), `typescript-eslint@8.71.0` (2026-09-28), and `eslint-plugin-react-hooks@7.1.1` (2026-04-17). The ESLint packages are older than 14 days. **Compatibility caveat:** `typescript-eslint@8.71.0` declares TypeScript `<6.1.0` as its peer range, while this repository declares TypeScript `^7.0.2`; confirm a compatible typescript-eslint release before installing.

Proposed `eslint.config.mjs`:

```js
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
);
```

Proposed npm script: `"lint:eslint": "eslint ."`; no packages were installed and no ESLint config/package script was added. Await owner approval and TypeScript 7 compatibility resolution.

### Unused-code candidates

- No references under `src/` were found for declared dependencies `@google/genai`, `dotenv`, `express`, `@types/express`, `motion`, `autoprefixer`, or `esbuild`. These are candidates for a separate usage/build-tool review, not removed here; `esbuild` may serve the build chain, and the package scripts still mention deleting `server.js`.
- `@e965/xlsx` and `jsbarcode` are used in source. The build specifically confirms XLSX is statically loaded through Purchase History despite dynamic imports elsewhere.
- A source import-graph scan found `src/components/POSScreen.tsx` has no incoming source import. Test files are invoked by package scripts, and `src/main.tsx` is the HTML application entry point, so their lack of source importers is expected. `RepositoryReviewView` is imported from `src/App.tsx` and must stay.

## Approved rules and stop point

- Shared Supabase project with `shop_id` on every shop-owned table, conditional on two-shop isolation tests and staging acceptance.
- `super_admin` is platform-only; Shop 1 is owned by the existing admin account. Never expose business data to platform-only accounts.
- A stock batch is sellable through its expiry date: `expiry_date >= current_date`, status `ACTIVE` or `NEAR_EXPIRY`, remaining quantity greater than zero, and active medicine. Align every conflicting helper, test, document, and SQL condition.
- Main TypeScript package enables unused-symbol checks and ESLint first. Measure `noUnusedLocals`, `noUnusedParameters`, and `strict` separately. Strict is a separate final package and is optional if the measured issue count is not manageable.
- Barcode UI is an early client-only package after the staging checkpoint. Product rows/cards must expose Edit, Print barcode with per-product quantity, and Make barcode; scanner test and POS/Products scan handling are required. Caps: 200 labels per product and 1,000 per print job.
- Package 3 delivered product row/card/details actions, independent label quantities with both caps, a scanner test dialog, and keyboard-scanner parsing in Products search and POS. Barcode RPC availability is reported clearly when absent. Physical scanner/printer checks remain manual.
- QR is out of scope. Remove `express` and `@types/express` only after confirming they are unused.
- No SQL execution or deployment by the assistant. Migrations and rollback files only; cashier never receives cost data.
- Show the old and proposed definitions and obtain approval before changing RLS or `is_staff`, `is_admin`, or `has_any_permission`.
- **Current stop:** staging project bootstrap and SELECT-only catalog comparison. No multi-shop migration may be written until the owner returns and the results are reviewed. Package 3 is complete independently of that gate; it wrote no migrations and applied no SQL.
