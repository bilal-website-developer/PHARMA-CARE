import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidOptionalPhone, resolvePosCustomerName } from './posCustomer';

test('uses the selected registered customer name', () => {
  assert.equal(resolvePosCustomerName(' Ali Khan ', 'Walk-in Name'), 'Ali Khan');
});

test('uses a typed walk-in name when no registered customer is selected', () => {
  assert.equal(resolvePosCustomerName(undefined, ' Ali Khan '), 'Ali Khan');
});

test('uses Walk-in Customer when no name is entered', () => {
  assert.equal(resolvePosCustomerName(undefined, '  '), 'Walk-in Customer');
});

test('allows an empty optional phone and digits with an optional leading plus', () => {
  assert.equal(isValidOptionalPhone(''), true);
  assert.equal(isValidOptionalPhone('+923001234567'), true);
  assert.equal(isValidOptionalPhone('03001234567'), true);
  assert.equal(isValidOptionalPhone('0300-1234567'), false);
  assert.equal(isValidOptionalPhone('++923001234567'), false);
});
