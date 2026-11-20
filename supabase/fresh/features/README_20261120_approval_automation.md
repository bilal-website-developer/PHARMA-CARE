# Shop approval automation

This feature is implemented locally but requires the owner-run SQL package before the matching frontend is deployed. The two independent shop settings default to off and can be changed only by a Shop Admin with Settings and Operational Limits access.

## Behavior

- **Print requests:** when enabled, a newly created eligible staff request is approved transactionally, audited, and returned to the requester. Older pending requests remain in the Admin queue and are not auto-approved or printed. The requesting browser opens the ordinary print dialog; staff still choose a printer and confirm. This is not silent printing, and the web app cannot verify that paper physically printed. A request key and atomic claim prevent a replay from opening the same dialog twice.
- **Returns:** only new requests are auto-processed. Existing pending requests remain in the manual queue. Automated returns use the existing refund/credit calculation and record every returned batch in `QUARANTINE`; they are not sellable until staff review. Automatic restocking is intentionally unsupported. The database restricts this path to the submitter's just-created request while the Admin-controlled setting is enabled and records an automatic-processing audit event.
- Manual approval and direct printing remain unchanged when the corresponding setting is off. Reused pending requests retain their original snapshot and manual queue state.

## Owner-run order

1. Confirm the scoped S5 print and return RPCs and S6 shop-settings schema are present, including `print_requests_one_pending_per_shop_receipt`.
2. Review and apply `202611200004_approval_automation.sql` in the intended Supabase project.
3. Run `202611200004_approval_automation.test.sql`; it is read-only and verifies the schema and guards.
4. Deploy the matching frontend. Sign in as a Shop Admin with Settings and Operational Limits access; confirm both switches are off. Enable one at a time in a designated test shop.
5. Test a staff reprint request and confirm the requester device opens a native print dialog. Test a new return and confirm it is completed with its existing refund/credit result and a `QUARANTINE` disposition. Confirm no returned quantity is sellable and old pending requests remain manual.
6. Confirm a Manager cannot change these settings, and repeat isolation checks with a second shop. Disable the toggles if any result differs.

The package has not been executed against Supabase. Do not enable either setting until the owner-run test and application checks pass.

## Rollback

Run `202611200004_approval_automation.rollback.sql` and deploy the prior frontend. The rollback disables both settings and restores the original return RPCs. It retains added columns and audit metadata so previously auto-approved/processed records are not erased.
