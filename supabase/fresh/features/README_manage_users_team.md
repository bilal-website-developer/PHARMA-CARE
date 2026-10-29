# Admin team access-control SQL drafts

These are reviewed drafts only. No SQL has been run, and the Edge Function has
not been deployed. Do not apply the migration, rollback, or test until the
owner explicitly approves a test window.

## SQL Editor order

1. For a dry run, open `202610290002_manage_users_team.sql` and copy its full
   contents. Submit one script containing `BEGIN;`, the migration contents,
   the full contents of `202610290002_manage_users_team.test.sql`, and finally
   `ROLLBACK;`. The migration file intentionally has no transaction boundary,
   so the test observes its changes before the rollback. Do not substitute
   `COMMIT;`.
2. A successful dry run has no SQL errors and returns one JSON result row. The
   column, foreign key, index, scoped read policy, and both functions should
   report `true`; the access RPC should be service-role-only; the authenticated
   profile write-policy count should be `0`; the authenticated profile
   select-policy count should be `1`; and, before this migration is ever
   applied, all existing profiles should remain unassigned.
3. If the owner later approves applying this draft, run the migration contents
   once inside `BEGIN; ... COMMIT;`, then run the test file by itself. Do not
   deploy the Edge Function before its required database RPC exists.
4. After an approved migration, deploy the compatible `manage-users` Edge
   Function before the frontend. The frontend fails closed if it receives an
   older API response.
5. Run `202610290002_manage_users_team.rollback.sql` only after a committed
   migration, with explicit owner approval, and only if `created_by` has no
   assigned values. The rollback deliberately stops rather than discard
   attribution.

## What to report back

For the dry run, paste the single JSON test result, whether the script completed
without errors and ended with `ROLLBACK`, and any specific SQL Editor warning.
Do not paste credentials, keys, names, email addresses, or account IDs. The SQL
Editor may show an RLS/security confirmation popup; for these reviewed
statements, click **Run this query**. Do not select an option to disable RLS or
broaden access.

## Assumptions to verify before applying

- The live `profiles` table has the referenced profile columns and currently
  uses the baseline policy names, and the live `trash_bin_events_list()` body
  matches the checked-in definition used by rollback. Any other authenticated
  profile SELECT policy could broaden visibility; the test reports the policy
  count and the dry run must be stopped if it is not exactly one.
- The live `audit_logs` and `trash_bin_events` tables have the columns and
  constraints used by the access RPC, and Supabase's `auth.role()` is available.
- Existing profiles are intentionally left with `created_by = NULL`; do not
  infer or backfill owners. Super Admin will see those users as **Unassigned**,
  while Admins will not see them in their own team.
- The new profile read policy may cause an Admin's existing print-request view
  to show **Unknown user** for requesters outside that Admin's team. Non-profile
  business events in Trash Bin retain their existing visibility behavior.
- Account status is reflected in both Auth bans and profile flags. The Edge
  Function compensates the Auth ban/unban if the database RPC fails; an Auth
  rollback failure is surfaced and requires operator review.
- The profile Trash Bin restore action remains separate and is restricted to
  Super Admin. Other tenant-wide business-data and Trash Bin visibility rules
  are outside this draft.
