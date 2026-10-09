import assert from 'node:assert/strict';
import test from 'node:test';
import { getExpiryDisplay, getStockBarState } from './inventoryUiLogic';

test('stock bar distinguishes out, low, and healthy stock and clamps its fill', () => {
  assert.deepEqual(getStockBarState(0, 10), {
    level: 'out',
    percentage: 0,
    quantity: 0,
    reorderLevel: 10,
  });
  assert.equal(getStockBarState(5, 10).level, 'low');
  assert.equal(getStockBarState(10, 10).level, 'low');
  assert.equal(getStockBarState(11, 10).level, 'ok');
  assert.equal(getStockBarState(25, 10).percentage, 100);
  assert.equal(getStockBarState(4, 0).level, 'ok');
  assert.throws(() => getStockBarState(-1, 10), /non-negative/);
  assert.throws(() => getStockBarState(1, Number.NaN), /non-negative/);
});

test('expiry display shows days remaining and applies the 90-day warning boundary', () => {
  const today = new Date(2026, 9, 10);
  assert.deepEqual(getExpiryDisplay('2026-10-11', 5, today), {
    label: '1 day',
    variant: 'warning',
    daysRemaining: 1,
  });
  assert.equal(getExpiryDisplay('2027-01-07', 2, today).variant, 'warning');
  assert.equal(getExpiryDisplay('2027-01-08', 2, today).variant, 'ok');
});

test('expiry display handles expired, today, empty-stock, and missing dates', () => {
  const today = new Date(2026, 9, 10);
  assert.deepEqual(getExpiryDisplay('2026-10-09', 1, today), {
    label: 'Expired 1 day ago',
    variant: 'danger',
    daysRemaining: -1,
  });
  assert.equal(getExpiryDisplay('2026-10-10', 1, today).label, 'Expires today');
  assert.equal(getExpiryDisplay('2026-12-01', 0, today).label, 'No stock');
  assert.equal(getExpiryDisplay(null, 1, today).label, 'No expiry date');
  assert.equal(getExpiryDisplay('2026-02-30', 1, today).label, 'Invalid expiry date');
  assert.throws(() => getExpiryDisplay('2026-10-10', Number.NaN, today), /non-negative/);
  assert.throws(() => getExpiryDisplay('2026-10-10', -1, today), /non-negative/);
  assert.throws(() => getExpiryDisplay('2026-10-10', 1, new Date(Number.NaN)), /valid date/);
});
