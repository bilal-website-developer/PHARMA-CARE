import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatStockAlertBadgeCount,
  getStockAlertLinkTarget,
  getUnseenStockAlertKeys,
  isStockAlertsSummary,
  type StockAlertItem,
} from './stockAlertLogic';

const lowAlert: StockAlertItem = {
  medicine_id: 'medicine-1',
  name: 'Medicine One',
  strength: '10 mg',
  generic_name: 'Generic One',
  stock: 2,
  min_stock_alert: 5,
  kind: 'low',
};

const validSummary = {
  low_count: 1,
  out_count: 0,
  generated_at: '2026-10-13T10:00:00.000Z',
  items: [lowAlert],
};

test('stock alert badge count is hidden at zero and capped at 99+', () => {
  assert.equal(formatStockAlertBadgeCount(0), null);
  assert.equal(formatStockAlertBadgeCount(1), '1');
  assert.equal(formatStockAlertBadgeCount(99), '99');
  assert.equal(formatStockAlertBadgeCount(100), '99+');
});

test('unseen alert comparison only returns new medicine-and-kind keys', () => {
  const outAlert: StockAlertItem = { ...lowAlert, kind: 'out', stock: 0 };
  const seen = new Set([`${lowAlert.medicine_id}\u0000${lowAlert.kind}`]);
  assert.deepEqual(getUnseenStockAlertKeys([lowAlert, outAlert], seen), [
    `${outAlert.medicine_id}\u0000${outAlert.kind}`,
  ]);
});

test('stock alert links prefer Stock Inventory, then Products, otherwise no link', () => {
  assert.equal(getStockAlertLinkTarget(true, true), 'stock-inventory');
  assert.equal(getStockAlertLinkTarget(false, true), 'products');
  assert.equal(getStockAlertLinkTarget(false, false), null);
});

test('stock alert response guard accepts the expected response shape', () => {
  assert.equal(isStockAlertsSummary(validSummary), true);
});

test('stock alert response guard rejects malformed and cost-bearing responses', () => {
  assert.equal(isStockAlertsSummary({ ...validSummary, low_count: '1' }), false);
  assert.equal(isStockAlertsSummary({
    ...validSummary,
    items: [{ ...lowAlert, kind: 'out' }],
  }), false);
  assert.equal(isStockAlertsSummary({
    ...validSummary,
    items: [{ ...lowAlert, cost_paisa: 500 }],
  }), false);
});
