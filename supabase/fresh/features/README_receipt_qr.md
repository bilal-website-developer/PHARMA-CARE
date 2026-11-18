# Receipt QR rollout

This package is owner-run. The application code does not execute SQL or deploy the Edge Function.

## Before rollout

- Choose the production HTTPS origin for the app. It must be an origin only, without a path, query, or credentials.
- Set the Edge Function secret `APP_PUBLIC_URL` to that exact origin and set each shop's **Public app URL** to the same value.
- The template preview's **Demo QR** opens `/demo/receipts` on that same website origin. It shows synthetic-only samples and requires no SQL, Supabase access, or authentication.
- Confirm the target database contains the S4/S5 tenant helpers and required columns. Stop if the dry-run reports any `FAIL`.
- The public receipt link is a bearer link: anyone who receives it can view the allowlisted receipt until it expires, the link is revoked, or public receipts are disabled for the shop.

## Run order

1. Review `202611180001_receipt_qr_dry_run_all.sql` in the Supabase SQL Editor. Do not apply if any row is `FAIL`.
2. Review and run `202611180001_receipt_qr_apply_all.sql` as the database owner. It contains no top-level `BEGIN` or `COMMIT`.
3. Run `202611180001_receipt_qr.test.sql`. It rolls back its fixture changes and prints the PASS/FAIL/INFO results as notices, avoiding temporary tables that may not persist between SQL Editor statements. Missing live test prerequisites appear as `INFO` instead of aborting. Eligible active Admin/Manager test actors must have both Settings and POS or Sales History access, matching the RPC guards, and completed sales must exist in two shops; an active platform Super Admin is also needed for that check. Read the notices/messages output after running the script. The payload allowlist is verified by the Edge Function unit tests.
4. Run `npm run lint`, `npm test`, and `npm run build`.
5. Set the function's public app origin:

   ```sh
   npx supabase secrets set APP_PUBLIC_URL=https://your-pharmacy-app.example --project-ref <PROJECT_REF>
   ```

6. Deploy the public function with the previously confirmed no-JWT-verification flag:

   ```sh
   npx supabase functions deploy get-public-receipt --no-verify-jwt --project-ref <PROJECT_REF>
   ```

7. Deploy the frontend. Vercel's `/r/:token` response headers are configured in `vercel.json`; any other hosting provider must apply equivalent `no-store`, `noindex`, `no-referrer`, and strict CSP headers to `/r/*`.
8. In Settings, set each shop's URL and preferences. Public receipts remain disabled until an Admin or Manager enables them. New sale receipts then create/reuse their QR link at print time.

## Rollback order

1. Turn off **Enable public receipt links** in each affected shop. This suspends public viewing without revoking the links; re-enabling before expiry restores them.
2. Roll back the frontend deployment so no new QR links are printed.
3. Delete the `get-public-receipt` Edge Function using the Supabase Dashboard or CLI, then remove `APP_PUBLIC_URL` if no other function uses it.
4. Run `202611180001_receipt_qr.rollback.sql` as the database owner. It permanently removes receipt QR settings, links, view counts, and rate-limit data. Do not run rollback while the deployed function is still serving requests.

## Data and privacy notes

- The public response contains only shop name/address/phone, invoice number, date/time, receipt line name (or generic item label), unit, quantity, unit price, line total, completed-return status, discount, total, paid, change, and credit balance. It does not expose customer, staff, supplier, batch, expiry, cost, margin, profit, prescription, or internal identifiers.
- The database smoke test verifies tenant isolation, staff lookup behavior for expired links, revocation, Super Admin denial, and anon function ACLs where prerequisites are available. Any `INFO` row means that case could not be exercised with the current live test accounts/data. The `public payload allowlist` row is informational because the payload is built in the Edge Function; its assertions run in `npm run test:receipt-qr`.
- Current customer payments are recorded at account level without a sale allocation. Therefore, a public credit balance can reflect the invoice and its recorded returns but cannot reliably subtract later customer-account payments for this specific bill. Do not describe it as a live allocated balance until the data model supports that.
- Public receipt rendering has generic unavailable text for invalid, expired, revoked, and shop-suspended links. The Edge Function adds IP rate limiting, strict CORS, no-store/noindex/no-referrer and CSP headers; `/r/*` also needs those response headers from the static host.

## Manual checklist

- [ ] Print a new 58 mm thermal sale receipt; confirm the QR is sharp, centered, has a quiet zone, and scans.
- [ ] Print a new 80 mm receipt and an A4 receipt; confirm the QR is readable and the invoice number remains printed as text.
- [ ] Reprint a receipt and confirm the same active token is reused.
- [ ] Scan with a phone; confirm `/r/<token>` opens without login and shows only the public fields.
- [ ] Scan the Demo QR from Quick View; confirm `/demo/receipts` shows fictional sales without requiring login.
- [ ] Scan the same QR with the POS barcode scanner while the Returns panel is open; confirm Enter submits the scanned URL.
- [ ] As a Cashier with POS access, resolve the scanned receipt and submit a return request; confirm it does not approve or restock the return.
- [ ] As a Manager with return-review access, verify the existing approval and restock policy still applies.
- [ ] Test a public link after expiry and confirm the generic unavailable page.
- [ ] Regenerate a receipt QR as Admin or Manager; confirm the old link is unavailable and the new one opens.
- [ ] Disable public receipts and confirm existing public links are suspended; re-enable before expiry and confirm they work again.
