import assert from 'node:assert/strict';
import test from 'node:test';
import { findProductByScan, normalizeScannedValue, parseBarcodeScan } from './useBarcodeScanner';

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

test('parseBarcodeScan accepts fast scanner input completed with Enter', () => {
  assert.equal(parseBarcodeScan('8901234567891', 140), '8901234567891');
  assert.equal(parseBarcodeScan('  PC-123 \n', 140), 'PC-123');
});

test('parseBarcodeScan rejects slow, short, and invalid-duration input', () => {
  assert.equal(parseBarcodeScan('8901234567891', 1001), null);
  assert.equal(parseBarcodeScan('AB', 30), null);
  assert.equal(parseBarcodeScan('8901234567891', Number.NaN), null);
});
