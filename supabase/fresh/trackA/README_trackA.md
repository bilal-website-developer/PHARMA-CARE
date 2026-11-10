# Track A run order

Use the files in this folder in this exact order.

## 1) A1: function lockdown
1. Open the SQL Editor.
2. Paste the contents of `001_revoke_anon_public_execute.sql` inside:
   `BEGIN;`
   ...
   `ROLLBACK;`
3. Run the dry run.
4. If the final verification query returns zero rows, then run the same SQL again without the `ROLLBACK;`.
5. Success means: no rows in the final verification result and the app still loads for authenticated users.
6. If the dry run errors, stop; its transaction will not persist any changes. If a committed run later breaks the authenticated app, run `001_revoke_anon_public_execute.rollback.sql` and stop for review.

The current Q6 inventory shows anon/PUBLIC EXECUTE on 16 routines. The script now uses the live six-argument `save_supplier(uuid,text,text,text,text,text)` signature and its rollback restores the observed per-function grants without broadening anon-only grants to PUBLIC. The final check excludes trigger functions and the internal `can_view_cost()` and service-role-only `manage_users_team_member_access(uuid,uuid,text)` helpers.

## 2) S2 table and sequence ACL lockdown

The owner-reported live catalog check confirms A1 has no remaining anon/PUBLIC function EXECUTE. It also confirms authenticated still has direct business-table writes/extra privileges and `medicine_barcode_seq` access. Use the separate S2 package below; do not rerun the full Trash Bin migration. Its table, indexes and triggers exist, but `restore_trash_medicine(uuid)` is absent from the live catalog and must be handled as a separate repair.

1. In `003_revoke_authenticated_table_privileges.sql`, revoke only the listed direct table/sequence privileges. The rollback restores the owner-reported pre-run grants.
2. To dry-run, paste `ROLLBACK;` first (to clear any prior failed open transaction), then `BEGIN;`, the full contents of `003_revoke_authenticated_table_privileges.sql`, the full contents of `003_revoke_authenticated_table_privileges.test.sql`, and finally `ROLLBACK;` into one SQL Editor query and run once. The test query selects from its `checks` CTE.
3. The single test result must return `all_passed: true` and every check `true`. If the script errors or any check is false, stop and send the error/result. The dry-run persists no changes.
4. After the dry-run result is reviewed, the committed run is the same paste, replacing only the final `ROLLBACK;` with `COMMIT;`. Do not include an additional BEGIN/COMMIT from another file.
5. After commit, run only read-only authenticated page checks: login, Dashboard, Products, Suppliers, Purchase History, Stock Inventory and POS catalog. Do not post a sale, purchase, or stock adjustment. Stop on any error.
6. If a committed run breaks expected app access, stop and review before using `003_revoke_authenticated_table_privileges.rollback.sql`. Do not automatically run rollback.

The script preserves profile/supplier SELECT and own-row favorites/sidebar preference CRUD, removes authenticated direct writes and excess table privileges from the listed business tables, removes API-role access to cost-bearing tables, and revokes direct barcode-sequence access. It does not change RLS policies or function definitions.

## 3) Smoke test after A1
- Run the checklist in `SMOKE_TEST.md` immediately.
- If anything fails, stop and restore the rollback.

## 4) Optional A2: default privileges hardening
1. Run `002_default_privilege_preflight.sql` and return its complete result before applying either default-privilege script.
2. Review both `<global>` and `public` defaults in that result. The current Q6 inventory covers only `public` and is not sufficient to construct an exact rollback for global PUBLIC function defaults.
3. If approved after that review, confirm the active role and membership, then apply only the corresponding default-privilege script.
4. Do not use either rollback until its grants have been checked against the preflight result and the rollback has been confirmed for that baseline.

The Q6 output shows that future functions created by `postgres` currently default to anon/authenticated EXECUTE, and future sequences default to authenticated access. A separate `supabase_admin` default ACL also grants anon/authenticated access to future tables, sequences, and functions. The preflight also reports whether the SQL Editor role can manage `supabase_admin` defaults. Run `20261012140500_optional_lockdown_supabase_admin_defaults.sql` only after reviewing that output and only if membership is `true`; it now stops with an explicit error if the role membership is absent. Its matching rollback is `supabase/rollback/rollback_20261012140500_optional_lockdown_supabase_admin_defaults.sql`.

`002_default_privileges.sql` also revokes default function EXECUTE from PUBLIC for the selected creator role, across schemas. Do not apply it until the preflight baseline and the corresponding rollback behavior are explicitly reviewed.

## 5) A3 test-data cleanup — not prepared

There is no reviewed A3 backup/cleanup SQL package in this repository. Older references to `010_backup_to_schema.sql` and `011_clean_test_data.sql` are placeholders and those files do not exist here. Do not construct or run cleanup SQL until the retained-account/data keep-list is confirmed, a fresh recovery snapshot is verified, and forward/rollback/smoke-test scripts have been reviewed.

## 6) Smoke test after cleanup
- Run `SMOKE_TEST.md` again after A3.

## Important SQL Editor notes
- The Row Level Security popup appears only when creating tables or enabling RLS. Choose `Run and enable RLS` when prompted.
- Apply A1 at a quiet time because it changes function execution rights.
- Do not deploy from this folder. The assistant does not execute SQL; the owner runs each approved stage and returns its verification result before continuing.
- Keep Track B and any pack-size drafts off.
- Do not drop or edit existing data or policies unless approved.
