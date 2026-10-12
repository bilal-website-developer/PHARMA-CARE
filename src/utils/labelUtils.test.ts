import assert from 'node:assert/strict';
import test from 'node:test';
import { ean13CheckDigit, isValidEan13, isValidForFormat } from './labelUtils';

test('ean13CheckDigit generates the correct trailing checksum for a known-good payload', () => {
  assert.equal(ean13CheckDigit('978123456789'), '7');
  assert.equal(ean13CheckDigit('590123412345'), '7');
});

test('isValidEan13 accepts valid EAN-13 values and rejects invalid ones', () => {
  assert.equal(isValidEan13('9781234567897'), true);
  assert.equal(isValidEan13('9781234567890'), false);
  assert.equal(isValidEan13('123456789012'), false);
  assert.equal(isValidEan13('abc'), false);
});

test('isValidForFormat enforces the expected value rules for each barcode format', () => {
  assert.equal(isValidForFormat('ABC123', 'CODE128'), true);
  assert.equal(isValidForFormat('', 'CODE128'), false);
  assert.equal(isValidForFormat('9781234567897', 'EAN13'), true);
  assert.equal(isValidForFormat('9781234567890', 'EAN13'), false);
  assert.equal(isValidForFormat('036000291452', 'UPC'), true);
  assert.equal(isValidForFormat('03600029145', 'UPC'), false);
  assert.equal(isValidForFormat('AB-12', 'CODE39'), true);
  assert.equal(isValidForFormat('AB@12', 'CODE39'), false);
  assert.equal(isValidForFormat('12345678', 'ITF'), true);
  assert.equal(isValidForFormat('1234567', 'ITF'), false);
});
