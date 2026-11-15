import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentMethod } from '../types/pharmacy';
import { formatPaymentDetails } from './paymentDetails';

test('formats persisted provider, amount, and reference details', () => {
  assert.equal(formatPaymentDetails([
    { paymentMethod: PaymentMethod.CASH, providerId: 'cash', amountPaisa: 500000 },
    { paymentMethod: PaymentMethod.CARD, providerId: 'nayapay', amountPaisa: 250000, reference: 'TID-10' },
  ], 'SPLIT'), 'Cash: Rs. 5000.00 + NayaPay: Rs. 2500.00 · Ref: TID-10');
});

test('keeps legacy sale payment labels when detailed rows are absent', () => {
  assert.equal(formatPaymentDetails(undefined, 'CASH'), 'CASH');
});
