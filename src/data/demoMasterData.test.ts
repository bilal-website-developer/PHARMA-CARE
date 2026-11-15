import assert from 'node:assert/strict';
import test from 'node:test';
import { planDemoMasterDataChanges, summarizeDemoDataStatus } from './demoMasterData';

test('plans only missing and inactive demo master data, case-insensitively', () => {
  const plan = planDemoMasterDataChanges(
    ['Analgesics', 'Antibiotics', 'Vitamins', 'analgesics'],
    [
      { id: 'active-category', name: 'ANALGESICS', is_active: true },
      { id: 'inactive-category', name: 'Antibiotics', is_active: false },
    ],
  );

  assert.deepEqual(plan.createNames, ['Vitamins']);
  assert.deepEqual(plan.activateRows, [
    { id: 'inactive-category', name: 'Antibiotics', is_active: false },
  ]);
});

test('rejects empty required master data names', () => {
  assert.throws(() => planDemoMasterDataChanges(['  '], []), /cannot be empty/);
});

test('recognizes an active supplier left behind by a failed demo load', () => {
  assert.deepEqual(summarizeDemoDataStatus(0, true), {
    loaded: true,
    count: 0,
    supplierActive: true,
  });
  assert.deepEqual(summarizeDemoDataStatus(0, false), {
    loaded: false,
    count: 0,
    supplierActive: false,
  });
});
