import assert from 'node:assert/strict';
import test from 'node:test';
import { CompletedSale, DrugClass, PaymentMethod } from '../types/pharmacy';
import { BillingTemplate, ReceiptFormat, receiptDataFromSale, renderReceipt } from './receipt';

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
