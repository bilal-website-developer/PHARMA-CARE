import assert from 'node:assert/strict';
import test from 'node:test';
import { CompletedSale, DrugClass, PaymentMethod } from '../types/pharmacy';
import {
  BillingTemplate,
  DEFAULT_PHARMACY_MEMO_SETTINGS,
  MemoData,
  ReceiptFormat,
  buildMemoData,
  buildPaymentMemoData,
  readBillingPreferences,
  readBillingPreferencesWithMigration,
  receiptDataFromSale,
  renderPharmacyMemo,
  renderReceipt,
  saveBillingPreferences,
} from './receipt';
import { readPharmacyMemoSettings } from './storeSettings';

const sale = {
  id: 'sample-sale',
  invoiceNumber: 'INV-123456',
  timestamp: '07/10/2026, 12:15 pm',
  cashierName: 'Sample Pharmacist',
  customerName: 'Sample Customer',
  customerPhone: '03000000000',
  items: [
    {
      productId: 'med-1',
      productName: 'Panadol 500mg',
      genericName: 'Paracetamol',
      batchId: 'batch-1',
      batchNumber: 'P500-A',
      expiryDate: '2027-08-31',
      drugClass: DrugClass.OTC,
      unitName: 'Strip',
      conversionFactor: 10,
      quantityInUnit: 2,
      mrpPaisaPerUnit: 45000,
      costPaisaPerUnit: 31000,
      profitPaisa: 28000,
      marginPercent: 31,
      purchasePricePaisa: 31000,
      discountPercent: 0,
      lineTotalPaisa: 90000,
    },
  ],
  subtotalPaisa: 90000,
  discountPaisa: 0,
  totalPaisa: 90000,
  paymentMethod: PaymentMethod.CASH,
  amountTenderedPaisa: 90000,
  changePaisa: 0,
} as unknown as CompletedSale;

const templates: BillingTemplate[] = ['simple', 'classic', 'professional', 'modern'];
const formats: ReceiptFormat[] = ['thermal58', 'thermal80', 'a4'];

for (const template of templates) {
  for (const format of formats) {
    test(`renders ${template} receipt for ${format} with sanitized medicine data`, () => {
      const data = receiptDataFromSale(sale, { storeName: 'Pharma Test' });
      const html = renderReceipt(template, format, data);
      assert.match(html, /Panadol 500mg/);
      assert.match(html, /P500-A/);
      assert.match(html, /Rs 900/);
      const visibleMarkup = html.replace(/<style>[\s\S]*?<\/style>/gi, '');
      assert.doesNotMatch(visibleMarkup, /\b(cost|profit|margin|purchase price)\b/i);
    });
  }
}

test('escapes user-provided receipt fields', () => {
  const data = receiptDataFromSale(sale, { storeName: '<script>alert(1)</script>' });
  const html = renderReceipt('modern', 'a4', data);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('gracefully handles missing browser storage', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    assert.deepEqual(readBillingPreferences(), { template: 'pharmacy-memo', format: 'thermal80' });
    assert.equal(saveBillingPreferences({ template: 'simple', format: 'a4' }), false);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', descriptor ?? {
      configurable: true,
      writable: true,
      value: undefined,
    });
  }
});

const memoSettings = {
  ...DEFAULT_PHARMACY_MEMO_SETTINGS,
  storeName: 'PHARMA TEST',
  address: 'Main Street',
  phone: '0300-0000000',
  terminalName: 'REGISTER-1',
};

const memoFixture: MemoData = {
  kind: 'SALE',
  memoNo: '335001',
  dateTime: '2026-10-06T21:18:58',
  customerName: 'Sample Customer',
  lines: [
    { qty: 14, name: 'Glucophage Tab 250mg', ratePaisa: 244, batch: 'B2411', expiry: '08/2027' },
    { qty: 7, name: 'MyoCure Tablet', ratePaisa: 5000, batch: 'M1022', expiry: '03/2028' },
    { qty: 7, name: 'Folic 600mg Tab', ratePaisa: 2100, batch: 'F7731', expiry: '11/2027' },
  ],
  discountPaisa: 3116,
  paidPaisa: 50000,
  cashier: 'Test Cashier',
  role: 'CASHIER',
  terminal: 'REGISTER-1',
};

function memoHtml(data = memoFixture, settings = memoSettings, format: ReceiptFormat = 'thermal80') {
  return renderPharmacyMemo(data, settings, format);
}

function printedPaisa(html: string, label: 'Gross Amount:' | 'Discount:' | 'Net Amount:'): number {
  const markup = label === 'Net Amount:'
    ? `<strong>${label}</strong><strong>(\\d+)\\.(\\d{2})`
    : `<span>${label}</span><span>(\\d+)\\.(\\d{2})`;
  const match = html.match(new RegExp(markup));
  assert.ok(match, `Expected printed ${label} amount`);
  return Number(match[1]) * 100 + Number(match[2]);
}

test('buildMemoData whitelists sale receipt fields and strips all cost and profit values', () => {
  const data = buildMemoData(sale, { role: 'CASHIER', terminal: 'REGISTER-1' });
  const serialized = JSON.stringify(data);
  assert.equal(data.kind, 'SALE');
  assert.equal(data.memoNo, sale.invoiceNumber);
  assert.equal(data.lines[0].ratePaisa, 45000);
  assert.doesNotMatch(serialized, /cost|purchase|profit|margin/i);
  assert.equal(data.isCredit, false);
});

test('prints the real discount and discounted balance for a partially paid sale', () => {
  const discountedSale: CompletedSale = {
    ...sale,
    items: [{
      ...sale.items[0],
      quantityInUnit: 1,
      mrpPaisaPerUnit: 217000,
      lineTotalPaisa: 217000,
    }],
    subtotalPaisa: 217000,
    discountPaisa: 10000,
    totalPaisa: 207000,
    amountTenderedPaisa: 50000,
    changePaisa: 0,
  };
  const data = buildMemoData(discountedSale, { role: 'CASHIER', terminal: 'REGISTER-1' });
  const html = memoHtml(data);
  assert.equal(data.discountPaisa, 10000);
  assert.equal(printedPaisa(html, 'Gross Amount:') - printedPaisa(html, 'Discount:'), printedPaisa(html, 'Net Amount:'));
  assert.match(html, /Gross Amount:<\/span><span>2170\.00/);
  assert.match(html, /Discount:<\/span><span>100\.00/);
  assert.match(html, /Net Amount:<\/strong><strong>2070\.00/);
  assert.match(html, /Paid:<\/span><span>500\.00/);
  assert.match(html, /Balance:<\/span><span>1570\.00/);
});

test('renders fixture arithmetic in paisa, including date, time, item count, gross, discount, and net', () => {
  const html = memoHtml();
  assert.match(html, /34\.16/);
  assert.match(html, /350\.00/);
  assert.match(html, /147\.00/);
  assert.match(html, /Gross Amount:<\/span><span>531\.16/);
  assert.match(html, /Discount:<\/span><span>31\.16/);
  assert.match(html, /Net Amount:<\/strong><strong>500\.00/);
  assert.match(html, /Total Items: 3/);
  assert.match(html, /06\/10\/26/);
  assert.match(html, /9:18:58 PM/);
});

for (const format of ['thermal58', 'thermal80', 'a4'] as const) {
  test(`renders the memo in ${format} with the expected paper geometry`, () => {
    const html = memoHtml(memoFixture, memoSettings, format);
    assert.match(html, /PHARMA TEST/);
    assert.match(html, /@font-face/);
    if (format === 'thermal58') assert.match(html, /width:48mm/);
    if (format === 'thermal80') assert.match(html, /width:72mm/);
    if (format === 'a4') assert.match(html, /size:A4/);
  });
}

test('rounds net to the selected amount and reflects the adjustment in printed discount', () => {
  const html = memoHtml({ ...memoFixture, discountPaisa: 2000 }, { ...memoSettings, roundNet: '5' });
  assert.equal(printedPaisa(html, 'Gross Amount:') - printedPaisa(html, 'Discount:'), printedPaisa(html, 'Net Amount:'));
  assert.match(html, /Discount:<\/span><span>21\.16/);
  assert.match(html, /Net Amount:<\/strong><strong>510\.00/);
});

test('prints only Paid and Balance for a partial payment', () => {
  const html = memoHtml({ ...memoFixture, isCredit: true, paidPaisa: 20000, discountPaisa: 3116 });
  assert.doesNotMatch(html, /Credit \/ Balance Due:/);
  assert.match(html, /Paid:<\/span><span>200\.00/);
  assert.match(html, /Balance:<\/span><span>300\.00/);
});

test('prints one Credit / Balance Due line for a fully credit sale', () => {
  const html = memoHtml({ ...memoFixture, isCredit: true, paidPaisa: 0, discountPaisa: 3116 });
  assert.match(html, /Credit \/ Balance Due:<\/strong><strong>500\.00/);
  assert.doesNotMatch(html, /<span>Balance:<\/span>/);
});

test('prints address and editable phone prefix directly under the store name, skipping blanks', () => {
  const header = memoHtml(memoFixture, {
    ...memoSettings,
    address: 'Main Street',
    phone: 'TEL: 0300-1111111 / 0300-2222222',
  }).match(/<header class="store">[\s\S]*?<\/header>/)?.[0];
  assert.equal(
    header,
    '<header class="store"><strong>PHARMA TEST</strong><span>Main Street</span><span>TEL: 0300-1111111 / 0300-2222222</span></header>'
  );
  const noOptionalLines = memoHtml(memoFixture, { ...memoSettings, address: ' ', phone: ' ' });
  assert.match(noOptionalLines, /<header class="store"><strong>PHARMA TEST<\/strong><\/header>/);
  assert.match(noOptionalLines, /\.store span\{display:block\}/);
});

test('keeps the Net Amount label and value on a single line', () => {
  const html = memoHtml();
  assert.match(html, /\.net\{display:flex;flex-wrap:nowrap;white-space:nowrap/);
  assert.match(html, /\.net strong\{white-space:nowrap\}/);
});

test('falls back to saved shop profile address and phone when memo-specific values are empty', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>([
    ['pharma-care.shopProfile', JSON.stringify({ city: 'Saved City', phone: '0300-1234567' })],
    ['pharma-care.pharmacyMemoSettings', JSON.stringify({
      ...memoSettings,
      address: '',
      phone: '',
    })],
  ]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null },
  });
  try {
    const settings = readPharmacyMemoSettings();
    assert.equal(settings.address, 'Saved City');
    assert.equal(settings.phone, '0300-1234567');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', descriptor ?? {
      configurable: true,
      writable: true,
      value: undefined,
    });
  }
});

test('includes tax in net when configured but omits the tax row when disabled', () => {
  const data = { ...memoFixture, discountPaisa: 0, salesTaxPaisa: 500 };
  const html = memoHtml(data, { ...memoSettings, printTax: false });
  assert.match(html, /Net Amount:<\/strong><strong>536\.16/);
  assert.doesNotMatch(html, /Sales Tax:/);
  assert.match(memoHtml(data, { ...memoSettings, printTax: true }), /Sales Tax:/);
});

test('renders return memo with negative amounts and original memo reference', () => {
  const html = memoHtml({ ...memoFixture, kind: 'RETURN', originalMemoNo: '335000' });
  assert.match(html, /RETURN MEMO/);
  assert.match(html, /Original Memo# 335000/);
  assert.match(html, /Refund Amount:<\/strong><strong>-500\.00/);
  assert.match(html, /-34\.16/);
});

test('payment memo uses its payment reference and does not invent an invoice number', () => {
  const payment = buildPaymentMemoData({
    referenceNo: 'RCP-1234',
    dateTime: '2026-10-06T21:18:58',
    customerName: 'Ledger Customer',
    amountReceivedPaisa: 20000,
    balanceAfterPaisa: 30000,
    cashier: 'Test Cashier',
  });
  assert.equal(payment.memoNo, 'RCP-1234');
  assert.match(memoHtml(payment), /RCP-1234/);
  assert.match(memoHtml(payment), /Amount Received:<\/strong><strong>200\.00/);
  assert.match(memoHtml(payment), /Balance After:<\/span><span>300\.00/);
  const noReference = buildPaymentMemoData({
    referenceNo: undefined,
    dateTime: payment.dateTime,
    customerName: payment.customerName ?? '',
    amountReceivedPaisa: payment.amountReceivedPaisa ?? 0,
    balanceAfterPaisa: payment.balanceAfterPaisa ?? 0,
    cashier: payment.cashier,
  });
  assert.equal(noReference.memoNo, '');
});

test('renders duplicate labels only when enabled and uses a local Urdu font with RTL direction', () => {
  const duplicate = memoHtml({ ...memoFixture, isDuplicate: true });
  assert.match(duplicate, /DUPLICATE/);
  assert.match(duplicate, /url\('\/fonts\/noto-nastaliq-urdu-arabic\.woff2'\)/);
  const urdu = memoHtml({ ...memoFixture, customerName: 'احمد' });
  assert.match(urdu, /dir="rtl" class="urdu-text">احمد/);
  assert.doesNotMatch(
    memoHtml({ ...memoFixture, isDuplicate: true }, { ...memoSettings, duplicateLabel: false }),
    /DUPLICATE/
  );
});

test('escapes user-supplied memo text and safely wraps long product names', () => {
  const hostile = memoHtml({
    ...memoFixture,
    customerName: '<script>alert(1)</script>',
    lines: [{ qty: 1, name: '<img src=x onerror=alert(1)> ' + 'Medicine '.repeat(40), ratePaisa: 100 }],
  });
  assert.doesNotMatch(hostile, /<script>|<img/);
  assert.match(hostile, /&lt;script&gt;/);
  assert.match(hostile, /overflow-wrap:anywhere/);
});

test('renders long bills without dropping any of 25 or more items', () => {
  const lines = Array.from({ length: 30 }, (_, index) => ({
    qty: 1, name: `Medicine ${index + 1}`, ratePaisa: 100,
  }));
  const html = memoHtml({ ...memoFixture, lines, discountPaisa: 0 });
  for (const line of lines) assert.ok(html.includes(line.name));
  assert.match(html, /Total Items: 30/);
});

test('a saved classic default migrates once, then preserves a later user choice', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>([
    ['pharma-care.billingPreferences', JSON.stringify({ template: 'classic', format: 'thermal80' })],
  ]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  try {
    assert.deepEqual(readBillingPreferencesWithMigration(), {
      preferences: { template: 'pharmacy-memo', format: 'thermal80' },
      migratedClassicDefault: true,
    });
    assert.equal(values.get('pharma-care.memoDefaultApplied'), 'true');
    assert.equal(saveBillingPreferences({ template: 'classic', format: 'thermal58' }), true);
    assert.equal(readBillingPreferencesWithMigration().preferences.template, 'classic');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', descriptor ?? {
      configurable: true,
      value: undefined,
    });
  }
});
