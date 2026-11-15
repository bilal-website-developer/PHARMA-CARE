import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRole } from './types/pharmacy';
import {
  canAccessModule,
  canAccessPage,
  hasPosPrintToggles,
  MODULES,
  normalizePermissionSelection,
  setModulePermission,
  setPosPrintPermission,
} from './permissions';

test('all business modules, including Settings, require explicit grants', () => {
  for (const role of Object.values(UserRole)) {
    for (const { key } of MODULES) {
      assert.equal(canAccessModule(role, [], key), false);
    }
  }
  assert.ok(MODULES.some(({ key }) => key === 'settings'));
});

test('POS print toggles are visible only with POS Billing and are never defaulted', () => {
  const withPos = setModulePermission(['customers'], 'pos', true);
  assert.equal(hasPosPrintToggles(withPos), true);
  assert.deepEqual(withPos, ['customers', 'pos']);
  assert.equal(withPos.includes('pos_print_sale'), false);
  assert.equal(withPos.includes('pos_print_payment'), false);

  const withPaymentPrint = setPosPrintPermission(withPos, 'pos_print_payment', true);
  assert.equal(withPaymentPrint.includes('pos_print_payment'), true);
  assert.deepEqual(setModulePermission(withPaymentPrint, 'pos', false), ['customers']);
  assert.equal(hasPosPrintToggles(['customers']), false);
  assert.deepEqual(normalizePermissionSelection(['customers', 'pos_print_sale', 'pos_print_payment']), ['customers']);
});

test('Admin pages follow explicit grants and Super Admin is platform-only', () => {
  for (const { key } of MODULES) {
    assert.equal(canAccessModule(UserRole.ADMIN, [], key), false);
    assert.equal(canAccessModule(UserRole.SUPER_ADMIN, [key], key), false);
  }
  assert.equal(canAccessModule(UserRole.CASHIER, ['pos'], 'pos'), true);
  assert.equal(canAccessModule(UserRole.CASHIER, ['pos'], 'purchases'), false);
  assert.equal(canAccessPage(UserRole.ADMIN, [], 'manage-users'), false);
  assert.equal(canAccessPage(UserRole.ADMIN, ['manage_users'], 'manage-users'), true);
  assert.equal(canAccessPage(UserRole.SUPER_ADMIN, [], 'manage-users'), true);
  assert.equal(canAccessPage(UserRole.SUPER_ADMIN, [], 'demo'), true);
  assert.equal(canAccessPage(UserRole.ADMIN, ['manage_users'], 'demo'), false);
  assert.equal(canAccessPage(UserRole.SUPER_ADMIN, ['settings'], 'settings'), false);
  assert.equal(canAccessPage(UserRole.MANAGER, [], 'settings'), false);
  assert.equal(canAccessPage(UserRole.CASHIER, [], 'settings'), false);
  assert.equal(canAccessPage(UserRole.MANAGER, ['settings'], 'settings'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, ['settings'], 'settings'), true);
  assert.equal(canAccessPage(UserRole.ADMIN, [], 'expenses'), false);
  assert.equal(canAccessPage(UserRole.ADMIN, ['expenses'], 'expenses'), true);
  assert.equal(canAccessPage(UserRole.ADMIN, ['purchases'], 'purchases'), true);
  assert.equal(canAccessPage(UserRole.ADMIN, ['purchases'], 'purchase-history'), false);
  assert.equal(canAccessPage(UserRole.ADMIN, ['purchase_history'], 'purchase-history'), true);
  assert.equal(canAccessPage(UserRole.ADMIN, ['purchase_history'], 'purchases'), false);
  assert.equal(canAccessPage(UserRole.ADMIN, ['categories'], 'master-data'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, ['pos'], 'manage-users'), false);
  assert.equal(canAccessPage(UserRole.MANAGER, ['manage_users'], 'manage-users'), false);
  assert.equal(canAccessPage(UserRole.MANAGER, [], 'manage-users'), false);
  assert.equal(canAccessPage(UserRole.MANAGER, ['manage_users'], 'settings'), false);
  assert.equal(canAccessPage(UserRole.MANAGER, ['manage_users'], 'trash-bin'), false);
  assert.equal(canAccessPage(UserRole.CASHIER, [], 'my-print-requests'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, [], 'print-requests'), false);
  assert.equal(canAccessPage(UserRole.ADMIN, [], 'print-requests'), true);
  assert.equal(canAccessPage(UserRole.SUPER_ADMIN, ['manage_users'], 'print-requests'), false);
  assert.equal(canAccessPage(UserRole.SUPER_ADMIN, ['manage_users'], 'trash-bin'), false);
  assert.equal(canAccessPage(UserRole.CASHIER, ['pos'], 'purchases'), false);
  assert.equal(canAccessPage(UserRole.CASHIER, ['customers'], 'customer-ledger'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, [], 'dashboard'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, [], 'help-support'), true);
});
