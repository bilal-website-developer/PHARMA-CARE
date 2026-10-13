# Pharma Care — Full Multi-Shop Plan

**Status:** Planning only. This document makes no code, SQL, migration, or deployment changes. Execution remains blocked at the staging comparison in [STAGING_BOOTSTRAP.md](./STAGING_BOOTSTRAP.md). Do not use the current project as staging or treat checked-in migrations as proof of live application.

**Source of truth:** This document expands the tenant-specific design in [MASTER_PLAN.md](./MASTER_PLAN.md). If details appear inconsistent, use the execution gates and protected-helper approvals in `MASTER_PLAN.md` until the documents are reconciled. [EXECUTION_PROGRESS.md](./EXECUTION_PROGRESS.md) records actual work-package state.

## 1. Goal and security rules

1. Each shop has one owner Admin. Each user/profile belongs to exactly one shop; multi-shop memberships are out of scope.
2. A shop's products, suppliers, customers, stock, purchases, sales, expenses, reports, print requests, trash, settings, and business activity are private to that shop.
3. Shop separation is enforced in database policies, RPCs, Edge Functions, storage policies, and server-derived identity—not just in UI filtering.
4. The platform Super Admin manages shops and account metadata, but has no general access to shop business data.
5. A narrowly scoped exception allows the Super Admin to add products or suppliers through a separate, logged action that targets one explicitly selected shop. It does not grant general browsing or editing access to that shop's business data.
6. Cashiers never receive cost, profit, or margin. Preserve the existing revokes on the five cost-bearing tables; no tenancy work may widen access to them.

## 2. Current state and evidence limits

- **Exists:** a shared-project tenancy proposal and staging-first gate in `MASTER_PLAN.md`; a staging bootstrap and metadata-only catalog comparison in `STAGING_BOOTSTRAP.md`.
- **Exists:** role-based user management and shop-profile/receipt fields in the UI. The current profile and some receipt fields are browser-local, not authoritative per-shop server data.
- **Exists, needs change:** Admin roles currently receive all modules by role. Settings is Admin-only; it is not an independently selectable staff permission. The profile permission constraint must be inspected and updated for the new permission.
- **Missing:** shop records, profile/table `shop_id` ownership, tenant-filtered policies and business RPCs, server-backed per-shop shop identity/settings, two-shop isolation implementation/tests, and platform Shops management.
- **Missing:** durable Auth-to-shop provisioning/recovery workflow, shop suspension enforcement, per-shop receipt identity snapshots, and targeted/audited Super Admin catalog seeding.
- **Unknown until staging comparison:** exact live table, policy, constraint, trigger, index, and function inventories; whether they match the reconstructed baseline and checked-in migrations; and which migrations have been applied.

Counts of tables, functions, policies, and triggers are **inventory counts to measure and verify on staging**, not fixed facts. Build the inventory from CURRENT and STAGING catalog results and reconcile every difference before designing migrations. Do not rely on a hard-coded function count or assume the reconstructed baseline is exhaustive. Audit every `SECURITY DEFINER` routine individually.

## 3. Ownership and shop identity

Create a shop record with an immutable ID, owner Admin profile, shop name, phone, address/location, receipt identity/settings, status, creator, timestamps, and any approved logo reference. A shop Admin and all staff belong to exactly that shop. The platform Super Admin has no tenant `shop_id`.

Use one authoritative server-backed shop profile for the shop name and receipt identity. Only the Super Admin may create or edit those identity fields. Shop Admins and staff can read their own shop's identity but cannot change it. Remove browser-local copies of shop name, address, phone, or receipt identity as sources of truth; keep unrelated UI/device preferences local where appropriate.

Keep the logo. In the highlighted header area, show the configured shop name alongside the existing logo instead of the fixed Pharma Care/WhatsApp Reminders branding text. Keep the WhatsApp Reminders feature and sidebar navigation; this is a header-branding change, not removal of the feature.

When the Super Admin creates or edits a shop Admin, show the shop-profile fields in that Admin's form. Later profile changes remain editable only by the Super Admin and are audited.

## 4. Server-derived shop context

- Add a fixed-search-path `current_shop_id()` (or equivalent) that derives the caller's shop from trusted server-side profile state.
- Do not trust `shop_id` from URL, request body, form state, or user-editable `user_metadata`. Ignore or reject caller-supplied shop IDs.
- A caller with no shop must be denied business operations unless the operation is a specifically authorized platform metadata or targeted seeding operation.
- Do not put trusted tenancy solely in mutable client claims. Verify profile/shop status on the server and define token/session invalidation behavior for suspension.

## 5. Shop-owned data and isolation surface

The staging inventory must identify every actual relation and classify it as shop-owned, platform metadata, or shared reference data. Expected shop-owned families include:

- Catalog: medicines, medicine units, categories, brands.
- Contacts and ledgers: suppliers, supplier ledger, customers, khata entries.
- Inventory and procurement: stock batches, stock movements, purchases, purchase items, purchase number state.
- Sales and accounting: sales, sale items, batch allocations, sale payments, expenses/cashbook, controlled-drug records.
- Operations: print requests, tenant audit events, trash/restore events, alert state, per-shop settings, barcode registry/counters, and any additional tenant-owned tables discovered during staging inventory.

Every shop-owned row must be scoped by `shop_id` directly or through a verified parent relationship, with same-shop foreign-key integrity. New records receive server-derived ownership. Add `shop_id` indexes and common composite indexes only after verifying existing access patterns and indexes.

Scope list/detail/search/count/statistics, dashboards, exports, imports, bulk actions, trash, receipt requests, audit views, and storage paths—not only the main list pages. No API may reveal cross-shop existence by error differences or counts.

## 6. Policies, RPCs, and Edge Functions

Create staging-verified inventories of all relations, grants, RLS policies, views, triggers, and routines, including overloads and function owners/security settings. Counts are to be recorded as discovered; do not assume a fixed number.

For every relevant policy, preserve required permission predicates while applying same-shop `USING` and `WITH CHECK` rules. For every function/RPC, audit all reads, writes, joins, nested IDs, aggregates, exports, and audit payloads. `SECURITY DEFINER` functions must derive the caller/shop server-side, validate active shop membership and permission, enforce same-shop references, use a fixed search path, and retain least-privilege EXECUTE grants.

The `manage-users` Edge Function uses elevated credentials and must explicitly enforce platform-versus-shop role boundaries on every action. Its rules and negative tests must cover list, create, edit, deactivate, delete/restore, role assignment, permissions, last-admin handling, and cross-shop identifiers.

Do not change `is_staff()`, `is_admin()`, `has_any_permission()`, or existing RLS semantics without the exact current/proposed definitions, call-site review, and the owner approval required by `MASTER_PLAN.md`.

## 7. Accounts and provisioning/recovery

- The Super Admin creates, edits, suspends, and soft-deletes shops and their owner Admin accounts. It sees shop/account metadata, not shop business data.
- The Super Admin may add catalog products/suppliers only through separate, explicitly target-selected and audited operations. No general shop data browsing or modification follows from this exception.
- A shop Admin can manage only staff in their own shop and cannot create another Admin or Super Admin. Staff cannot change shop membership through UI or API.
- Enforce the last active shop Admin rule per shop and protect the last active platform Super Admin globally.
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

- Shop Admins retain every module permission for their own shop; they cannot edit the shop identity or access another shop.
- Add a Settings checkbox for staff roles (Manager, Cashier, Accountant) so access to the Settings page can be granted or withheld per user. Enforce it in navigation, page access, and server operations where settings are written.
- Settings permission covers permitted operational preferences only. Shop name, phone, address, receipt identity, logo, and other Super Admin-owned profile fields remain immutable to shop users regardless of their Settings access.
- This rule replaces the existing Master Plan permission design where it conflicts: `MASTER_PLAN.md` must be updated to match. Admin module access stays role-based/all-own-shop; staff Settings access is selectable.
- Inspect the live `profiles.permissions` constraint on staging. Add `settings` to the permitted key set with a reviewed forward migration and rollback. Do not assume the supplied baseline constraint matches the live project.
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

## 12. Barcode and Super Admin seeding

Existing barcode UI and assignment are not yet shop-aware. After schema/backfill work, replace the global medicine-only barcode index and sequence with a per-shop registry covering both medicines and units. Preserve cost confidentiality and reject collisions rather than silently reassigning manufacturer codes.

The Super Admin seeding exception is a separate target-shop workflow, not access to shop Products/Suppliers pages. Require explicit shop selection, validate the target is active, write only to that shop, audit actor/target/action/results, and test that the response does not leak that shop's unrelated records. Define whether seeding can create catalog rows only or also edit/deactivate before implementation; default to create-only.

## 13. Shop status and deletion

A suspended shop's users cannot sign in or perform business operations; verify this at authentication/session and server-function boundaries, not only by hiding pages. Preserve its data. Shops are soft-deleted, not hard-deleted. A deletion cannot erase business history. Licence/renewal and billing dates are deferred.

## 14. Audit and storage

Audit identity changes, Admin account changes, suspension/deletion, provisioning compensation, orphan cleanup, support access, and Super Admin catalog seeding. Include actor, target shop, timestamp, operation, outcome, and safe before/after data; never log passwords, tokens, or secrets.

If a shop logo is stored in Supabase Storage, use a per-shop path and least-privilege policies. Only the Super Admin may change the shop identity/logo; tenant users may read only the asset for their own shop.

## 15. Backfill and uniqueness cutover

Create one initial shop owned by the selected existing Admin and assign every existing business row/profile to it. Before making `shop_id` required, verify parent references, row counts, nulls, duplicates, totals, and audit/print history on staging. Stop on mismatches; do not guess ownership or silently merge records.

Backfill a single per-shop barcode registry across `medicines.barcode` and `medicine_units.barcode`. If the legacy global index exists, replace it only after normalized duplicate checks and a rollback-safe migration are reviewed.

## 16. Production and rollback

No production migration until:

1. CURRENT and STAGING catalog results are reviewed and differences reconciled.
2. ACL prerequisites are reconciled and approved.
3. Multi-shop migrations and Edge Function changes pass on staging.
4. Two-shop isolation and recovery tests pass; the owner accepts results.
5. A production backup/restore plan, migration order, matching rollback files, and go/no-go checks are reviewed.

The owner applies SQL and deploys functions. Do not run SQL or deployment commands on the owner's behalf. Rollbacks must preserve business rows, avoid recreating unsafe global indexes, and define what happens to partial provisioning or new tenant records.

## 17. Automated and manual verification

Use at least two shops, each with an Admin, Manager, and Cashier. Automated negative tests must verify:

- Every discovered shop-owned table, policy, RPC, Edge Function, import/export, count, and storage path refuses cross-shop reads/writes/deletes, including guessed IDs and forged `shop_id`/`user_metadata`.
- Shop Admin user management, role assignment, last-admin constraints, Settings permissions, and Super Admin platform boundaries.
- Super Admin seeding can only write to the selected shop and is logged; it cannot read unrelated shop business data.
- Cost, profit, and margin remain unavailable to Cashier in screens, RPC results, receipts, and exports.
- Suspension blocks sign-in and server operations; deletion preserves history; incomplete Auth/Postgres provisioning is compensated or surfaced for cleanup.
- Per-shop identifier uniqueness and sequential numbering under concurrent requests, rollback, retries, and failures. Test gap-free separately before making that promise.
- Shop profile changes affect new prints but not old receipt snapshots.

Owner-controlled staging/live schema checks, function deployments, and physical scanner/printer tests remain unverified until evidence is provided.

## 18. Work order and current blocker

Follow the established order in `MASTER_PLAN.md` and `STAGING_BOOTSTRAP.md`:

1. **Staging bootstrap and catalog comparison.** Owner builds a separate, disposable staging project using the explicit forward-migration list, then returns the SELECT-only `CURRENT` and `STAGING` catalog results. Do not write or apply multi-shop migrations before review.
2. **W1 ACL reconciliation.** Compare live/staging grants and owner migration history; determine the smallest required ACL forward migrations/rollbacks. Keep optional `supabase_admin` statements separate and preserve all cost-table revokes.
3. **Multi-shop design and migrations on staging.** Inventory objects/counts, resolve differences, show protected helper/RLS changes for approval, then write and review migrations plus rollbacks. Apply to staging only, one at a time, with checks.
4. **Tenant-aware functions, Edge Function, UI, and operational features.** Implement in dependency order and run two-shop isolation, permission, provisioning-recovery, receipt, and concurrency tests on staging. The barcode client-only package is already complete; tenant-aware barcode registry remains pending.
5. **Staging acceptance.** Review every migration result and test report. Stop on any mismatch. Do not infer production status from staging.
6. **Production release.** Only after explicit owner approval, verified backup/restore, reviewed migration/rollback sequence, and staging acceptance. The owner applies migrations/deploys and reports verification.

**Current first blocker:** Package 1 in `EXECUTION_PROGRESS.md` is waiting for the owner to build staging and return catalog results. ACL reconciliation and all multi-shop schema work remain blocked until those results are reviewed.

## 19. Owner decisions recorded

1. **One person, multiple shops:** No; one shop per Admin/user.
2. **Super Admin catalog seeding:** Yes, but only as a separate, explicitly selected, audited action for one target shop; no general shop data browsing. Create-only is the safe initial scope; confirm any edit/deactivate capability before implementation.
3. **Platform owner/support access:** No routine business-data access. Emergency access only, explicit and audited where technically possible.
4. **Suspension:** Block sign-in and business operations; preserve data.
5. **Licence/billing dates:** Defer until needed.
6. **Settings permission:** Selectable for staff roles. Shop Admins retain all modules within their own shop, but cannot edit shop identity. This replaces the conflicting permission design in `MASTER_PLAN.md`.

## 20. Related dependencies and assumptions

- `complete_sale`/sale persistence, purchase posting, barcode assignment, discount validation, trash, print requests, alerts, imports, and exports must all use the server-derived shop.
- POS, customer ledger, cashbook, controlled-drug log, and other mock/in-memory workflows cannot provide real tenant isolation until durable server-backed workflows replace them.
- All business-table/function inventories in this document are expected categories only. Staging verification may reveal additional objects; reconcile rather than omit them.
- A database/project operator with SQL access can technically access underlying data. The app's Super Admin restriction is not a substitute for infrastructure controls, audited emergency access, backups, or contractual privacy terms.
