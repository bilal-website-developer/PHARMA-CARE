import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ean13CheckDigit,
  isValidEan13,
  isValidForFormat,
  MAX_LABELS_PER_PRINT_JOB,
  MAX_LABELS_PER_PRODUCT,
  validateLabelQuantities,
} from './labelUtils';

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

test('validateLabelQuantities accepts quantities from 1 through 200 for each product', () => {
  assert.equal(validateLabelQuantities([{ id: 'p1', name: 'Product 1', quantity: 1 }]), null);
  assert.equal(validateLabelQuantities([{ id: 'p1', name: 'Product 1', quantity: MAX_LABELS_PER_PRODUCT }]), null);
  assert.match(
    validateLabelQuantities([{ id: 'p1', name: 'Product 1', quantity: MAX_LABELS_PER_PRODUCT + 1 }]) ?? '',
    /whole number from 1 to 200/,
  );
  assert.match(validateLabelQuantities([{ id: 'p1', name: 'Product 1', quantity: 0 }]) ?? '', /whole number/);
  assert.match(validateLabelQuantities([{ id: 'p1', name: 'Product 1', quantity: 1.5 }]) ?? '', /whole number/);
});

test('validateLabelQuantities enforces the 1,000-label job limit', () => {
  const products = Array.from({ length: 5 }, (_, index) => ({
    id: `p${index}`,
    name: `Product ${index + 1}`,
    quantity: 200,
  }));
  assert.equal(validateLabelQuantities(products), null);
  assert.equal(products.reduce((sum, item) => sum + item.quantity, 0), MAX_LABELS_PER_PRINT_JOB);
  assert.match(
    validateLabelQuantities([...products, { id: 'p6', name: 'Product 6', quantity: 1 }]) ?? '',
    /limited to 1000 labels/,
  );
});
