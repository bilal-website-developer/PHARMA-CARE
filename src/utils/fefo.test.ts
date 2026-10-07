import assert from 'node:assert/strict';
import test from 'node:test';
import { Batch, BatchStatus } from '../types/pharmacy';
import { allocateFefo, restoreBatchAllocations } from './fefo';

const batch = (
  id: string,
  expiryDate: string,
  quantitySmallestUnit: number,
  receivedDate: string,
  status = BatchStatus.ACTIVE
): Batch => ({
  id,
  productId: 'product',
  batchNumber: `LOT-${id}`,
  expiryDate,
  receivedDate,
  costPricePaisa: 100,
  mrpPaisa: 150,
  quantitySmallestUnit,
  status,
  supplierName: 'Supplier',
});

test('orders eligible batches by FEFO', () => {
  const result = allocateFefo(
    [batch('later', '2027-02-01', 5, '2026-01-01'), batch('sooner', '2026-12-01', 5, '2026-02-01')],
    6,
    '2026-10-07'
  );
  assert.deepEqual(result.map(({ batchId, quantitySmallestUnit }) => [batchId, quantitySmallestUnit]), [
    ['sooner', 5],
    ['later', 1],
  ]);
});

test('uses received date then batch id for same-expiry batches', () => {
  const result = allocateFefo(
    [
      batch('z-new', '2027-01-01', 2, '2026-02-01'),
      batch('b-old', '2027-01-01', 2, '2026-01-01'),
      batch('a-old', '2027-01-01', 2, '2026-01-01'),
    ],
    4,
    '2026-10-07'
  );
  assert.deepEqual(result.map(({ batchId }) => batchId), ['a-old', 'b-old']);
});

test('splits a sale across batches', () => {
  const result = allocateFefo(
    [batch('first', '2027-01-01', 3, '2026-01-01'), batch('second', '2027-02-01', 4, '2026-01-02')],
    5,
    '2026-10-07'
  );
  assert.deepEqual(result.map(({ quantitySmallestUnit }) => quantitySmallestUnit), [3, 2]);
});

test('skips expired batches and stock expiring today', () => {
  const result = allocateFefo(
    [
      batch('expired', '2026-10-06', 10, '2026-01-01'),
      batch('today', '2026-10-07', 10, '2026-01-02'),
      batch('quarantine', '2026-10-08', 10, '2026-01-03', BatchStatus.QUARANTINE),
      batch('damaged', '2026-10-09', 10, '2026-01-04', BatchStatus.DAMAGED),
      batch('returned', '2026-10-10', 10, '2026-01-05', BatchStatus.RETURNED),
      batch('valid', '2026-10-11', 1, '2026-01-06', BatchStatus.NEAR_EXPIRY),
    ],
    1,
    '2026-10-07'
  );
  assert.deepEqual(result.map(({ batchId }) => batchId), ['valid']);
});

test('rejects insufficient eligible stock without returning partial allocations', () => {
  assert.throws(
    () => allocateFefo([batch('small', '2027-01-01', 2, '2026-01-01')], 3, '2026-10-07'),
    /Insufficient eligible stock/
  );
});

test('converts pack or strip quantities to smallest units before allocation', () => {
  const packCount = 2;
  const conversionFactor = 10;
  const result = allocateFefo([batch('pack-stock', '2027-01-01', 25, '2026-01-01')], packCount * conversionFactor, '2026-10-07');
  assert.equal(result[0].quantitySmallestUnit, 20);
});

test('restores a return to its original batch', () => {
  const originalBatch = batch('original', '2027-01-01', 4, '2026-01-01');
  const changed = restoreBatchAllocations(
    [originalBatch],
    [{ batchId: 'original', batchNumber: originalBatch.batchNumber, expiryDate: originalBatch.expiryDate, quantitySmallestUnit: 2 }]
  );
  assert.equal(changed[0].quantitySmallestUnit, 6);
  assert.equal(originalBatch.quantitySmallestUnit, 4);
});

test('rejects return allocations for an unknown original batch', () => {
  assert.throws(
    () =>
      restoreBatchAllocations(
        [batch('other', '2027-01-01', 4, '2026-01-01')],
        [{ batchId: 'missing', batchNumber: 'LOT', expiryDate: '2027-01-01', quantitySmallestUnit: 1 }]
      ),
    /was not found/
  );
});
