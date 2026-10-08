import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRole } from './types/pharmacy';
import {
  canAccessModule,
  canAccessPage,
  MODULES,
  ROLE_DEFAULT_PERMISSIONS,
} from './permissions';

test('role defaults preserve existing access and give super admins full admin access', () => {
  assert.deepEqual(ROLE_DEFAULT_PERMISSIONS[UserRole.CASHIER], ['pos', 'customers']);
  assert.deepEqual(ROLE_DEFAULT_PERMISSIONS[UserRole.MANAGER], [
    'pos', 'products', 'categories', 'suppliers', 'customers',
    'sales_history', 'purchase_history', 'purchases', 'stock_inventory', 'reports',
  ]);
  assert.deepEqual(ROLE_DEFAULT_PERMISSIONS[UserRole.ACCOUNTANT], [
    'customers', 'suppliers', 'sales_history', 'purchase_history', 'expenses', 'reports',
  ]);
  assert.deepEqual(ROLE_DEFAULT_PERMISSIONS[UserRole.ADMIN], []);
  assert.deepEqual(ROLE_DEFAULT_PERMISSIONS[UserRole.SUPER_ADMIN], MODULES.map(({ key }) => key));
});

test('admin and super admin access and assigned module permissions are respected by page guards', () => {
  assert.equal(canAccessModule(UserRole.ADMIN, [], 'expenses'), false);
  assert.equal(canAccessModule(UserRole.ADMIN, ['expenses'], 'expenses'), true);
  assert.equal(canAccessModule(UserRole.SUPER_ADMIN, [], 'expenses'), true);
  assert.equal(canAccessModule(UserRole.CASHIER, ['pos'], 'pos'), true);
  assert.equal(canAccessModule(UserRole.CASHIER, ['pos'], 'purchases'), false);
  assert.equal(canAccessPage(UserRole.ADMIN, [], 'manage-users'), true);
  assert.equal(canAccessPage(UserRole.SUPER_ADMIN, [], 'manage-users'), true);
  assert.equal(canAccessPage(UserRole.SUPER_ADMIN, [], 'settings'), true);
  assert.equal(canAccessPage(UserRole.ADMIN, [], 'expenses'), false);
  assert.equal(canAccessPage(UserRole.ADMIN, ['expenses'], 'expenses'), true);
  assert.equal(canAccessPage(UserRole.ADMIN, [], 'manage-users'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, ['pos'], 'manage-users'), false);
  assert.equal(canAccessPage(UserRole.CASHIER, ['pos'], 'purchases'), false);
  assert.equal(canAccessPage(UserRole.CASHIER, ['customers'], 'customer-ledger'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, [], 'dashboard'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, [], 'help-support'), true);
});
