# Execution Progress

`docs/MASTER_PLAN.md` is the source of truth for scope. This checklist records execution state so work can resume without guessing. No secrets or database connection details belong here.

## Branch and baseline

- [x] Created `master-plan/implementation` from clean commit `adf3606` on `barcode/labels`; no merge or push.
- [ ] Confirm full migration/bootstrap assumptions against the owner's CURRENT and STAGING catalog results.

## Work packages

| Package | Status | Commit hash | Migrations written | Migrations applied by owner | Tests / checks |
|---|---|---|---|---|---|
| 0. Branch and read-only baseline | In progress; branch created, baseline inventory pending | Not committed | None | None | `git branch -a`, `git branch --merged main`, branch divergence and diff inspected; no application tests |
| 1. Staging bootstrap and catalog comparison | Waiting for owner to build staging and return results | Not committed | None | None; SQL has not been run by assistant | Documentation and query pack prepared; no database query executed by assistant |
| 2. W1 ACL prerequisite reconciliation | Blocked on package 1 results | — | None | None | Not run |
| 3. W5 barcode UI/scanner improvements (early client-only package) | Blocked at staging checkpoint | — | None | None | Not run |
| 4. W2 schema foundation and Shop 1 backfill | Blocked on package 1 and prerequisite approvals | — | None | None | Not run |
| 5. W2 tenant RLS, RPC, and Edge Function isolation | Blocked on package 4, two-shop test design, and staging | — | None | None | Not run |
| 6. W4 persistence and transactional `complete_sale` | Blocked on package 5 | — | None | None | Not run |
| 7. W3 stock alerts | Blocked on package 5 | — | None | None | Not run |
| 8. W5 per-shop cross-table barcode registry and RPCs | Blocked on package 4 and duplicate inventory | — | None | None | Not run |
| 9. W6 unused checks and ESLint (`react-hooks`) | Pending; do not enable `strict` in this package | — | None | None | Not run |
| 10. W7 performance and hygiene | Pending | — | None | None | Not run |
| 11. Final strict TypeScript measurement/decision | Pending final package; enable only if measured errors are manageable | — | None | None | Not run |
| 12. Consolidated staging security and feature verification | Blocked on all implementation packages and owner-applied staging migrations | — | None | None | Not run |

## Approved rules and stop point

- Shared Supabase project with `shop_id` on every shop-owned table, conditional on two-shop isolation tests and staging acceptance.
- `super_admin` is platform-only; Shop 1 is owned by the existing admin account. Never expose business data to platform-only accounts.
- A stock batch is sellable through its expiry date: `expiry_date >= current_date`, status `ACTIVE` or `NEAR_EXPIRY`, remaining quantity greater than zero, and active medicine. Align every conflicting helper, test, document, and SQL condition.
- Main TypeScript package enables unused-symbol checks and ESLint first. Measure `noUnusedLocals`, `noUnusedParameters`, and `strict` separately. Strict is a separate final package and is optional if the measured issue count is not manageable.
- Barcode UI is an early client-only package after the staging checkpoint. Product rows/cards must expose Edit, Print barcode with per-product quantity, and Make barcode; scanner test and POS/Products scan handling are required. Caps: 200 labels per product and 1,000 per print job.
- QR is out of scope. Remove `express` and `@types/express` only after confirming they are unused.
- No SQL execution or deployment by the assistant. Migrations and rollback files only; cashier never receives cost data.
- Show the old and proposed definitions and obtain approval before changing RLS or `is_staff`, `is_admin`, or `has_any_permission`.
- **Current stop:** staging project bootstrap and SELECT-only catalog comparison. No multi-shop migration may be written until the owner returns and the results are reviewed.
