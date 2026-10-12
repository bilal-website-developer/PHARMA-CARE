import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDiscount, formatDiscountLimit } from './discount';

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
  const result = computeDiscount({ billPaisa: 10000, mode: 'amount', value: '100.01' });
  assert.equal(result.discountPaisa, 10000);
  assert.equal(result.limited, true);
});

test('rejects negative values and amounts with more than two decimals', () => {
  assert.ok(computeDiscount({ billPaisa: 10000, mode: 'amount', value: '-1' }).error);
  assert.ok(computeDiscount({ billPaisa: 10000, mode: 'amount', value: '1.001' }).error);
});

test('accepts 100 percent and rejects values above 100 percent', () => {
  assert.equal(computeDiscount({ billPaisa: 10000, mode: 'percent', value: '100' }).payablePaisa, 0);
  assert.equal(computeDiscount({ billPaisa: 10000, mode: 'percent', value: '100.01' }).error, 'Discount cannot exceed 100%.');
});

test('accepts common Rs amounts within the maximum', () => {
  for (const value of ['10', '35', '15', '16', '12.50']) {
    assert.equal(computeDiscount({ billPaisa: 100000, mode: 'amount', value, maxPaisa: 20000 }).error, undefined);
  }
});

test('accepts exactly Rs 200 and limits larger amounts to Rs 200', () => {
  assert.equal(
    computeDiscount({ billPaisa: 100000, mode: 'amount', value: '200', maxPaisa: 20000 }).discountPaisa,
    20000,
  );
  assert.deepEqual(
    computeDiscount({ billPaisa: 1000000, mode: 'amount', value: '200.01', maxPaisa: 20000 }),
    { discountPaisa: 20000, payablePaisa: 980000, percentShown: 2, limited: true, maxDiscountPaisa: 20000 },
  );
});

test('limits percentage discounts to Rs 200', () => {
  assert.deepEqual(
    computeDiscount({ billPaisa: 217000, mode: 'percent', value: '20', maxPercent: 30, maxPaisa: 20000 }),
    { discountPaisa: 20000, payablePaisa: 197000, percentShown: 9.21, limited: true, maxDiscountPaisa: 20000 },
  );
});

test('limits a cashier to the role cap when it is below Rs 200', () => {
  assert.deepEqual(
    computeDiscount({ billPaisa: 100000, mode: 'amount', value: '150', maxPercent: 10, maxPaisa: 20000 }),
    { discountPaisa: 10000, payablePaisa: 90000, percentShown: 10, limited: true, maxDiscountPaisa: 10000 },
  );
});

test('limits discounts to the bill amount when the bill is below Rs 200', () => {
  assert.deepEqual(
    computeDiscount({ billPaisa: 15000, mode: 'amount', value: '200', maxPercent: 100, maxPaisa: 20000 }),
    { discountPaisa: 15000, payablePaisa: 0, percentShown: 100, limited: true, maxDiscountPaisa: 15000 },
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

test('caps percent mode using the role percent limit', () => {
  const result = computeDiscount({ billPaisa: 1_000_000, mode: 'percent', value: '20', maxPercent: 10, maxPaisa: 20000 });
  assert.equal(result.discountPaisa, 20000);
  assert.equal(result.limited, true);
});

test('formats lower role and bill caps for limit messages', () => {
  assert.equal(formatDiscountLimit(10000), '100');
  assert.equal(formatDiscountLimit(1550), '15.50');
});
