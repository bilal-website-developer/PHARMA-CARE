import assert from 'node:assert/strict';
import test from 'node:test';
import { findProductByScan, normalizeScannedValue } from './useBarcodeScanner';

test('normalizeScannedValue strips whitespace and line breaks from scanned input', () => {
  assert.equal(normalizeScannedValue('  8901234567891 \n '), '8901234567891');
  assert.equal(normalizeScannedValue('ABC-123'), 'ABC-123');
});

test('findProductByScan resolves the matching product by barcode or internal code', () => {
  const products = [
    { id: 'p-1', barcode: '8901234567891', code: 'P-101' },
    { id: 'p-2', barcode: '4455667788990', code: 'ABC-002' },
  ];

  assert.deepEqual(findProductByScan(products, ' 8901234567891 '), products[0]);
  assert.deepEqual(findProductByScan(products, 'P-101'), products[0]);
  assert.equal(findProductByScan(products, 'missing-code'), undefined);
});
