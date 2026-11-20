import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPublicReceipt,
  isPublicReceiptLinkAvailable,
  isValidReceiptToken,
  publicReceiptShowsExpiry,
  publicShopLogoUrl,
  publicReceiptNotFound,
  receiptSecurityHeaders,
  type PublicReceiptSource,
} from './logic.ts';

const source: PublicReceiptSource = {
  shop: {
    name: 'Safe Pharmacy',
    address: 'Main Road',
    phone: '0300-0000000',
    logo_url: 'https://itdetfyxrwixhxsfydfz.supabase.co/storage/v1/object/public/shop-logos/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp',
  },
  sale: {
    invoice_number: 'INV-000123',
    timestamp: '2026-11-18T10:00:00Z',
    discount_paisa: 1000,
    total_paisa: 24000,
    change_paisa: 0,
  },
  payments: [{ payment_method: 'CREDIT', amount_paisa: 24000 }],
  items: [{
    product_name: 'Sample Medicine',
    unit_name: 'Box',
    quantity_in_unit: 2,
    quantity_base_units: 20,
    price_paisa_per_unit: 12500,
    line_total_paisa: 25000,
    returned_base_units: 10,
    pending_base_units: 0,
    expiry_months: ['2027-08', '2028-08'],
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
    expiryMonths: ['2027-08', '2028-08'],
    returnStatus: 'partially_returned',
  });
  assert.deepEqual(Object.keys(receipt).sort(), [
    'changePaisa', 'creditDuePaisa', 'dateTime', 'discountPaisa', 'invoiceNumber',
    'items', 'itemsHidden', 'paidPaisa', 'paymentMethods', 'paymentStatus', 'shop', 'totalPaisa',
  ]);
  assert.deepEqual(Object.keys(receipt.shop).sort(), ['address', 'logoUrl', 'name', 'phone']);
  assert.equal(receipt.shop.logoUrl, source.shop.logo_url);
  assert.deepEqual(Object.keys(receipt.items[0]).sort(), [
    'expiryMonths', 'lineTotalPaisa', 'name', 'pricePaisa', 'quantity', 'returnStatus', 'unit',
  ]);
  assert.equal(receipt.paidPaisa, 0);
  assert.equal(receipt.paymentStatus, 'due');
  assert.doesNotMatch(JSON.stringify(receipt), /customer|supplier|cost|margin|profit|staff|email|internalid|allocationId|batchId|batchNumber|2027-08-31/i);
});

test('public receipt only accepts same-project shop logos owned by the linked shop', () => {
  const projectUrl = 'https://itdetfyxrwixhxsfydfz.supabase.co';
  const shopId = '11111111-1111-4111-8111-111111111111';
  const logoUrl = `${projectUrl}/storage/v1/object/public/shop-logos/${shopId}/22222222-2222-4222-8222-222222222222.webp`;
  assert.equal(publicShopLogoUrl(logoUrl, projectUrl, shopId), logoUrl);
  assert.equal(publicShopLogoUrl(null, projectUrl, shopId), null);
  assert.equal(publicShopLogoUrl(logoUrl, projectUrl, '33333333-3333-4333-8333-333333333333'), null);
  assert.equal(publicShopLogoUrl(logoUrl.replace(projectUrl, 'https://other.example'), projectUrl, shopId), null);
  assert.equal(publicShopLogoUrl(logoUrl.replace('.webp', '.svg'), projectUrl, shopId), null);
});

test('hiding medicine names emits generic lines and cash receipts expose no credit due', () => {
  const hidden = buildPublicReceipt(source, false);
  assert.equal(hidden.items[0].name, 'Item 1');
  assert.equal(hidden.itemsHidden, true);
  const cash = buildPublicReceipt({
    ...source,
    payments: [{ payment_method: 'CASH', amount_paisa: 24000 }],
    has_credit: false,
  }, true);
  assert.equal(cash.creditDuePaisa, null);
  assert.equal(cash.paidPaisa, 24000);
  assert.equal(cash.paymentStatus, 'paid');
});

test('public expiry setting defaults on and a pending return is exposed without batch data', () => {
  assert.equal(publicReceiptShowsExpiry({ memo: { showExpiryDate: false } }), false);
  assert.equal(publicReceiptShowsExpiry({ memo: { showExpiryDate: true } }), true);
  assert.equal(publicReceiptShowsExpiry({}), true);
  const receipt = buildPublicReceipt({
    ...source,
    items: [{ ...source.items[0], pending_base_units: 1 }],
  }, true, false);
  assert.deepEqual(receipt.items[0], {
    name: 'Sample Medicine',
    unit: 'Box',
    quantity: 2,
    pricePaisa: 12500,
    lineTotalPaisa: 25000,
    returnStatus: 'pending',
  });
  assert.equal(receipt.paymentMethods[0].method, 'CREDIT');
  assert.equal(receipt.paymentMethods[0].amountPaisa, 24000);
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
