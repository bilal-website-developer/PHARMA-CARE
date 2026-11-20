import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReturnInvoiceInput } from './returnInvoiceInput';

test('adds the fixed invoice prefix when staff enter only the number', () => {
  assert.equal(normalizeReturnInvoiceInput('000123'), 'INV-000123');
  assert.equal(normalizeReturnInvoiceInput(''), 'INV-');
});

test('preserves new and legacy invoice numbers plus scanned receipt links', () => {
  assert.equal(normalizeReturnInvoiceInput('INV-000123'), 'INV-000123');
  assert.equal(normalizeReturnInvoiceInput('INV-1c1a92c40aa343e18472bfb38ae446a4'), 'INV-1c1a92c40aa343e18472bfb38ae446a4');
  assert.equal(normalizeReturnInvoiceInput('https://pharmacy.example/r/abc'), 'https://pharmacy.example/r/abc');
  assert.equal(normalizeReturnInvoiceInput('/r/abc'), '/r/abc');
});
