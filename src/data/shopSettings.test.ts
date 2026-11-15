import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShopOperationalSettings, toShopSettingsRpcPayload } from '../utils/shopSettings';

const serverSettings = {
  billingTemplate: 'pharmacy-memo',
  receiptFormat: 'thermal80',
  maxDiscountPaisa: 20000,
  roleDiscountPercentCap: { admin: 30, manager: 15, cashier: 10, accountant: 0 },
  expiryWarningDays: 90,
  memo: {
    notes: ['Return policy', 'Excluded items', 'Signature required'],
    terminalName: 'SERVER-PC',
    showBatchExpiry: true,
    roundNet: 'none',
    printTax: false,
    duplicateLabel: true,
    autoPrint: false,
    numberDigits: 6,
    printLogo: true,
  },
};

test('parses the server shop settings shape and maps billing preferences', () => {
  const settings = parseShopOperationalSettings(serverSettings);
  assert.equal(settings.template, 'pharmacy-memo');
  assert.equal(settings.format, 'thermal80');
  assert.equal(settings.memo.notes[1], 'Excluded items');
  assert.deepEqual(toShopSettingsRpcPayload(settings), serverSettings);
});

test('rejects invalid server settings rather than silently using local values', () => {
  assert.throws(
    () => parseShopOperationalSettings({ ...serverSettings, billingTemplate: 'unknown' }),
    /invalid shop billing settings/i,
  );
  assert.throws(
    () => parseShopOperationalSettings({
      ...serverSettings,
      roleDiscountPercentCap: { ...serverSettings.roleDiscountPercentCap, accountant: 1 },
    }),
    /Accountant discount cap/i,
  );
  assert.throws(
    () => parseShopOperationalSettings({
      ...serverSettings,
      memo: { ...serverSettings.memo, numberDigits: 0 },
    }),
    /memo number digits/i,
  );
});
