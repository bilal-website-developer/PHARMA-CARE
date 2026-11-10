import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePosCustomerName } from './posCustomer';

test('uses the selected registered customer name', () => {
  assert.equal(resolvePosCustomerName(' Ali Khan ', 'Walk-in Name'), 'Ali Khan');
});

test('uses a typed walk-in name when no registered customer is selected', () => {
  assert.equal(resolvePosCustomerName(undefined, ' Ali Khan '), 'Ali Khan');
});

test('uses Walk-in Customer when no name is entered', () => {
  assert.equal(resolvePosCustomerName(undefined, '  '), 'Walk-in Customer');
});
