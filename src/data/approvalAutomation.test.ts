import assert from 'node:assert/strict';
import test from 'node:test';
import { parseApprovalAutomationSettings } from './approvalAutomation';

test('parses the two independent shop automation settings', () => {
  assert.deepEqual(parseApprovalAutomationSettings({
    autoApprovePrintRequests: true,
    autoProcessReturns: false,
  }), {
    autoApprovePrintRequests: true,
    autoProcessReturns: false,
  });
});

test('rejects missing or non-boolean automation settings', () => {
  assert.throws(() => parseApprovalAutomationSettings({ autoApprovePrintRequests: true }), /invalid approval automation settings/);
  assert.throws(() => parseApprovalAutomationSettings({
    autoApprovePrintRequests: 'true',
    autoProcessReturns: false,
  }), /invalid approval automation settings/);
});
