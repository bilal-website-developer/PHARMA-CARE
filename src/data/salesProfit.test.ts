import assert from 'node:assert/strict';
import test from 'node:test';
import { isSalesProfitSummary } from './salesProfit';

test('accepts a complete profit summary whose daily values reconcile', () => {
  assert.equal(isSalesProfitSummary({
    revenuePaisa: 50000,
    costPaisa: 32000,
    grossProfitPaisa: 18000,
    orderCount: 2,
    daily: [{
      date: '2026-11-20',
      revenuePaisa: 50000,
      costPaisa: 32000,
      grossProfitPaisa: 18000,
      orderCount: 2,
    }],
  }), true);
});

test('rejects profit summaries with incomplete or inconsistent values', () => {
  assert.equal(isSalesProfitSummary({
    revenuePaisa: 50000,
    costPaisa: 32000,
    grossProfitPaisa: 18000,
    orderCount: 0,
    daily: [],
  }), false);
  assert.equal(isSalesProfitSummary({
    revenuePaisa: 50000,
    costPaisa: 32000,
    grossProfitPaisa: 20000,
    orderCount: 2,
    daily: [{
      date: '2026-11-20',
      revenuePaisa: 50000,
      costPaisa: 32000,
      grossProfitPaisa: 18000,
      orderCount: 2,
    }],
  }), false);
});
