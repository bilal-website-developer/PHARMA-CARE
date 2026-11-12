import assert from 'node:assert/strict';
import test from 'node:test';
import { CompletedSale, PaymentMethod } from '../types/pharmacy';
import {
  filterSalesBetween,
  localEndOfDay,
  localStartOfNextDay,
  parseLocalDateInput,
  parseSaleDate,
  renderSalesReport,
  salesForPeriod,
  summarizeSales,
  withSalesReportBranding,
} from './salesReport';
import { APP_NAME } from '../constants/brand';

const sampleSale: CompletedSale = {
  id: 'sale-1',
  invoiceNumber: 'INV-1',
  timestamp: '07/10/2026, 10:30:00 am',
  cashierName: 'Cashier One',
  customerName: 'Walk-in',
  items: [
    {
      productId: 'medicine-1',
      productName: 'Panadol 500mg',
      genericName: 'Paracetamol',
      batchId: 'batch-1',
      batchNumber: 'B-10',
      expiryDate: '2027-10-01',
      drugClass: 'OTC' as CompletedSale['items'][number]['drugClass'],
      unitName: 'Strip',
      conversionFactor: 10,
      quantityInUnit: 2,
      mrpPaisaPerUnit: 5000,
      costPaisaPerUnit: 2500,
      discountPercent: 0,
      lineTotalPaisa: 10000,
      purchasePricePaisa: 2500,
      profitPaisa: 5000,
      marginPercent: 50,
    } as CompletedSale['items'][number],
  ],
  subtotalPaisa: 12000,
  discountPaisa: 2000,
  totalPaisa: 10000,
  paymentMethod: PaymentMethod.CASH,
  amountTenderedPaisa: 10000,
  changePaisa: 0,
};

test('filters sales by current day, week, and month using DD/MM/YYYY dates', () => {
  const now = new Date(2026, 9, 7, 12);
  const yesterday = { ...sampleSale, id: 'yesterday', timestamp: '06/10/2026, 11:54:23 pm' };
  const lastMonth = { ...sampleSale, id: 'last-month', timestamp: '30/09/2026, 11:54:23 pm' };

  assert.equal(salesForPeriod([sampleSale, yesterday, lastMonth], 'today', now).length, 1);
  assert.equal(salesForPeriod([sampleSale, yesterday, lastMonth], 'week', now).length, 2);
  assert.equal(salesForPeriod([sampleSale, yesterday, lastMonth], 'month', now).length, 2);
});

test('filters custom ranges inclusively using local calendar dates', () => {
  const start = parseLocalDateInput('2026-10-07');
  const end = parseLocalDateInput('2026-10-08');
  assert.ok(start);
  assert.ok(end);

  const before = { ...sampleSale, id: 'before', timestamp: new Date(2026, 9, 6, 23, 59).toISOString() };
  const after = { ...sampleSale, id: 'after', timestamp: new Date(2026, 9, 9, 0).toISOString() };
  const filtered = filterSalesBetween([before, sampleSale, after], start, localEndOfDay(end));

  assert.deepEqual(filtered.map((sale) => sale.id), ['sale-1']);
});

test('rejects invalid local dates and reversed custom ranges', () => {
  const start = parseLocalDateInput('2026-10-08');
  const end = parseLocalDateInput('2026-10-07');

  assert.equal(parseLocalDateInput('2026-02-30'), null);
  assert.ok(start);
  assert.ok(end);
  assert.deepEqual(filterSalesBetween([sampleSale], start, localEndOfDay(end)), []);
  assert.equal(localStartOfNextDay(end).getDate(), 8);
});

test('interprets ISO timestamps in the user local timezone', () => {
  const timestamp = new Date(2026, 9, 7, 23, 30).toISOString();
  const parsed = parseSaleDate(timestamp);

  assert.ok(parsed);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 9);
  assert.equal(parsed.getDate(), 7);
});

test('summarizes invoice, discount, payment method, medicine quantity and cashier totals', () => {
  const summary = summarizeSales([sampleSale]);

  assert.equal(summary.invoiceCount, 1);
  assert.equal(summary.grossSalesPaisa, 12000);
  assert.equal(summary.discountsPaisa, 2000);
  assert.equal(summary.netSalesPaisa, 10000);
  assert.equal(summary.paymentBreakdown.find(({ label }) => label === 'Cash')?.amountPaisa, 10000);
  assert.deepEqual(summary.topMedicines, [{ name: 'Panadol 500mg', quantity: 2, valuePaisa: 10000 }]);
  assert.deepEqual(summary.cashierTotals, [{ name: 'Cashier One', invoices: 1, amountPaisa: 10000 }]);
});

test('renders a safe report without private item financial fields', () => {
  const html = renderSalesReport(summarizeSales([sampleSale]), {
    storeName: APP_NAME,
    periodLabel: 'Today',
    generatedBy: 'Manager',
    generatedAt: '07/10/2026, 10:30 am',
    format: 'a4',
  });

  assert.match(html, /Panadol 500mg/);
  assert.match(html, /Rs 100/);
  const renderedContent = html.replace(/<style>[\s\S]*?<\/style>/i, '');
  assert.doesNotMatch(renderedContent, /cost|profit|margin|purchase price/i);
});

test('adds the static Pharma Care logo to printed report headers', () => {
  const html = withSalesReportBranding(renderSalesReport(summarizeSales([]), {
    storeName: APP_NAME,
    periodLabel: 'Today',
    generatedBy: 'Manager',
    generatedAt: '07/10/2026, 10:30 am',
    format: 'a4',
  }));

  assert.match(html, /<img src="\/pharma-care-512\.png" alt="Pharma Care"/);
  assert.doesNotMatch(html, /animation:/i);
});
