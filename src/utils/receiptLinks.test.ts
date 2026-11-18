import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeReceiptBaseUrl,
  parseReceiptQrLink,
  parseReceiptQrSettings,
  parseReceiptScan,
} from './receiptLinkLogic';

test('validates the public app URL as an HTTPS origin', () => {
  assert.equal(normalizeReceiptBaseUrl('https://pharma.example/'), 'https://pharma.example');
  for (const value of [
    'http://pharma.example',
    'https://pharma.example/app',
    'https://user:password@pharma.example',
    'https://pharma.example?next=/',
    'not a URL',
  ]) {
    assert.throws(() => normalizeReceiptBaseUrl(value));
  }
});

test('parses shop QR settings and rejects malformed placement or lifetime', () => {
  assert.deepEqual(parseReceiptQrSettings({
    publicReceiptsEnabled: false,
    linkLifetimeDays: 90,
    showMedicineNames: true,
    qrPlacement: 'footer',
    qrBaseUrl: '',
  }), {
    publicReceiptsEnabled: false,
    linkLifetimeDays: 90,
    showMedicineNames: true,
    qrPlacement: 'footer',
    qrBaseUrl: '',
  });
  assert.throws(() => parseReceiptQrSettings({
    publicReceiptsEnabled: true,
    linkLifetimeDays: 0,
    showMedicineNames: true,
    qrPlacement: 'header',
    qrBaseUrl: 'https://pharma.example',
  }));
});

test('builds a receipt URL only from an opaque high-entropy token and HTTPS origin', () => {
  const parsed = parseReceiptQrLink({
    token: 'a'.repeat(64),
    expiresAt: '2027-01-01T00:00:00Z',
    qrBaseUrl: 'https://pharma.example/',
    qrPlacement: 'footer',
  });
  assert.equal(parsed.publicUrl, `https://pharma.example/r/${'a'.repeat(64)}`);
  assert.throws(() => parseReceiptQrLink({
    token: 'INV-123',
    expiresAt: '2027-01-01T00:00:00Z',
    qrBaseUrl: 'https://pharma.example',
    qrPlacement: 'footer',
  }));
});

test('receipt scanner accepts receipt URLs and plain invoice numbers, including slash paths', () => {
  const token = 'b'.repeat(64);
  assert.deepEqual(parseReceiptScan(`https://pharma.example/r/${token}`), { kind: 'link', token });
  assert.deepEqual(parseReceiptScan(`/r/${token}/`), { kind: 'link', token });
  assert.deepEqual(parseReceiptScan('INV-000123'), { kind: 'invoice', invoiceNumber: 'INV-000123' });
  assert.equal(parseReceiptScan(`https://pharma.example/r/${token}?redirect=elsewhere`), null);
  assert.equal(parseReceiptScan(`https://pharma.example/r/${'x'.repeat(64)}`), null);
});
