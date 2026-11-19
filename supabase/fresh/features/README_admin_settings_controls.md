# Super Admin Settings Controls

This package is owner-run. The application does not execute SQL or deploy the Edge Function.

## What it changes

- Super Admin can grant an Admin access to Settings and select the editable sections: Shop Profile, Receipt and Memo, Receipt QR, Operational Limits, Demo Data, and WhatsApp Templates.
- Existing Admins with the broad Settings grant are backfilled to all sections to preserve their current access. Super Admin can narrow those grants afterward.
- Admin section grants are server-enforced. Shop profile and logo writes, receipt QR setting updates/revocation, and operational settings changes check the target permission on the server. Managers retain their existing Settings access.
- The Demo Data section controls the Settings-page demo loader; its underlying product, supplier, purchase, and master-data RPCs continue to use their existing module permissions. WhatsApp templates remain browser-local, so their section grant controls the Settings UI and does not provide server-side storage authorization.
- Super Admin can edit the operational and receipt QR settings for a selected shop from the platform Shops page. A service-only RPC validates the active Super Admin and target shop, updates both settings records atomically, and records an audit row.
- Pharmacy Memo Batch No. and Expiry visibility are stored independently. Existing combined values are mapped to both toggles, and the old combined field remains synchronized for compatibility with the deployed print-request validator.
- Public receipt QR payloads now include allocated Batch No. and Expiry. These are sensitive bearer-link fields visible to anyone with the link for its configured lifetime, until revocation, or while public receipts are disabled.

## Run order

1. Confirm packages 067 and 068 are applied and passed their owner-run checks.
2. Apply package 073 and its smoke test if Shop Admin profile/logo writes have not yet been enabled.
3. Confirm Receipt QR package `202611180001_receipt_qr_apply_all.sql` is applied and its smoke test passes.
4. Run `202611190001_admin_settings_controls.dry_run.sql`. Stop if any check is `STOP`. Its `permission_constraint` check verifies the existing S6 allowlist is valid before the apply extends it with six Settings section keys.
5. Review and apply `202611190001_admin_settings_controls.sql` as the reviewed database owner. It contains no deployment or frontend action.
6. Run `202611190001_admin_settings_controls.test.sql` and read every PASS notice.
7. Deploy the updated `manage-users` Edge Function (API version 6), then deploy the frontend. The frontend calls `update_current_shop_settings_v2`; it requires this SQL package first.
8. Super Admin opens Shops to edit shop settings and Admin section grants. For each existing Admin, verify the grants before narrowing them.

No SQL was run by the assistant. The owner must apply and verify the SQL and deploy the Edge Function/frontend.

The apply and rollback files intentionally contain no top-level transaction wrapper. Stop on any SQL error and inspect which statements completed before retrying or rolling back; do not blindly rerun a partially applied package.

If the apply stops with `profiles_permissions_valid`, do not rerun it immediately. Inspect whether the Settings-control functions and all three triggers were installed. If they are all present, review and run `202611190002_admin_settings_permission_constraint_repair.sql`, which atomically adds the six permission keys, backfills existing Settings-enabled Admins, and verifies the repair. If those objects are absent, the apply likely rolled back; rerun the corrected `202611190001_admin_settings_controls.sql` only after confirming the dry run is `READY`. If the dry run reports `STOP`, inspect the partial state first.

## Rollback

1. Roll back the frontend and `manage-users` Edge Function first.
2. Run `202611190001_admin_settings_controls.rollback.sql` as the reviewed database owner.
3. The rollback combines the two visibility flags using logical AND to avoid printing a field the Admin had explicitly hidden. Back up or export the settings first if the exact per-field preference must be retained for later manual restoration.
4. The rollback removes the six Settings-section keys from Admin grants and restores the prior `profiles_permissions_valid` allowlist.
