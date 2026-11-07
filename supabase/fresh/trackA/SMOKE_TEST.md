# Track A smoke test checklist

Use this after each SQL step on the live site. Run through the same sequence in the same browser session or a clean session after each step.

## 1) Sign-in checks
- [ ] Login as a normal admin user and confirm the dashboard opens.
- [ ] Login as a manager and verify the manager-only pages are visible and the admin-only pages are hidden.
- [ ] Login as a cashier and verify the POS and customer pages are available but admin pages are blocked.
- [ ] Logout and confirm the app returns to the login screen.

## 2) POS and catalog
- [ ] POS catalog loads for an active authenticated user.
- [ ] A sale can be created for cash.
- [ ] A sale can be created for credit and the customer ledger updates.
- [ ] A sale posting with a normal customer returns a valid receipt and no permission error.

## 3) Purchase and stock
- [ ] Purchase screen loads and can add a supplier.
- [ ] A purchase can be created and recorded.
- [ ] Stock batches are visible and inventory totals update.
- [ ] Stock adjustment can be created successfully.
- [ ] An expired batch can be written off using the accepted workflow.

## 4) Returns and print
- [ ] A completed sale can be opened for return request.
- [ ] A return request can be created and submitted.
- [ ] Manager/admin approval or rejection works for the return request.
- [ ] A print request can be submitted.
- [ ] A pending print request can be approved and rejected.

## 5) Admin and account controls
- [ ] Supplier save works for an allowed admin/manager path.
- [ ] Supplier deactivate works and does not create an anonymous failure.
- [ ] A cashier attempts to open an admin-only page and is denied.
- [ ] Reports and expense pages load for the right roles.
- [ ] Manage Users can list members for an admin/team owner.

## 6) Data safety checks
- [ ] A failed SQL lock-down does not leave the app in a partially broken state.
- [ ] The rollback script restores the prior `PUBLIC/anon` pattern if needed.
- [ ] No anonymous `SELECT`/`EXECUTE` errors appear in the browser console after the lock-down.

## 7) Final signoff
- [ ] Confirm the main live app remains usable for the single shop deployment.
- [ ] Confirm no Track B / multi-shop work was enabled.
- [ ] Confirm no pack-size or Team customer-screen changes are active.
