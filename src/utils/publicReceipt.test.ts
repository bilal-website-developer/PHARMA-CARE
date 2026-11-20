import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWhatsAppUrl,
  formatExpiryMonth,
  formatReceiptDate,
  formatReceiptMoney,
  normalizePakistaniWhatsAppNumber,
  normalizeTelephoneNumber,
  PublicReceiptRequestError,
  requestPublicReceipt,
  receiptCode,
} from './publicReceipt.ts';

test('normalizes supported Pakistani mobile formats for WhatsApp', () => {
  for (const phone of [
    '0300 123 4567',
    '300-123-4567',
    '+92 300 1234567',
    '0092 (300) 1234567',
  ]) {
    assert.equal(normalizePakistaniWhatsAppNumber(phone), '923001234567');
  }
  assert.equal(normalizePakistaniWhatsAppNumber('021-1234567'), null);
  assert.equal(normalizePakistaniWhatsAppNumber('0300-ABC-4567'), null);
  assert.equal(normalizePakistaniWhatsAppNumber('+1 202 555 0100'), null);
});

test('creates WhatsApp links with an encoded receipt message and rejects invalid numbers', () => {
  assert.equal(
    buildWhatsAppUrl('03001234567', 'Question about receipt 123456'),
    'https://wa.me/923001234567?text=Question%20about%20receipt%20123456',
  );
  assert.equal(buildWhatsAppUrl('123', 'Question'), null);
});

test('formats receipt date in Pakistan time and expiry as month and year only', () => {
  assert.equal(formatReceiptDate('2026-11-20T12:30:00Z'), '20 Nov 2026, 5:30 PM');
  assert.equal(formatExpiryMonth('2027-07'), 'Jul 2027');
  assert.equal(formatExpiryMonth('2027-13'), null);
});

test('formats receipt amounts and uses a short receipt code', () => {
  assert.equal(formatReceiptMoney(54700), 'Rs 547');
  assert.equal(formatReceiptMoney(12345678), 'Rs 123,456.78');
  assert.equal(receiptCode('INV-1234567890'), '567890');
});

test('normalizes a telephone link independently from WhatsApp', () => {
  assert.equal(normalizeTelephoneNumber('+92 (300) 123-4567'), '+923001234567');
  assert.equal(normalizeTelephoneNumber('not a number'), null);
});

test('requests public receipt data without caching and uses only the public key', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ invoiceNumber: 'INV-123456' }), { status: 200 });
  };
  const result = await requestPublicReceipt(
    'https://project.supabase.co/',
    'public-anon-key',
    'a'.repeat(64),
    true,
    fetcher,
  );
  assert.equal(capturedUrl, 'https://project.supabase.co/functions/v1/get-public-receipt');
  assert.deepEqual(result, { invoiceNumber: 'INV-123456' });
  assert.equal(capturedInit?.cache, 'no-store');
  assert.equal(capturedInit?.referrerPolicy, 'no-referrer');
  assert.equal(new Headers(capturedInit?.headers).get('apikey'), 'public-anon-key');
  assert.equal(new Headers(capturedInit?.headers).get('authorization'), 'Bearer public-anon-key');
  assert.equal(capturedInit?.body, JSON.stringify({ token: 'a'.repeat(64), revealItemNames: true }));
});

test('reports public receipt HTTP errors without exposing response content', async () => {
  await assert.rejects(
    requestPublicReceipt(
      'https://project.supabase.co',
      'public-anon-key',
      'a'.repeat(64),
      false,
      async () => new Response('private response detail', { status: 404 }),
    ),
    (error: unknown) => error instanceof PublicReceiptRequestError
      && error.status === 404
      && error.message === 'Public receipt request failed.',
  );
});
