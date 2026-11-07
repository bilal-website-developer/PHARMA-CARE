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
6. If anything fails, run `001_revoke_anon_public_execute.rollback.sql`.

## 2) Smoke test after A1
- Run the checklist in `SMOKE_TEST.md` immediately.
- If anything fails, stop and restore the rollback.

## 3) Optional A2: default privileges hardening
1. Run `SELECT current_user, session_user;` first.
2. If you want the optional default-privilege guard, run `002_default_privileges.sql`.
3. This is optional because it only targets future objects created by the connected SQL Editor role.
4. If it causes side effects, use `002_default_privileges.rollback.sql`.

## 4) A3 cleanup (only after query 1, 4, 5, 6 and 7 are pasted back)
- Do not run `010_backup_to_schema.sql` or `011_clean_test_data.sql` until you confirm the backup tables and the keep-list are approved.
- The cleanup plan is described in the project notes and must be approved before execution.

## 5) Smoke test after cleanup
- Run `SMOKE_TEST.md` again after A3.

## Important SQL Editor notes
- The Row Level Security popup appears only when creating tables or enabling RLS. Choose `Run and enable RLS` when prompted.
- Apply A1 at a quiet time because it changes function execution rights.
- Do not run any SQL on main or deploy from this folder.
- Keep Track B and any pack-size drafts off.
- Do not drop or edit existing data or policies unless approved.
