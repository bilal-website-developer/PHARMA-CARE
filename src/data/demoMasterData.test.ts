import assert from 'node:assert/strict';
import test from 'node:test';
import { planDemoMasterDataChanges } from './demoMasterData';

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
