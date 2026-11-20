import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePrintRequestSubmission } from './printRequestTypes';

test('parses an auto-approved print response for the requesting device', () => {
  const payload = { data: { kind: 'SALE' } };
  assert.deepEqual(parsePrintRequestSubmission({
    requestId: 'request-1',
    type: 'sale',
    receiptRef: 'INV-000123',
    status: 'approved',
    payload,
    autoApproved: true,
    shouldPrint: true,
    alreadyPrinted: false,
  }), {
    requestId: 'request-1',
    type: 'sale',
    receiptRef: 'INV-000123',
    status: 'approved',
    payload,
    autoApproved: true,
    shouldPrint: true,
    alreadyPrinted: false,
  });
});

test('rejects malformed or contradictory print request responses', () => {
  assert.throws(() => parsePrintRequestSubmission({
    requestId: 'request-1',
    type: 'sale',
    receiptRef: 'INV-000123',
    status: 'approved',
    autoApproved: 'yes',
    shouldPrint: true,
    alreadyPrinted: false,
  }), /invalid print request response/);
  assert.throws(() => parsePrintRequestSubmission({
    requestId: 'request-1',
    type: 'sale',
    receiptRef: 'INV-000123',
    status: 'pending',
    autoApproved: false,
    shouldPrint: true,
    alreadyPrinted: false,
  }), /invalid print request response/);
});
