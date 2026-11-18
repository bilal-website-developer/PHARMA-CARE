import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPublicReceipt,
  isPublicReceiptLinkAvailable,
  isValidReceiptToken,
  publicReceiptNotFound,
  receiptSecurityHeaders,
  type PublicReceiptSource,
} from './logic.ts';

const source: PublicReceiptSource = {
  shop: { name: 'Safe Pharmacy', address: 'Main Road', phone: '0300-0000000' },
  sale: {
    invoice_number: 'INV-000123',
    timestamp: '2026-11-18T10:00:00Z',
    subtotal_paisa: 25000,
    discount_paisa: 1000,
    total_paisa: 24000,
    amount_tendered_paisa: 15000,
    change_paisa: 0,
    status: 'PARTIALLY_RETURNED',
  },
  items: [{
    product_name: 'Sample Medicine',
    unit_name: 'Box',
    quantity_in_unit: 2,
    quantity_base_units: 20,
    price_paisa_per_unit: 12500,
    line_total_paisa: 25000,
    returned_base_units: 10,
  }],
  credit_due_paisa: 9000,
  has_credit: true,
};

test('public receipt only returns the approved allowlist and item return state', () => {
  const receipt = buildPublicReceipt(source, true);
  assert.deepEqual(receipt.items[0], {
    name: 'Sample Medicine',
    unit: 'Box',
    quantity: 2,
    pricePaisa: 12500,
    lineTotalPaisa: 25000,
    returnStatus: 'partially_returned',
  });
  assert.deepEqual(Object.keys(receipt).sort(), [
    'changePaisa', 'creditDuePaisa', 'dateTime', 'discountPaisa', 'invoiceNumber',
    'items', 'paidPaisa', 'shop', 'status', 'totalPaisa',
  ]);
  assert.deepEqual(Object.keys(receipt.shop).sort(), ['address', 'name', 'phone']);
  assert.deepEqual(Object.keys(receipt.items[0]).sort(), [
    'lineTotalPaisa', 'name', 'pricePaisa', 'quantity', 'returnStatus', 'unit',
  ]);
  assert.doesNotMatch(JSON.stringify(receipt), /customer|supplier|batch|expiry|cost|margin|profit|staff|email|internalid/i);
});

test('hiding medicine names emits generic lines and cash receipts expose no credit due', () => {
  const hidden = buildPublicReceipt(source, false);
  assert.equal(hidden.items[0].name, 'Item 1');
  const cash = buildPublicReceipt({ ...source, has_credit: false }, true);
  assert.equal(cash.creditDuePaisa, null);
});

test('only high-entropy hex receipt tokens are accepted', () => {
  assert.equal(isValidReceiptToken('a'.repeat(64)), true);
  assert.equal(isValidReceiptToken('a'.repeat(63)), false);
  assert.equal(isValidReceiptToken('INV-000123'), false);
});

test('public receipt links are blocked when expired, revoked, or suspended', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(isPublicReceiptLinkAvailable('2026-11-19T12:00:00Z', null, true, now), true);
  assert.equal(isPublicReceiptLinkAvailable('2026-11-17T12:00:00Z', null, true, now), false);
  assert.equal(isPublicReceiptLinkAvailable('2026-11-19T12:00:00Z', '2026-11-18T11:00:00Z', true, now), false);
  assert.equal(isPublicReceiptLinkAvailable('2026-11-19T12:00:00Z', null, false, now), false);
});

test('public endpoint failures share a generic not-found body and strict security headers', () => {
  assert.deepEqual(publicReceiptNotFound(), { error: 'Receipt not found.' });
  const headers = new Headers(receiptSecurityHeaders('https://pharma.example', 'https://pharma.example'));
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://pharma.example');
  assert.equal(headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(headers.get('Content-Security-Policy') ?? '', /default-src 'none'/);
  const rejectedOrigin = new Headers(receiptSecurityHeaders('https://attacker.example', 'https://pharma.example'));
  assert.equal(rejectedOrigin.get('Access-Control-Allow-Origin'), null);
});
