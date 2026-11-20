# Dashboard and Manage Users repair package

These are owner-run database files. No SQL in this package has been applied from the workspace.

## Required order

1. Confirm the Settings-controls package has already been applied and its `profiles_permissions_valid` constraint contains all six Settings-section keys.
2. Review and apply `202611200002_manage_users_settings_permission_repair.sql`. It only replaces the matching permission-key list in the existing transactional RPC; service-role authorization and account guards are preserved.
3. Run `202611200002_manage_users_settings_permission_repair.test.sql`.
4. Review and apply `202611200001_reports_sales_profit_summary.sql`.
5. Run `202611200001_reports_sales_profit_summary.test.sql`.
6. Deploy the matching frontend. The profit RPC is required for server-calculated gross profit; do not calculate profit from redacted client sales or current inventory cost.

## Profit calculation

The RPC returns only aggregate revenue, cost, gross profit, bill count, and daily aggregates. It requires the caller's current shop, Reports permission, and `can_view_cost()`. It subtracts completed return refunds and the sale-time cost of returned allocated units. Legacy sale lines without allocation rows use the sale-time cost snapshot; partially incomplete allocation rows cause an explicit error rather than a guessed value. Returns are grouped against the original sale date in `Asia/Karachi`.

The SQL smoke test checks the function definition, grants, authorization, and output minimization. It does not replace a phone/UI check with a permitted test account. Test one ordinary sale, one completed return, a date boundary, an account without Reports access, and a second shop.

## Rollback

Rollback the frontend first. Then run the applicable `*.rollback.sql` file as the database owner. The Manage Users rollback intentionally restores the older allowlist and will make Settings-section permission edits fail again. The profit rollback removes only the new reporting RPC.
