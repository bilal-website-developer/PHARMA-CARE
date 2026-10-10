import assert from 'node:assert/strict';
import test from 'node:test';
import { getStockAdjustmentPreview } from './stockInventoryLogic';

test('stock adjustment preview calculates positive and negative changes', () => {
  assert.deepEqual(getStockAdjustmentPreview(12, '5'), {
    delta: 5,
    resultingQuantity: 17,
  });
  assert.deepEqual(getStockAdjustmentPreview(12, '-5'), {
    delta: -5,
    resultingQuantity: 7,
  });
});

test('stock adjustment preview rejects invalid, zero, and out-of-range changes', () => {
  assert.equal(getStockAdjustmentPreview(12, ''), null);
  assert.equal(getStockAdjustmentPreview(12, '1.5'), null);
  assert.equal(getStockAdjustmentPreview(12, '0'), null);
  assert.equal(getStockAdjustmentPreview(12, '-13'), null);
  assert.equal(getStockAdjustmentPreview(2_147_483_647, '1'), null);
  assert.equal(getStockAdjustmentPreview(-1, '1'), null);
});
