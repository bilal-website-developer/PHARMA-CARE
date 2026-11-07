# Pharma Care — Full Multi-Shop Plan

**Status:** Owner-run staged execution is approved. S1 files are prepared under `supabase/fresh/`; no database changes have been applied. Do not treat checked-in SQL as applied until the owner reports its result.

## Owner-approved live execution override (2026-11-07)

The owner explicitly waived the separate staging-project/catalog-comparison checkpoint for this rollout because the current project contains test data and no shop is live yet. This waiver applies only to staging: all SQL and Edge Function deployment remain owner-run, one numbered stage at a time, and each next stage waits for the current stage's passing smoke test. The assistant prepares files only and never runs SQL, merges, pushes, or deploys.

The owner-confirmed account model is:

- The platform `super_admin` has no shop (`shop_id = NULL`) and no shop-business access. It manages shops, Admin profiles, and page/feature grants.
- Create a separate, initially empty `Developer Shop` with a separate Admin login for development and demos. Existing non-Super-Admin accounts and retained business data after S2 cleanup belong to `Shop 1`.
- A Shop Admin may create/manage only Manager/Cashier staff in its own shop and may grant only permissions it personally holds. It cannot create/change Admin or Super Admin profiles or change anyone's shop assignment. Staff cannot manage accounts.
- Preserve the creator-scoped Team view: Super Admin can inspect an Admin's team and change active/removal status; an Admin sees only its own team and cannot change member status.

For this execution, the former staging-comparison checkpoint is replaced by S1 in `supabase/fresh/000_S1_RUNBOOK.md`. No S2 or tenant migration is authorized until the owner returns the current-only catalog results and S1 smoke-test output.

## User-confirmed clarifications (2026-11-05)

These requirements supersede conflicting planning defaults below; they are design decisions only and do not bypass owner-run stage, ACL, or protected-helper gates:

1. A shop may have multiple Admin-role profiles. A designated owner/primary Admin may remain the provisioning anchor, but must not be enforced as the only Admin in a shop. The Super Admin manages account-to-shop assignments.
2. The Super Admin may store and edit a private note on each Admin profile. Only the Super Admin may read/write it through explicitly authorized server paths; it must not appear in shop Admin/staff responses or browser-local storage.
3. Page/module access is explicitly granted: the Super Admin grants each Admin's pages, and a Shop Admin may grant staff only permissions it personally holds. No role defaults confer business-page access and no user may self-grant.
4. `shop_id` is visible only to the Super Admin. Tenant clients must never receive it as display data or choose it as authority; server-side identity derives shop scope.
5. Every shop-owned business record and operation is scoped to its `shop_id`, enforced across RLS, RPCs, Edge Functions, references, counts, and exports.

**Source of truth:** This document and the owner-approved amendments at the beginning of [MASTER_PLAN.md](./MASTER_PLAN.md) record the current model. If older text below conflicts, the 2026-11-07 owner decisions and S1-S6 stages take precedence. [EXECUTION_PROGRESS.md](./EXECUTION_PROGRESS.md) records actual work-package state.

## 0. Owner-run stages and go/no-go gates (2026-11-07)

| Phase | Scope | Exit criteria |
|---|---|---|
| S1 — Current-only inventory and snapshot | Run `000_current_only_catalog_queries.sql`, then create and verify `backup_20261107` using the `000_*` S1 files. | Q1-Q9 and Q11 returned; all Q10 function batches returned; every public-table row count matches; backup RLS/no-policy/API-denial smoke test passes. |
| S2 — ACL lockdown and test-data cleanup | Apply Track A only after reviewing S1 results; then clean test data while preserving all existing non-Super-Admin accounts and the retained Shop 1 data. | Track A and cleanup smoke tests pass; account/data keep-list verified. |
| S3 — Additive tenant foundation | Add shops, profile ownership/backfill, trusted `current_shop_id()`, additive `shop_id` columns/defaults/indexes; do not make access restrictive yet. | Counts/references/default behavior pass; existing frontend still works. |
| S4 — Tenant enforcement | Add shop RLS, per-shop uniqueness and server scope boundaries. | Two shops and multiple Admins pass cross-shop denial tests; platform Super Admin sees no business data/screens. |
| S5 — Server operations | Rewrite SECURITY DEFINER functions in small groups with same-shop identity, role, permission, and reference checks. | Per-function positive/negative tests and smoke test pass after each group. |
| S6 — Accounts and UI | Update `manage-users`, shops/Admin provisioning, private notes, grants, Team view, and UI. | Edge Function and UI policy tests pass; owner deploys only after SQL smoke tests. |

**Current stop:** S1 is authored but not run. The owner waived staging only; no later stage is approved until S1 results are reviewed.

## 1. Goal and security rules

1. A shop may have multiple Admin-role profiles. Each user/profile belongs to exactly one shop; multi-shop memberships are out of scope. The Super Admin manages Admin-to-shop assignments.
2. A shop's products, suppliers, customers, stock, purchases, sales, expenses, reports, print requests, trash, settings, and business activity are private to that shop.
3. Shop separation is enforced in database policies, RPCs, Edge Functions, storage policies, and server-derived identity—not just in UI filtering.
4. The platform Super Admin manages shops and account metadata, but has no general access to shop business data.
5. The Super Admin has no business-data exception: it cannot browse or write shop catalog, inventory, purchase, or sales data.
6. Cashiers never receive cost, profit, or margin. Preserve the existing revokes on the five cost-bearing tables; no tenancy work may widen access to them.

## 2. Current state and evidence limits

- **Exists:** a shared-project tenancy proposal and the now-superseded staging-first gate in `MASTER_PLAN.md`; current-project S1 inventory and snapshot files are prepared.
- **Exists:** role-based user management and shop-profile/receipt fields in the UI. The current profile and some receipt fields are browser-local, not authoritative per-shop server data.
- **Exists, needs change:** current role defaults are not the approved policy. The Super Admin grants Admin pages; Shop Admins may grant staff only permissions they hold. No role defaults grant business pages. Settings and permission constraints/UI must be reconciled before changing them.
- **Missing:** shop records, profile/table `shop_id` ownership, tenant-filtered policies and business RPCs, server-backed per-shop shop identity/settings, two-shop isolation implementation/tests, and platform Shops management.
- **Missing:** durable Auth-to-shop provisioning/recovery workflow, shop suspension enforcement, and per-shop receipt identity snapshots.
- **Unknown until S1 current-only inventory:** exact live table, policy, constraint, trigger, index, and function inventories; whether they match the reconstructed baseline and checked-in migrations; and which migrations have been applied.

Counts of tables, functions, policies, and triggers are **inventory counts to measure and verify in S1**, not fixed facts. Do not rely on a hard-coded function count or assume the reconstructed baseline is exhaustive. Audit every `SECURITY DEFINER` routine individually.

## 3. Ownership and shop identity

Create a shop record with an immutable ID, Super-Admin-assigned Admin memberships, shop name, phone, address/location, receipt identity/settings, status, creator, timestamps, and any approved logo reference. A shop may have multiple Admins; each Admin/staff profile is assigned to exactly one shop. The platform Super Admin has no tenant `shop_id`.

Use one authoritative server-backed shop profile for the shop name and receipt identity. Only the Super Admin may create or edit those identity fields. Shop Admins and staff can read their own shop's identity but cannot change it. Remove browser-local copies of shop name, address, phone, or receipt identity as sources of truth; keep unrelated UI/device preferences local where appropriate.

Keep the logo. In the highlighted header area, show the configured shop name alongside the existing logo instead of the fixed Pharma Care/WhatsApp Reminders branding text. Keep the WhatsApp Reminders feature and sidebar navigation; this is a header-branding change, not removal of the feature.

When the Super Admin creates or edits a shop Admin, show the shop-profile fields in that Admin's form. Later profile changes remain editable only by the Super Admin and are audited.

## 4. Server-derived shop context

- Add a fixed-search-path `current_shop_id()` (or equivalent) that derives the caller's shop from trusted server-side profile state.
- Do not trust `shop_id` from URL, request body, form state, or user-editable `user_metadata`. Ignore or reject caller-supplied shop IDs.
- A caller with no shop must be denied all business operations; the Super Admin may use only platform shop/account/permission management APIs.
- Do not put trusted tenancy solely in mutable client claims. Verify profile/shop status on the server and define token/session invalidation behavior for suspension.

## 5. Shop-owned data and isolation surface

The S1 current-only inventory must identify every actual relation and classify it as shop-owned, platform metadata, or shared reference data. Expected shop-owned families include:

- Catalog: medicines, medicine units, categories, brands.
- Contacts and ledgers: suppliers, supplier ledger, customers, khata entries.
- Inventory and procurement: stock batches, stock movements, purchases, purchase items, purchase number state.
- Sales and accounting: sales, sale items, batch allocations, sale payments, expenses/cashbook, controlled-drug records.
- Operations: print requests, tenant audit events, trash/restore events, alert state, per-shop settings, barcode registry/counters, and any additional tenant-owned tables discovered in S1.

Every shop-owned row must be scoped by `shop_id` directly or through a verified parent relationship, with same-shop foreign-key integrity. New records receive server-derived ownership. Add `shop_id` indexes and common composite indexes only after verifying existing access patterns and indexes.

Scope list/detail/search/count/statistics, dashboards, exports, imports, bulk actions, trash, receipt requests, audit views, and storage paths—not only the main list pages. No API may reveal cross-shop existence by error differences or counts.

## 6. Policies, RPCs, and Edge Functions

Create current-project inventories of all relations, grants, RLS policies, views, triggers, and routines, including overloads and function owners/security settings. Counts are to be recorded as discovered; do not assume a fixed number.

For every relevant policy, preserve required permission predicates while applying same-shop `USING` and `WITH CHECK` rules. For every function/RPC, audit all reads, writes, joins, nested IDs, aggregates, exports, and audit payloads. `SECURITY DEFINER` functions must derive the caller/shop server-side, validate active shop membership and permission, enforce same-shop references, use a fixed search path, and retain least-privilege EXECUTE grants.

The `manage-users` Edge Function uses elevated credentials and must explicitly enforce platform-versus-shop role boundaries on every action. Its rules and negative tests must cover list, create, edit, deactivate, delete/restore, role assignment, permissions, last-admin handling, and cross-shop identifiers.

Do not change `is_staff()`, `is_admin()`, `has_any_permission()`, or existing RLS semantics without the exact current/proposed definitions, call-site review, and the owner approval required by `MASTER_PLAN.md`.

## 7. Accounts and provisioning/recovery

- The Super Admin creates, edits, suspends, and soft-deletes shops and their Admin accounts. It sees shop/account metadata, not shop business data.
- The Super Admin cannot read or write shop catalog or business rows.
- A shop Admin can manage only staff in their own shop and cannot create another Admin or Super Admin. Staff cannot change shop membership through UI or API.
- A Shop Admin may grant staff only permissions it personally holds; staff roles cannot manage accounts.
- Allow multiple Admins per shop. Protect the last active Admin for a shop and the last active platform Super Admin globally.
- Email uniqueness is global because Auth is global; show an explicit collision message, including conflicts with retained/deactivated identities where applicable.

Creating a shop and its Admin spans Supabase Auth and Postgres and is **not one atomic transaction**. Use an explicit compensating workflow:

1. Validate the Super Admin, shop fields, email availability, and retry/idempotency key.
2. Create a pending shop/provisioning record with a durable operation identifier.
3. Create the Auth user using the server-side Admin API.
4. In one Postgres transaction, create/link the Admin profile, shop ownership, and initial shop settings; mark provisioning complete.
5. If any later step fails, attempt compensating undo in reverse order: remove the new profile/settings/shop records and delete or disable the newly created Auth user using the Admin API.
6. Record failures in compensation; never report success-shaped completion when cleanup failed. Retain a safe operation status for retry/manual recovery without exposing credentials.
7. Run an orphan cleanup check that compares pending shop operations, shop owner profiles, and Auth identities; report and resolve orphaned Auth users or incomplete shops through an audited operator action.

The workflow must be idempotent and tested at each failure boundary. Do not describe the cross-system operation as atomic.

## 8. Permissions and Settings

- The Super Admin manually grants page/module access; all users including Admins receive only explicitly granted pages, cannot self-grant, and cannot access another shop. Shop Admins cannot edit shop identity.
- Add a Settings checkbox for staff roles (Manager, Cashier, Accountant) so access to the Settings page can be granted or withheld per user. Enforce it in navigation, page access, and server operations where settings are written.
- Settings permission covers permitted operational preferences only. Shop name, phone, address, receipt identity, logo, and other Super Admin-owned profile fields remain immutable to shop users regardless of their Settings access.
- This rule replaces existing role defaults where they conflict: reconcile `MASTER_PLAN.md`, `src/permissions.tsx`, `ManageUsersView`, permission validators and server policies. Super Admin grants Admin access; Shop Admins may grant staff a subset of their own permissions. Enforce both paths server-side; shop ownership alone must not silently grant pages.
- Inspect the live `profiles.permissions` constraint using the S1/current-project inventory. Add `settings` to the permitted key set with a reviewed forward migration and rollback. Do not assume the supplied baseline constraint matches the live project.
- Super Admin platform management is role-gated, not a shop module permission. It receives no general shop-business permission bypass.

## 9. Per-shop operational settings

Store operational preferences (receipt format options, display/print choices, allowed discount caps, hard maximum, expiry warning days, and similar settings) per shop on the server. Preserve current defaults where approved. Read/write through scoped functions; validate values and require the Settings permission for staff writes. The shop Admin may edit allowed operational preferences but not shop identity.

Browser storage may be an explicitly labeled offline/display fallback, never the authoritative shop profile or shared server setting.

## 10. Receipt identity and historical prints

All new receipts read the shop's server-backed identity. A completed sale must persist a safe snapshot of shop name, phone, address, and receipt identity/text so later profile edits do not silently rewrite an old receipt. Reprints remain marked as duplicates. Never print cost, profit, or margin.

Verify this end-to-end only after durable sale persistence exists; current POS sales remain local/demo state until the planned transactional sale workflow is implemented.

## 11. Numbering and uniqueness

Use separate sequences/counters so invoice/memo/purchase numbers are **sequential and unique within each shop**. Scope uniqueness and allocation by shop, and serialize concurrent allocation. Do not promise gap-free numbering initially. A gap-free guarantee may be considered only after concurrency, rollback, retry/idempotency, and failure tests prove it; otherwise retain sequential-and-unique behavior and document possible gaps.

Replace global uniqueness where the business rule is per shop: product code, barcode, supplier/category/brand names where applicable, purchase number, and invoice/memo number. Barcode uniqueness must span medicine and unit barcodes within a shop; different shops may reuse a manufacturer barcode. Inventory duplicates and existing indexes before replacing any global key.

## 12. Barcode and platform boundary

Existing barcode UI and assignment are not yet shop-aware. After schema/backfill work, replace the global medicine-only barcode index and sequence with a per-shop registry covering both medicines and units. Preserve cost confidentiality and reject collisions rather than silently reassigning manufacturer codes.

The Super Admin cannot seed or edit shop catalog rows. Catalog creation and changes are shop operations, authorized for the Shop Admin and its granted staff within that shop.

## 13. Shop status and deletion

A suspended shop's users cannot sign in or perform business operations; verify this at authentication/session and server-function boundaries, not only by hiding pages. Preserve its data. Shops are soft-deleted, not hard-deleted. A deletion cannot erase business history. Licence/renewal and billing dates are deferred.

## 14. Audit and storage

Audit identity changes, Admin/staff account changes, suspension/deletion, provisioning compensation, and orphan cleanup. Include actor, target shop, timestamp, operation, outcome, and safe before/after data; never log passwords, tokens, or secrets.

If a shop logo is stored in Supabase Storage, use a per-shop path and least-privilege policies. Only the Super Admin may change the shop identity/logo; tenant users may read only the asset for their own shop.

## 15. Backfill and uniqueness cutover

Create one initial shop owned by the selected existing Admin and assign every existing business row/profile to it. Before making `shop_id` required, verify parent references, row counts, nulls, duplicates, totals, and audit/print history in the owner-approved stage. Stop on mismatches; do not guess ownership or silently merge records.

Backfill a single per-shop barcode registry across `medicines.barcode` and `medicine_units.barcode`. If the legacy global index exists, replace it only after normalized duplicate checks and a rollback-safe migration are reviewed.

## 16. Production and rollback

No next-stage migration until:

1. The current-only S1 catalog results and snapshot smoke test pass.
2. ACL prerequisites are reconciled and approved.
3. Each subsequent owner-run SQL stage passes its smoke test.
4. Two-shop isolation and recovery tests pass; the owner accepts results.
5. Matching rollback files and the next-stage go/no-go checks are reviewed.

The owner applies SQL and deploys functions. Do not run SQL or deployment commands on the owner's behalf. The SQL snapshot is only a public-table data restore point, not a full database backup. Rollbacks must preserve business rows, avoid recreating unsafe global indexes, and define what happens to partial provisioning or new tenant records.

## 17. Automated and manual verification

Use at least two shops, each with an Admin, Manager, and Cashier. Automated negative tests must verify:

- Every discovered shop-owned table, policy, RPC, Edge Function, import/export, count, and storage path refuses cross-shop reads/writes/deletes, including guessed IDs and forged `shop_id`/`user_metadata`.
- Shop Admin user management, role assignment, last-admin constraints, Settings permissions, and Super Admin platform boundaries.
- Super Admin cannot read or write shop business rows, including catalog seeding.
- Cost, profit, and margin remain unavailable to Cashier in screens, RPC results, receipts, and exports.
- Suspension blocks sign-in and server operations; deletion preserves history; incomplete Auth/Postgres provisioning is compensated or surfaced for cleanup.
- Per-shop identifier uniqueness and sequential numbering under concurrent requests, rollback, retries, and failures. Test gap-free separately before making that promise.
- Shop profile changes affect new prints but not old receipt snapshots.

Owner-controlled live schema checks, function deployments, and physical scanner/printer tests remain unverified until evidence is provided.

## 18. Work order and current blocker

Follow the owner-approved live stages in section 0 and `supabase/fresh/000_S1_RUNBOOK.md`:

1. **S1 current-only inventory and snapshot.** Owner runs the `000_*` SQL files and returns the one-cell outputs plus the passing snapshot smoke test.
2. **S2 ACL lockdown and test-data cleanup.** Owner applies only after S1 review; preserve all existing non-Super-Admin accounts and the agreed Shop 1 data.
3. **S3 additive ownership schema.** Do not enable restrictive tenant RLS in this stage; verify the live app remains usable.
4. **S4 tenant RLS/uniqueness.** Stop on any cross-shop or business-app smoke failure and run only that stage's rollback.
5. **S5 function rewrites and S6 `manage-users`/UI.** Test each function group and account policy before moving forward.
6. **Owner release.** Owner alone deploys the frontend/function after SQL smoke tests and sends verification results.

**Current first stop:** S1 files are prepared and awaiting owner execution. No S2 or tenant code/schema is implemented.

## 19. Owner decisions recorded

1. **One person, multiple shops:** No; one shop per Admin/user.
2. **Super Admin business-data access:** No. Super Admin manages only shops, Admin accounts, and permissions; it cannot read/write shop business rows. This supersedes the earlier catalog-seeding exception.
3. **Platform owner/support access:** No routine business-data access. Emergency access only, explicit and audited where technically possible.
4. **Suspension:** Block sign-in and business operations; preserve data.
5. **Licence/billing dates:** Defer until needed.
6. **Permissions:** Super Admin explicitly grants each Admin's pages/features; Shop Admins may assign staff only a subset of their own grants. Role defaults do not grant modules. Shop identity remains Super-Admin-managed.

## 20. Related dependencies and assumptions

- `complete_sale`/sale persistence, purchase posting, barcode assignment, discount validation, trash, print requests, alerts, imports, and exports must all use the server-derived shop.
- POS, customer ledger, cashbook, controlled-drug log, and other mock/in-memory workflows cannot provide real tenant isolation until durable server-backed workflows replace them.
- All business-table/function inventories in this document are expected categories only. Staging verification may reveal additional objects; reconcile rather than omit them.
- A database/project operator with SQL access can technically access underlying data. The app's Super Admin restriction is not a substitute for infrastructure controls, audited emergency access, backups, or contractual privacy terms.
