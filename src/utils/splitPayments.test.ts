import assert from 'node:assert/strict';
import test from 'node:test';
import { getSplitPaymentSummary, parsePaisaAmount } from './splitPayments';

test('parses positive PKR values exactly to paisa', () => {
  assert.equal(parsePaisaAmount('5000'), 500000);
  assert.equal(parsePaisaAmount('12.3'), 1230);
  assert.equal(parsePaisaAmount('12.34'), 1234);
});

test('rejects malformed, negative, and over-precision values', () => {
  assert.equal(parsePaisaAmount(''), null);
  assert.equal(parsePaisaAmount('-1'), null);
  assert.equal(parsePaisaAmount('1.001'), null);
});

test('split summary requires positive rows and an exact total', () => {
  assert.deepEqual(getSplitPaymentSummary([{ amount: '50' }, { amount: '50' }], 10000), {
    paidPaisa: 10000,
    remainingPaisa: 0,
    hasValidRows: true,
    isBalanced: true,
  });
  assert.equal(getSplitPaymentSummary([{ amount: '0' }], 10000).isBalanced, false);
  assert.equal(getSplitPaymentSummary([{ amount: '99.99' }], 10000).remainingPaisa, 1);
});
