import assert from 'node:assert/strict';
import test from 'node:test';
import { clampSidebarMenuPosition } from './sidebarMenuPosition';
import { MAX_FAVORITE_PAGES, toggleSidebarFavorite } from './sidebarPinLogic';
import { SIDEBAR_PAGES, isSidebarPageKey } from './sidebarPages';
import { canAccessPage } from '../permissions';
import { UserRole } from '../types/pharmacy';

test('favorites preserve selection order, can be removed, and are limited to eight pages', () => {
  const firstEight = SIDEBAR_PAGES.slice(0, MAX_FAVORITE_PAGES).map(({ key }) => key);
  const first = toggleSidebarFavorite([], firstEight[0]);
  assert.deepEqual(first.pageKeys, [firstEight[0]]);

  const second = toggleSidebarFavorite(first.pageKeys, firstEight[1]);
  assert.deepEqual(second.pageKeys, [firstEight[0], firstEight[1]]);
  assert.equal(second.limitReached, false);

  const remainingSeven = firstEight.slice(0, 7);
  const added = toggleSidebarFavorite(remainingSeven, firstEight[7]);
  assert.deepEqual(added.pageKeys, firstEight);
  assert.equal(added.limitReached, false);

  const ninth = toggleSidebarFavorite(firstEight, 'help-support');
  assert.equal(ninth.limitReached, true);
  assert.deepEqual(ninth.pageKeys, firstEight);

  const removed = toggleSidebarFavorite(firstEight, firstEight[2]);
  assert.equal(removed.limitReached, false);
  assert.deepEqual(removed.pageKeys, firstEight.filter((key) => key !== firstEight[2]));
});

test('clamps the context menu at the viewport edges', () => {
  assert.deepEqual(clampSidebarMenuPosition(900, 740, 1000, 760, 192, 48), { left: 808, top: 712 });
  assert.deepEqual(clampSidebarMenuPosition(30, 40, 1000, 760, 192, 48), { left: 30, top: 40 });
});

test('page registry contains unique valid keys and preserves sidebar role visibility', () => {
  const keys = SIDEBAR_PAGES.map(({ key }) => key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every(isSidebarPageKey));
  assert.equal(canAccessPage(UserRole.CASHIER, ['customers'], 'customer-ledger'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, ['customers'], 'whatsapp-reminders'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, [], 'dashboard'), true);
  assert.equal(canAccessPage(UserRole.CASHIER, [], 'settings'), false);
  assert.equal(canAccessPage(UserRole.ADMIN, [], 'settings'), true);
});
