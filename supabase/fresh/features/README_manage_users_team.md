# Legacy Manage Users / Team SQL draft

**Do not run the migration, test, or rollback in this folder.** The draft
predates the completed S5 package and replaces `trash_bin_events_list()` with
an implementation that does not retain S5 shop scoping. Running it could
reintroduce cross-shop access. It is retained only for reference while S6 is
rebuilt against the live schema.

The owner reports that preflights 060/061 were run and S6 package 062's smoke
and final checks passed. The next read-only inventory is
[`063_s6_accounts_shop_preflight.sql`](../063_s6_accounts_shop_preflight.sql).
Review its current routine definitions, shop/profile columns, triggers, policies,
and grants before preparing any later S6 database change. These checks return
catalog definitions and aggregate counts only; do not share account names,
emails, IDs, credentials, or keys.

The owner-run S6 preflight shows that S6-related database objects are already
partially present; their migration provenance and prior tests are unknown. The
assistant has not run live SQL. The old draft must not be treated as an
approved migration or as a source of current live schema facts. The owner
provided query 063 output: `profiles.created_by`,
`manage_users_current_active_profile_role()`, and
`manage_users_team_member_access(...)` already exist; there is one active shop,
two active Admins, and two active platform Super Admins. The current status
function counts Admins globally, not per shop. There are no `shop_settings`,
`admin_private_notes`, or `shop_provisioning_operations` tables yet.

Package 064 is at `../064_s6_manage_users_transactional_admin_guard.sql`.
It replaces the status RPC with a per-shop transactional Admin-count guard,
adds a service-role-only profile-update RPC using the same account lock, and
includes a rollback-only smoke test, final metadata check, and rollback. The
owner shared PASS outputs for the smoke and final checks; confirm package 064
is applied before deploying Manage Users API v4. Do not run the legacy
migration, smoke test, or rollback in this folder.
