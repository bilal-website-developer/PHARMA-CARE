# S6 shop controls and account-management gate

This runbook prepares the remaining S6 source package. The assistant does not execute SQL, deploy functions, or change the applied S4 policies.

## Current gate

- Owner reports S5 050F, 050H, 053, and 054 PASS.
- Owner reports S6 packages 062, 064, 066, 067, and 068 passed their supplied checks. Do not rerun or replace those packages.
- Owner reports package 069's corrected apply sequence reached a passing 071 final check, including all 27 write guards, and the corrected rollback-only smoke test passed. The first smoke attempt stopped at the existing return-settings RPC's P0001 denial before exercising the package write trigger; the local test was changed to perform a no-op table update to target that trigger. The Edge Function and frontend are not deployed.
- Two-shop acceptance, explicit Print Requests/Trash authorization review, and live UI checks remain release gates.

## Owner-run order

1. In Supabase SQL Editor, run `070_s6_aggregate_dry_run.sql`. Continue only if the single result is `READY`. It checks prerequisites without returning shop IDs or profile data. Package 069 performs additional transactional preflight checks, including incomplete provisioning.
2. Run `069_s6_platform_shop_controls.sql` once. It is the apply package; it runs transactionally and raises on a failed postflight. It adds shop account limits, service-only platform controls, immediate suspension lockout, and safe provisioning recovery states. It does not rewrite any applied S4 RLS policy or `tenant_private.current_shop_id()`. If a previous attempt failed, rerun 070 first; continue only if it returns `READY` and confirms package 069 is absent. If 070 returns `STOP` or shows partial presence, stop and investigate rather than replaying the apply.
3. Run `069_s6_platform_shop_controls.test.sql` as the reviewed database-owner role. It is rollback-only and must emit the `PASS` notice before its transaction rolls back. The owner reports the corrected test passed.
4. Run `071_s6_aggregate_final_check.sql`; require `status = PASS`. The owner reports this check passed, with 27 expected and 27 installed write guards.
5. Run `072_s6_shop_logo_storage.sql` once if shop-logo uploads are required. It creates a public-read bucket for PNG/JPEG/WebP files up to 2 MB; only active platform Super Admins can upload, replace, or delete objects. It refuses to apply if an existing authenticated/public Storage write policy could conflict. Run `072_s6_shop_logo_storage_final_check.sql` and require `PASS`.
6. Only after the SQL gates pass, the owner may deploy the matching `manage-users` Edge Function and frontend. Confirm the deployed function returns API version 5 before using Manage Users and Shops.
7. Complete the app acceptance checklist below. Stop on any cross-shop visibility, unauthorized access, incomplete compensation, or mismatch.

Never paste credentials or service-role keys into SQL, the browser, source, or this runbook. Do not rerun 062/064/066/067/068 as an aggregate.

## Supabase Dashboard checklist before release

- **Authentication → Providers:** keep only the intended sign-in providers enabled and verify the configured email/password flow.
- **Authentication → Multi-Factor Authentication:** enable the chosen MFA method and require the project’s approved assurance level for platform Super Admins. Enroll and test every platform Super Admin before relying on privileged account actions.
- **Authentication → Sign-in / Sign-up:** disable public self-registration. New shop Admin Auth accounts are created only by the server-side provisioning action; the Admin must change the temporary password at first login.
- **Authentication → URL Configuration:** set the exact production Site URL and allow only the required production, staging, and local development callback origins. Remove obsolete and wildcard redirect entries; test login, password change, and sign-out redirects on each approved origin.
- **Edge Function secrets:** ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available only to the Edge Function runtime. Never expose the service-role key through a `VITE_*` variable.
- Verify the selected Supabase project/ref and backup/recovery readiness before applying owner-run SQL.

Dashboard settings are owner-controlled and were not inspected or changed by this work.

## App acceptance checklist

- Sign in as a platform Super Admin: `/shops` is available; shop IDs and private Admin notes appear only in platform management; business pages and shop data remain inaccessible.
- In Shops, verify directory rows are collapsed until Edit is selected; save shop identity, limits, and the sole Admin's explicit page grants. Upload a PNG/JPEG/WebP logo and confirm it appears; verify non-Super-Admin accounts cannot upload, replace, or delete shop-logo objects.
- Sign in as an active Shop Admin and staff user: only the assigned shop and explicitly granted modules are available. The Manage Users Edge Function must enforce the explicit `manage_users` grant for Shop Admins, not just hide the page in the UI. Shop identity is read from the server; ordinary shop users cannot edit it.
- Suspend a test shop: its users lose sign-in/business access immediately. Reactivate it and verify access returns. Deletion remains soft and preserves business history.
- Create a test shop through `/shops` with a unique Admin email and username. Verify exactly one shop, Admin profile, initial settings, and return-policy row are linked; repeat the same operation ID after a simulated lost response and verify no duplicate shop or Auth user is created.
- Verify the first Admin is forced to change the temporary password, can complete that action, and cannot use Manage Users actions before completing it.
- Verify private Admin notes are readable/writable only to a platform Super Admin and never returned in tenant user responses.
- Verify account limits are enforced atomically by the database and that all staff roles share one staff cap.
- Run two-shop positive and negative checks for shop identity, accounts, products, customers, ledger, sales, purchases, print requests, Trash, and settings. Confirm a platform Super Admin is denied business data.
- Review Print Requests and Trash authorization separately; they are not made complete by this package.

## Rollback

If package 069 fails before commit, its transaction should roll back. Confirm the live state with 070 before retrying. If it commits but the rollback-only smoke or final check fails, stop and investigate before deploying.

`069_s6_platform_shop_controls.rollback.sql` is owner-run only after package 069 is installed and only when every shop is active, all account limits are back at defaults, and no provisioning operation is incomplete. Its preflight intentionally blocks rollback when suspension or non-default limits would be lost. Do not bypass that guard or alter rows manually to force rollback. The rollback does not change S4 policy definitions or `tenant_private.current_shop_id()`, and it leaves package 066/067/068 objects in place.

`072_s6_shop_logo_storage_rollback.sql` is owner-run only after the logo bucket is empty. It refuses to delete the bucket while any logo objects remain.

## Files and validation

- Existing owner-run prerequisites: `../060_s6_accounts_ui_preflight.sql` through `../068_s6_scoped_shop_settings_functions_*`.
- New apply/rollback/smoke: `069_s6_platform_shop_controls.sql`, `069_s6_platform_shop_controls.rollback.sql`, `069_s6_platform_shop_controls.test.sql`.
- New aggregate gates: `070_s6_aggregate_dry_run.sql`, `071_s6_aggregate_final_check.sql`.
- New logo storage setup/check/rollback: `072_s6_shop_logo_storage.sql`, `072_s6_shop_logo_storage_final_check.sql`, `072_s6_shop_logo_storage_rollback.sql`.
- Related source: `src/components/ShopsView.tsx`, `src/components/ManageUsersView.tsx`, `src/components/TopNav.tsx`, `src/utils/auth.ts`, `supabase/functions/manage-users/`.
- Local validation: `npm run lint`, `npm test`, `npm run build`, and `git diff --check`. These do not validate or execute SQL. No SQL parser/runtime check, SQL execution, deployment, push, merge, or branch creation has been performed.

## Assumptions requiring owner confirmation (`ASSUMED`)

- New shops default to 10 Admin profiles and 100 combined staff profiles; configurable maxima are 50 Admin and 500 staff. Inactive and removed profiles continue to consume seats, while Super Admin profiles do not.
- Stale provisioning claims may be retried after 10 minutes. Retries use the operation ledger and Auth app-metadata marker; any unresolved compensation error is surfaced for owner recovery.
- New shops receive the existing baseline return-policy values: a 7-day return window and a 90-day minimum restock shelf life.
- The new-Shop form’s default grace-period field was removed. Suspension is immediate, as required by the approved plan.
- Shop logo uploads use a public-read `shop-logos` bucket restricted to platform Super Admin writes. Package 072 must be applied and pass its final check before uploads are enabled; only PNG/JPEG/WebP up to 2 MB are accepted.
