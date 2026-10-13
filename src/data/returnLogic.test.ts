import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateReturnAmountPaisa, getRestockEligibilityReason } from './returnLogic';

test('allocates integer-paisa partial refunds cumulatively without exceeding the line total', () => {
  const line = { soldQuantityBaseUnits: 3, lineTotalPaisa: 1000, alreadyReturnedBaseUnits: 0 };
  const first = calculateReturnAmountPaisa(line, 1);
  const second = calculateReturnAmountPaisa({ ...line, alreadyReturnedBaseUnits: 1 }, 1);
  const last = calculateReturnAmountPaisa({ ...line, alreadyReturnedBaseUnits: 2 }, 1);

  assert.deepEqual([first, second, last], [333, 333, 334]);
  assert.equal(first + second + last, 1000);
});

test('rejects a return that exceeds the remaining sold quantity', () => {
  assert.throws(
    () => calculateReturnAmountPaisa({
      soldQuantityBaseUnits: 10,
      lineTotalPaisa: 2000,
      alreadyReturnedBaseUnits: 8,
    }, 3),
    RangeError,
  );
});

const eligibleConditions = {
  sealedIntact: true,
  drugClass: 'OTC',
  storageCondition: 'ROOM_TEMPERATURE',
  saleDate: '2026-10-10',
  expiryDate: '2027-02-01',
  returnWindowDays: 7,
  minimumShelfLifeDays: 90,
  today: '2026-10-13',
};

test('allows restock when all safety conditions are satisfied', () => {
  assert.equal(getRestockEligibilityReason(eligibleConditions), null);
});

test('blocks opened, cold-chain, controlled, and narcotic returns from restock', () => {
  assert.match(getRestockEligibilityReason({ ...eligibleConditions, sealedIntact: false }) ?? '', /sealed/);
  assert.match(getRestockEligibilityReason({
    ...eligibleConditions,
    storageCondition: 'COLD_REFRIGERATED',
  }) ?? '', /Cold-chain/);
  assert.match(getRestockEligibilityReason({ ...eligibleConditions, drugClass: 'CONTROLLED' }) ?? '', /Controlled/);
  assert.match(getRestockEligibilityReason({ ...eligibleConditions, drugClass: 'NARCOTIC' }) ?? '', /Controlled/);
});

test('blocks expired, short-shelf-life, and out-of-window returns from restock', () => {
  assert.match(getRestockEligibilityReason({
    ...eligibleConditions,
    expiryDate: '2026-10-12',
  }) ?? '', /remaining shelf life/);
  assert.match(getRestockEligibilityReason({
    ...eligibleConditions,
    expiryDate: '2026-12-01',
  }) ?? '', /remaining shelf life/);
  assert.match(getRestockEligibilityReason({
    ...eligibleConditions,
    saleDate: '2026-10-01',
  }) ?? '', /return window/);
});
