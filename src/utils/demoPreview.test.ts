import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRole } from '../types/pharmacy';
import { SIDEBAR_PAGES } from '../components/sidebarPages';
import {
  addDemoPreviewRecord,
  canOpenDemoPreview,
  createDemoPreviewState,
  DEMO_PREVIEW_ROLES,
  getDemoRolePages,
  isDemoPreviewPageKey,
} from './demoPreview';

test('only Super Admin can open the Demo page from the real workspace', () => {
  assert.equal(canOpenDemoPreview(UserRole.SUPER_ADMIN), true);
  assert.equal(canOpenDemoPreview(UserRole.ADMIN), false);
  assert.equal(canOpenDemoPreview(UserRole.MANAGER), false);
  assert.equal(canOpenDemoPreview(UserRole.CASHIER), false);
  assert.equal(canOpenDemoPreview(UserRole.ACCOUNTANT), false);
});

test('role picker includes every app role for visual preview', () => {
  assert.deepEqual(DEMO_PREVIEW_ROLES, [
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.CASHIER,
    UserRole.ACCOUNTANT,
  ]);
});

test('demo workspaces show sample pages allowed by their role template', () => {
  const superAdminPages = getDemoRolePages(UserRole.SUPER_ADMIN).map(({ key }) => key);
  const adminPages = getDemoRolePages(UserRole.ADMIN).map(({ key }) => key);
  const cashierPages = getDemoRolePages(UserRole.CASHIER).map(({ key }) => key);

  assert.ok(superAdminPages.includes('shops'));
  assert.ok(superAdminPages.includes('manage-users'));
  assert.ok(!superAdminPages.includes('pos'));
  assert.ok(adminPages.includes('pos'));
  assert.ok(adminPages.includes('trash-bin'));
  assert.ok(!adminPages.includes('shops'));
  assert.ok(cashierPages.includes('pos'));
  assert.ok(cashierPages.includes('sales-history'));
  assert.ok(!cashierPages.includes('purchases'));
  assert.ok(!cashierPages.includes('settings'));
});

test('demo edits are memory-only state and a fresh session resets to the seed', () => {
  const initial = createDemoPreviewState();
  const changed = addDemoPreviewRecord(initial, 'pos', 'Sample checkout');

  assert.equal(initial.records.pos?.length, 1);
  assert.equal(changed.records.pos?.length, 2);
  assert.match(changed.records.pos?.[1] ?? '', /Sample checkout/);
  assert.equal(createDemoPreviewState().records.pos?.length, 1);
  assert.equal(addDemoPreviewRecord(changed, 'pos', '  '), changed);
});

test('every registered app page has a demo preview entry', () => {
  const state = createDemoPreviewState();
  for (const page of SIDEBAR_PAGES) {
    if (isDemoPreviewPageKey(page.key)) {
      assert.ok(state.records[page.key], `Missing demo content for ${page.key}`);
    }
  }
});
