import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrintSnapshot, parsePrintSnapshot } from './printSnapshot';
import { DEFAULT_PHARMACY_MEMO_SETTINGS, PHARMACY_MEMO_TEST_FIXTURE } from './receipt';
import { recalculateEditableReceipt } from './printRequestEditor';

const snapshot = () => buildPrintSnapshot({
  ...PHARMACY_MEMO_TEST_FIXTURE,
  lines: [
    { qty: 2, name: 'Medicine A', ratePaisa: 1000 },
    { qty: 1, name: 'Medicine B', ratePaisa: 500 },
  ],
  discountPaisa: 0,
  paidPaisa: 5000,
  changePaisa: 1500,
}, { ...DEFAULT_PHARMACY_MEMO_SETTINGS, roundNet: 'none' }, 'thermal80');

test('recalculates editable item rows, discount, rounding, and cash change', () => {
  const updated = recalculateEditableReceipt(snapshot(), [
    { qty: 1, name: ' Medicine A ', ratePaisa: 1000 },
    { qty: 1, name: 'Medicine C', ratePaisa: 500 },
  ], 200);

  assert.equal(updated.data.lines.length, 2);
  assert.equal(updated.data.lines[0].name, 'Medicine A');
  assert.equal(updated.data.discountPaisa, 200);
  assert.equal(updated.data.roundingPaisa, 0);
  assert.equal(updated.data.changePaisa, 3700);
  assert.deepEqual(parsePrintSnapshot(updated), updated);
});

test('rounds edited receipt total using saved settings', () => {
  const original = buildPrintSnapshot({
    ...PHARMACY_MEMO_TEST_FIXTURE,
    lines: [{ qty: 1, name: 'Medicine A', ratePaisa: 10551 }],
    discountPaisa: 0,
    paidPaisa: 20000,
  }, { ...DEFAULT_PHARMACY_MEMO_SETTINGS, roundNet: '1' }, 'thermal80');
  const updated = recalculateEditableReceipt(original, original.data.lines, 0);
  assert.equal(updated.data.roundingPaisa, 49);
  assert.equal(updated.data.changePaisa, 9400);
});

test('rejects empty rows, invalid values, excess discount, and payment memos', () => {
  const current = snapshot();
  assert.throws(() => recalculateEditableReceipt(current, [], 0), /between 1 and 100/);
  assert.throws(() => recalculateEditableReceipt(current, [{ qty: 0, name: 'Medicine', ratePaisa: 10 }], 0), /invalid/);
  assert.throws(() => recalculateEditableReceipt(current, current.data.lines, 5000), /cannot exceed/);
  assert.throws(() => recalculateEditableReceipt({
    ...current,
    data: { ...current.data, kind: 'PAYMENT', lines: [] },
  }, [], 0), /Only sale/);
});
