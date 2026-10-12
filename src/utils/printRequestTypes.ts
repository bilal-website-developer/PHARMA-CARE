import type { PrintRequestType } from './printSnapshot';

export type PrintRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PrintRequestRecord {
  id: string;
  type: PrintRequestType;
  receipt_ref: string;
  payload: unknown;
  requested_by: string;
  requester_name?: string;
  requested_at: string;
  status: PrintRequestStatus;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  printed_at: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Print request ${field} has an invalid value.`);
  return value;
}

export function parsePrintRequestRecord(value: unknown): PrintRequestRecord {
  if (!isRecord(value)) throw new Error('Received a malformed print request.');
  const { id, type, receipt_ref, requested_by, requested_at, status } = value;
  if (typeof id !== 'string'
    || (type !== 'sale' && type !== 'payment')
    || typeof receipt_ref !== 'string'
    || typeof requested_by !== 'string'
    || typeof requested_at !== 'string'
    || (status !== 'pending' && status !== 'approved' && status !== 'rejected')) {
    throw new Error('Received a print request with invalid required fields.');
  }
  return {
    id,
    type,
    receipt_ref,
    payload: value.payload,
    requested_by,
    requester_name: typeof value.requester_name === 'string' && value.requester_name.trim()
      ? value.requester_name
      : 'Unknown user',
    requested_at,
    status,
    decided_by: nullableString(value.decided_by, 'decision maker'),
    decided_at: nullableString(value.decided_at, 'decision time'),
    note: nullableString(value.note, 'note'),
    printed_at: nullableString(value.printed_at, 'print time'),
  };
}
