import assert from 'node:assert/strict';
import test from 'node:test';
import { isReturnSubmission } from './saleReturns';

test('accepts pending returns and server-completed automatic quarantine returns', () => {
  assert.equal(isReturnSubmission({
    id: 'return-pending',
    status: 'PENDING',
    invoiceNumber: 'INV-000123',
  }), true);
  assert.equal(isReturnSubmission({
    id: 'return-auto',
    invoiceNumber: 'INV-000124',
    status: 'COMPLETED',
    autoProcessed: true,
    refundMethod: 'CASH',
    refundTotalPaisa: 2500,
    customerBalancePaisa: null,
    customerStoreCreditPaisa: null,
    items: [{
      productName: 'Medicine',
      unitName: 'Tablet',
      quantityBaseUnits: 1,
      disposition: 'QUARANTINE',
      refundPaisa: 2500,
    }],
  }), true);
});

test('does not accept an untagged or malformed completed return submission', () => {
  assert.equal(isReturnSubmission({
    id: 'return-completed',
    invoiceNumber: 'INV-000125',
    status: 'COMPLETED',
    autoProcessed: false,
  }), false);
  assert.equal(isReturnSubmission({
    id: 'return-auto',
    invoiceNumber: 'INV-000126',
    status: 'COMPLETED',
    autoProcessed: true,
    refundMethod: 'CASH',
    refundTotalPaisa: 2500,
    customerBalancePaisa: null,
    customerStoreCreditPaisa: null,
    items: [{
      productName: 'Medicine',
      unitName: 'Tablet',
      quantityBaseUnits: 1,
      disposition: 'RESTOCK',
      refundPaisa: 2500,
    }],
  }), false);
  assert.equal(isReturnSubmission({ id: 'return-pending', status: 'PENDING' }), false);
});
