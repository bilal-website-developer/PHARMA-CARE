import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDemoReceiptUrl, DEMO_RECEIPTS, DEMO_RECEIPTS_PATH } from './demoReceipt';

test('demo receipt link keeps the selected website origin and adds its own route', () => {
  assert.equal(buildDemoReceiptUrl('https://pharmacy.example/'), `https://pharmacy.example${DEMO_RECEIPTS_PATH}`);
  assert.equal(buildDemoReceiptUrl('https://pharmacy.example'), `https://pharmacy.example${DEMO_RECEIPTS_PATH}`);
  assert.equal(buildDemoReceiptUrl('http://localhost:3000'), `http://localhost:3000${DEMO_RECEIPTS_PATH}`);
  assert.throws(() => buildDemoReceiptUrl('http://pharmacy.example'));
  assert.throws(() => buildDemoReceiptUrl('https://user:password@pharmacy.example'));
});

test('demo sales are synthetic, use distinct demo invoice labels, and include return examples', () => {
  assert.ok(DEMO_RECEIPTS.length >= 3);
  assert.equal(new Set(DEMO_RECEIPTS.map((receipt) => receipt.invoiceNumber)).size, DEMO_RECEIPTS.length);
  assert.ok(DEMO_RECEIPTS.every((receipt) => receipt.invoiceNumber.startsWith('DEMO-')));
  assert.ok(DEMO_RECEIPTS.some((receipt) => receipt.creditDuePaisa !== null));
  assert.ok(DEMO_RECEIPTS.some((receipt) => receipt.items.some((item) => item.returnStatus !== 'not_returned')));
  assert.ok(DEMO_RECEIPTS.every((receipt) => receipt.items.length > 0));
});
