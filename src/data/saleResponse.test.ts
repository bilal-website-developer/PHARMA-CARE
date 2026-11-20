import assert from 'node:assert/strict';
import test from 'node:test';
import { findSavedSaleForResponse } from './saleResponse';

const savedSale = { id: 'sale-1', invoiceNumber: 'INV-1' };

test('recovers a posted sale only when history contains the response id', () => {
  assert.equal(findSavedSaleForResponse({ id: 'sale-1', malformed: true }, [savedSale]), savedSale);
  assert.equal(findSavedSaleForResponse({ id: 'sale-2' }, [savedSale]), null);
});

test('does not guess which sale was posted when the response has no id', () => {
  assert.equal(findSavedSaleForResponse({ totalPaisa: 50000 }, [savedSale]), null);
  assert.equal(findSavedSaleForResponse(null, [savedSale]), null);
});
