import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDiscount } from './discount';

test('calculates five percent of a Rs 2,170 bill in integer paisa', () => {
  assert.deepEqual(computeDiscount({ billPaisa: 217000, mode: 'percent', value: '5' }), {
    discountPaisa: 10850,
    payablePaisa: 206150,
    percentShown: 5,
  });
});

test('calculates a Rs 100 amount discount on a Rs 2,170 bill', () => {
  assert.deepEqual(computeDiscount({ billPaisa: 217000, mode: 'amount', value: '100' }), {
    discountPaisa: 10000,
    payablePaisa: 207000,
    percentShown: 4.6,
  });
});

test('calculates Rs 35 off Rs 2,035', () => {
  assert.equal(computeDiscount({ billPaisa: 203500, mode: 'amount', value: '35' }).payablePaisa, 200000);
});

test('accepts an amount with two decimal places', () => {
  assert.equal(computeDiscount({ billPaisa: 53116, mode: 'amount', value: '31.16' }).payablePaisa, 50000);
});

test('rounds percentage discounts half-up to the paisa', () => {
  assert.equal(computeDiscount({ billPaisa: 1, mode: 'percent', value: '50' }).discountPaisa, 1);
  assert.equal(computeDiscount({ billPaisa: 5, mode: 'percent', value: '10' }).discountPaisa, 1);
});

test('rejects discounts larger than the bill', () => {
  assert.equal(computeDiscount({ billPaisa: 10000, mode: 'amount', value: '100.01' }).error, 'Discount cannot exceed the bill.');
});

test('rejects negative values and amounts with more than two decimals', () => {
  assert.ok(computeDiscount({ billPaisa: 10000, mode: 'amount', value: '-1' }).error);
  assert.ok(computeDiscount({ billPaisa: 10000, mode: 'amount', value: '1.001' }).error);
});

test('accepts 100 percent and rejects values above 100 percent', () => {
  assert.equal(computeDiscount({ billPaisa: 10000, mode: 'percent', value: '100' }).payablePaisa, 0);
  assert.equal(computeDiscount({ billPaisa: 10000, mode: 'percent', value: '100.01' }).error, 'Discount cannot exceed 100%.');
});

test('rejects discounts above the role limit', () => {
  assert.equal(
    computeDiscount({ billPaisa: 100000, mode: 'amount', value: '100.01', maxPercent: 10 }).error,
    'Discount above your limit. Ask a manager.',
  );
  assert.equal(
    computeDiscount({ billPaisa: 100000, mode: 'percent', value: '10.01', maxPercent: 10 }).error,
    'Discount above your limit. Ask a manager.',
  );
});

test('treats zero and empty values as no discount', () => {
  assert.equal(computeDiscount({ billPaisa: 10000, mode: 'amount', value: '' }).discountPaisa, 0);
  assert.equal(computeDiscount({ billPaisa: 10000, mode: 'percent', value: '0' }).payablePaisa, 10000);
});

test('accepts Rs amounts with a trailing decimal separator while typing', () => {
  assert.equal(computeDiscount({ billPaisa: 10000, mode: 'amount', value: '100.' }).discountPaisa, 10000);
  assert.equal(computeDiscount({ billPaisa: 20000, mode: 'amount', value: '100.50' }).discountPaisa, 10050);
});

test('enforces the entered percentage limit even when paisa rounding would lower the discount', () => {
  assert.equal(
    computeDiscount({ billPaisa: 1, mode: 'percent', value: '10.01', maxPercent: 10 }).error,
    'Discount above your limit. Ask a manager.',
  );
});
