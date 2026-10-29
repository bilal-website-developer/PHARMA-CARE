import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRole } from '../types/pharmacy';
import {
  buildCustomerDisplaySnapshot,
  canAccessCustomerDisplay,
  isCustomerDisplayChannelId,
  parseCustomerDisplayMessage,
} from './customerDisplay';

test('customer display access follows POS permission and admin defaults', () => {
  assert.equal(canAccessCustomerDisplay(UserRole.ADMIN, []), true);
  assert.equal(canAccessCustomerDisplay(UserRole.SUPER_ADMIN, []), true);
  assert.equal(canAccessCustomerDisplay(UserRole.CASHIER, ['pos']), true);
  assert.equal(canAccessCustomerDisplay(UserRole.CASHIER, []), false);
  assert.equal(canAccessCustomerDisplay(UserRole.MANAGER, ['pos']), true);
  assert.equal(canAccessCustomerDisplay(UserRole.MANAGER, ['customers']), false);
  assert.equal(canAccessCustomerDisplay(UserRole.ACCOUNTANT, ['reports']), false);
});

test('customer display snapshot projects only approved cart fields', () => {
  const sourceLine = {
    productName: 'Sample medicine',
    unitName: 'Strip',
    quantity: 2,
    unitPricePaisa: 2500,
    lineTotalPaisa: 5000,
    genericName: 'Hidden generic detail',
    costPaisaPerUnit: 900,
    customerPhone: 'not copied',
  };
  const snapshot = buildCustomerDisplaySnapshot([sourceLine], 5000, 0, 5000);

  assert.deepEqual(Object.keys(snapshot), [
    'type', 'items', 'subtotalPaisa', 'discountPaisa', 'totalPaisa',
  ]);
  assert.deepEqual(snapshot.items[0], {
    productName: 'Sample medicine',
    unitName: 'Strip',
    quantity: 2,
    unitPricePaisa: 2500,
    lineTotalPaisa: 5000,
  });
});

test('customer display message parser strips unapproved fields and rejects invalid amounts', () => {
  const parsed = parseCustomerDisplayMessage({
    type: 'snapshot',
    items: [{
      productName: 'Sample medicine',
      unitName: 'Strip',
      quantity: 1,
      unitPricePaisa: 2500,
      lineTotalPaisa: 2500,
      costPaisaPerUnit: 900,
      customerName: 'Not for display',
    }],
    subtotalPaisa: 2500,
    discountPaisa: 0,
    totalPaisa: 2500,
    customerPhone: 'Not for display',
  });

  assert.deepEqual(parsed, {
    type: 'snapshot',
    items: [{
      productName: 'Sample medicine',
      unitName: 'Strip',
      quantity: 1,
      unitPricePaisa: 2500,
      lineTotalPaisa: 2500,
    }],
    subtotalPaisa: 2500,
    discountPaisa: 0,
    totalPaisa: 2500,
  });
  assert.equal(parseCustomerDisplayMessage({ type: 'snapshot', items: [], subtotalPaisa: -1, discountPaisa: 0, totalPaisa: 0 }), null);
  assert.equal(parseCustomerDisplayMessage({ type: 'ready' })?.type, 'ready');
  assert.equal(parseCustomerDisplayMessage({ type: 'closed' })?.type, 'closed');
});

test('customer display channel id must be a UUID', () => {
  assert.equal(isCustomerDisplayChannelId('d8de2ef6-20a0-4b9b-8db7-2ad0d011aaaa'), true);
  assert.equal(isCustomerDisplayChannelId('not-a-channel'), false);
  assert.equal(isCustomerDisplayChannelId(null), false);
});
