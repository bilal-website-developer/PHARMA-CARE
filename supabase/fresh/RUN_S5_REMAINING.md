# S5 remaining SQL package: owner runbook

**Completion status: owner-reported complete.** The owner reports the 051 dry
run and 052 apply succeeded, all six 053 smoke checks passed, and 054 returned
`unscoped_business_count = 0`. Do not rerun these scripts as part of S6.
This runbook is retained for audit/history; the assistant did not run SQL.

This package is for the reviewed live schema only. It is not a full migration
replay. Paste each complete file into the Supabase SQL Editor and run it as one
script; there are no `psql \i` includes. Do not connect through another tool,
deploy, or edit the SQL in the middle of a run.

Files 040–043 are source fragments included in the combined scripts. Do not
run those four files individually.

## Historical preconditions (already reported complete)

1. Confirm the intended Supabase project and that the previous S5 batches,
   including 039 and 050H, have already passed their owner-run smoke tests.
2. Open `050_s5_remaining_preflight.sql`, paste its entire contents, and run it.
   Review all four JSON result cells (050A–050D). Stop if any target definition,
   signature, grant, shop count, counter state, reference count, or row total
   differs from the reviewed facts in `docs/PROJECT_CONTEXT.md`. Do not guess
   at a live-schema difference.
3. Keep the SQL Editor tab set to run the full script, not only the current
   statement. SQL Editor may display “Success. No rows returned” for DDL and
   transaction scripts; this is normal. Warnings/notices are not a PASS if an
   exception occurred.

4. Before changing the schema, run this read-only check for the print smoke-test
   account. If it returns `0`, stop and report that result before running the
   dry run or apply script; do not change any user's role or permissions:

   ```sql
   WITH primary_shop AS (
     SELECT shop_id
     FROM public.profiles
     WHERE role = 'admin'
       AND is_active
       AND deleted_at IS NULL
       AND shop_id IS NOT NULL
     ORDER BY id
     LIMIT 1
   )
   SELECT count(*) AS eligible_pos_profile_count
   FROM public.profiles AS profile
   JOIN primary_shop ON primary_shop.shop_id = profile.shop_id
   WHERE profile.is_active
     AND profile.deleted_at IS NULL
     AND profile.role IN ('cashier', 'manager')
     AND coalesce(profile.permissions, '{}'::text[]) @> ARRAY['pos']::text[]
     AND NOT (
       coalesce(profile.permissions, '{}'::text[])
       @> ARRAY['pos_print_sale']::text[]
     );
   ```

## Historical execution sequence (do not repeat)

1. Paste and run all of `051_s5_remaining_dry_run_all.sql`. It runs groups
   040–043 in order in one serializable transaction and ends with `ROLLBACK`.
   Expect success with no result rows. Any exception means the dry run failed:
   stop, capture the error, and do not apply.
2. Paste and run all of `052_s5_remaining_apply_all.sql`. It runs the same four
   groups in one serializable transaction and ends with `COMMIT`. Expect
   success with no result rows. The preflight guards deliberately stop if
   reviewed live facts changed.
3. Paste and run all of `053_s5_remaining_smoke_all.sql`. Expect one result
   table with `status = PASS`. It creates synthetic fixtures and a synthetic
   second shop, briefly reassigns one existing Shop Admin profile, and ends
   with `ROLLBACK`; no fixture or reassignment persists. The profile row stays
   locked while this test runs. The test requires two active Shop Admins in
   the same shop and an active non-admin POS profile that is not allowed to
   print sale receipts directly. The earlier profile count confirmed the two
   Admins; the separate read-only check above confirms the POS-profile
   prerequisite. The smoke script also checks both before creating fixtures.
   Do not substitute a different identity or change a role to force the test.
4. Paste and run all of `054_s5_final_catalog_check.sql`. It is read-only.
   Review the full routine listing and require the final
   `unscoped_business_count` to be `0`. Global profile/permission helpers,
   trigger routines, and service-only helpers are reported separately from
   shop-business functions.

## What these groups change

- 040 scopes the five purchase RPCs and changes the counter key from one global
  singleton to one row per shop. Existing PR numbers and the valid unique
  `(shop_id, pr_no)` index are retained.
- 041 scopes six print-request RPCs, retains the live `request_print` response
  redaction of `shop_id`, and makes pending receipt references unique per shop.
- 042 scopes Trash listing, restore, and permanent-delete routines and repairs
  `restore_trash_medicine(p_medicine_id)`. It does not redefine or broaden
  `trash_bin_finalize_profile_purge`; that grant remains service-role-only.
- 043 scopes the existing `stock_alerts_summary(integer)` only. It does not
  add `stock_alerts_list()`.

## Failure and rollback

If a statement fails, SQL Editor may leave the transaction aborted/open.
Issue `ROLLBACK` in that editor session and stop. Do not continue with later
groups or assume an incomplete run applied. Re-run the read-only preflight and
inspect the catalog before deciding what to do next.

If a post-apply check requires rollback, run these complete rollback files in
reverse order, one at a time: `043_s5_stock_alerts.rollback.sql`,
`042_s5_trash_audit.rollback.sql`, `041_s5_print_rpcs.rollback.sql`, then
`040_s5_purchase_rpcs.rollback.sql`.

These are safety rollbacks: they disable the affected APIs rather than restore
their known-unscoped implementations. They intentionally leave the per-shop
purchase-counter key and the per-shop pending-print index in place. Purchase,
print, Trash, or alert features may therefore be unavailable after rollback;
do not try to manually reconstruct the former global counter or uniqueness
rules. Restoring functionality requires a separately reviewed, shop-scoped
forward replacement. The rollback does not alter the profile-purge routine or
its service-only grant.

The assistant has not connected to the database, run SQL, deployed, pushed, or
committed anything. All SQL must be run and verified by the owner.
