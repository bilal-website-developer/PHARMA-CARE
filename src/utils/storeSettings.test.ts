import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PHARMACY_MEMO_SETTINGS } from './receipt';
import { getPharmacyMemoSettingsValidationMessage } from './storeSettings';

test('accepts valid Pharmacy Memo settings', () => {
  assert.equal(getPharmacyMemoSettingsValidationMessage(DEFAULT_PHARMACY_MEMO_SETTINGS), null);
});

test('reports the exact required Pharmacy Memo field', () => {
  assert.match(
    getPharmacyMemoSettingsValidationMessage({
      ...DEFAULT_PHARMACY_MEMO_SETTINGS,
      storeName: '   ',
    }) ?? '',
    /shop name/i,
  );
  assert.match(
    getPharmacyMemoSettingsValidationMessage({
      ...DEFAULT_PHARMACY_MEMO_SETTINGS,
      terminalName: '',
    }) ?? '',
    /terminal name/i,
  );
  assert.match(
    getPharmacyMemoSettingsValidationMessage({
      ...DEFAULT_PHARMACY_MEMO_SETTINGS,
      notes: ['First note', ' ', 'Third note'],
    }) ?? '',
    /memo note 2/i,
  );
  assert.match(
    getPharmacyMemoSettingsValidationMessage({
      ...DEFAULT_PHARMACY_MEMO_SETTINGS,
      numberDigits: 21,
    }) ?? '',
    /whole number from 1 to 20/i,
  );
});
