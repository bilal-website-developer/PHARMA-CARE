import { UserRole } from '../types/pharmacy';
import {
  printHtmlDocument,
  renderPharmacyMemo,
  renderReceipt,
  type ReceiptData,
} from './receipt';
import { supabase } from './supabase';
import {
  canPrintReceipt,
  isPrintSnapshotSafe,
  parsePrintSnapshot,
  snapshotWithDuplicateLabel,
  type PrintRequestType,
  type PrintSnapshot,
} from './printSnapshot';
import { getOrCreateReceiptQrLink } from './receiptLinks';
import { parsePrintRequestSubmission } from './printRequestTypes';

export type { PrintRequestType, PrintSnapshot } from './printSnapshot';
export { buildPrintSnapshot, canPrintReceipt } from './printSnapshot';

export interface PrintReceiptAccess {
  role: UserRole;
  permissions: readonly string[];
  onNotice: (message: string, error?: boolean) => void;
}

export interface PrintReceiptOptions {
  autoPrint?: boolean;
  approvedRequestId?: string;
  autoApprovedRequestId?: string;
}

export type PrintReceiptHandler = (
  type: PrintRequestType,
  payload: PrintSnapshot,
  options?: PrintReceiptOptions,
) => Promise<PrintReceiptResult>;

export type PrintReceiptResult = 'printed' | 'requested' | 'cancelled' | 'auto-print-disabled';

function classicReceiptData(snapshot: PrintSnapshot): ReceiptData {
  const { data, settings } = snapshot;
  const itemGrossPaisa = data.lines.reduce(
    (total, line) => total + Math.round(line.qty * line.ratePaisa),
    0,
  );
  const paymentAmountPaisa = data.amountReceivedPaisa ?? 0;
  const grossPaisa = data.kind === 'PAYMENT' ? paymentAmountPaisa : itemGrossPaisa;
  const totalPaisa = grossPaisa - data.discountPaisa + (data.salesTaxPaisa ?? 0) + (data.roundingPaisa ?? 0);
  const isPayment = data.kind === 'PAYMENT';
  const paidPaisa = isPayment
    ? data.amountReceivedPaisa ?? 0
    : data.paidPaisa ?? totalPaisa;
  const balanceDuePaisa = isPayment
    ? data.balanceAfterPaisa ?? 0
    : Math.max(0, totalPaisa - paidPaisa);
  const status: ReceiptData['status'] = balanceDuePaisa === 0
    ? 'PAID'
    : paidPaisa > 0 ? 'PARTIAL' : 'CREDIT';

  return {
    storeName: settings.storeName,
    address: settings.address,
    phone: settings.phone,
    invoiceNo: data.memoNo,
    dateTime: data.dateTime,
    cashierName: data.cashier,
    customerName: data.customerName ?? '',
    paymentMode: data.paymentMode ?? (isPayment ? 'PAYMENT' : data.kind),
    status,
    isDuplicate: data.isDuplicate,
    items: data.lines.map((line) => ({
      name: line.name,
      batchNo: line.batch ?? '',
      expiry: line.expiry ?? '',
      qty: line.qty,
      unit: '',
      unitPrice: line.ratePaisa,
      lineTotal: Math.round(line.qty * line.ratePaisa),
    })),
    subtotal: grossPaisa,
    discount: data.discountPaisa,
    total: totalPaisa,
    paid: paidPaisa,
    change: data.changePaisa ?? 0,
    balanceDue: balanceDuePaisa,
    footerEnglish: settings.notes.join(' '),
    footerUrdu: '',
    showBatchNumber: settings.showBatchNumber,
    showExpiryDate: settings.showExpiryDate,
  };
}

async function requestReceiptPrint(
  type: PrintRequestType,
  snapshot: PrintSnapshot,
): Promise<ReturnType<typeof parsePrintRequestSubmission>> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const receiptRef = snapshot.data.memoNo.trim()
    || `${type}:${crypto.randomUUID()}`;
  const { data, error } = await supabase.rpc('request_print_v2', {
    p_type: type,
    p_receipt_ref: receiptRef,
    p_payload: snapshot,
    p_request_key: crypto.randomUUID(),
  });
  if (error) throw new Error(`Could not send print request: ${error.message}`);
  return parsePrintRequestSubmission(data);
}

async function claimAutoApprovedPrintRequest(requestId: string): Promise<boolean> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('claim_auto_approved_print_request', {
    p_request_id: requestId,
  });
  if (error) throw new Error(`Could not claim the auto-approved print request: ${error.message}`);
  if (typeof data !== 'boolean') throw new Error('The server returned an invalid print-claim response.');
  return data;
}

type PrintTracking =
  | { kind: 'manual'; requestId: string }
  | { kind: 'automatic'; requestId: string }
  | null;

async function printApprovedReceipt(
  type: PrintRequestType,
  snapshot: PrintSnapshot,
  access: PrintReceiptAccess,
  tracking: PrintTracking,
): Promise<void> {
  const printSnapshot = tracking ? snapshotWithDuplicateLabel(snapshot) : snapshot;
  let receiptQr: { svg: string; placement: 'footer' | 'after_totals' | 'below_header' } | undefined;
  if (type === 'sale' && printSnapshot.data.kind === 'SALE' && printSnapshot.saleId) {
    try {
      const link = await getOrCreateReceiptQrLink(printSnapshot.saleId);
      if (link) {
        const QRCode = await import('qrcode');
        receiptQr = {
          svg: await QRCode.toString(link.publicUrl, {
            type: 'svg',
            errorCorrectionLevel: 'M',
            margin: 4,
            width: 512,
            color: { dark: '#000000', light: '#ffffff' },
          }),
          placement: link.placement,
        };
      }
    } catch (error) {
      access.onNotice(
        `Receipt QR could not be generated; printing will continue without it. ${error instanceof Error ? error.message : ''}`.trim(),
        true,
      );
    }
  }
  let html: string;
  try {
    html = printSnapshot.template === 'pharmacy-memo'
      ? renderPharmacyMemo(printSnapshot.data, printSnapshot.settings, printSnapshot.format, receiptQr)
      : renderReceipt(printSnapshot.template, printSnapshot.format, classicReceiptData(printSnapshot), receiptQr);
  } catch (error) {
    html = renderReceipt('classic', printSnapshot.format, classicReceiptData(printSnapshot), receiptQr);
    access.onNotice(
      `Pharmacy Memo could not be rendered; the existing Classic receipt was used instead. ${error instanceof Error ? error.message : ''}`,
      true,
    );
  }

  await printHtmlDocument(html);
  if (tracking) {
    if (!supabase) throw new Error('Receipt was sent to the print dialog, but print tracking is unavailable because Supabase is not configured.');
    const rpc = tracking.kind === 'automatic'
      ? 'mark_auto_approved_print_request_opened'
      : 'mark_printed_request';
    const { error } = await supabase.rpc(rpc, { p_request_id: tracking.requestId });
    if (error) throw new Error(`Receipt was sent to the print dialog, but print tracking failed: ${error.message}`);
  }
}

export async function printReceipt(
  type: PrintRequestType,
  payload: PrintSnapshot,
  access: PrintReceiptAccess,
  options: PrintReceiptOptions = {},
): Promise<PrintReceiptResult> {
  const snapshot = parsePrintSnapshot(payload);
  if ((type === 'payment') !== (snapshot.data.kind === 'PAYMENT')) {
    throw new Error('Receipt type does not match the receipt snapshot.');
  }
  if (!isPrintSnapshotSafe(snapshot)) {
    throw new Error('Receipt snapshot includes fields that cannot be printed or requested.');
  }

  const hasPermission = canPrintReceipt(access.role, access.permissions, type);
  if (!hasPermission) {
    if (options.autoPrint) {
      access.onNotice('Auto-print is disabled because this account needs admin approval.', true);
      return 'auto-print-disabled';
    }
    const request = await requestReceiptPrint(type, snapshot);
    if (request.status === 'approved' && request.autoApproved && request.shouldPrint) {
      const approvedSnapshot = parsePrintSnapshot(request.payload);
      if ((type === 'payment') !== (approvedSnapshot.data.kind === 'PAYMENT')
        || !isPrintSnapshotSafe(approvedSnapshot)) {
        throw new Error('The auto-approved receipt snapshot is invalid.');
      }
      if (!await claimAutoApprovedPrintRequest(request.requestId)) {
        access.onNotice('This auto-approved receipt has already been opened for printing.', true);
        return 'requested';
      }
      await printApprovedReceipt(type, approvedSnapshot, access, {
        kind: 'automatic',
        requestId: request.requestId,
      });
      access.onNotice('Request approved automatically. Confirm printing in the browser print dialog.');
      return 'printed';
    }
    if (request.status === 'approved' && request.autoApproved) {
      access.onNotice(request.alreadyPrinted
        ? 'This auto-approved receipt was already opened for printing.'
        : 'This auto-approved receipt is already being handled.', true);
      return 'requested';
    }
    access.onNotice('Request sent to admin.');
    return 'requested';
  }

  const tracking: PrintTracking = options.approvedRequestId
    ? { kind: 'manual', requestId: options.approvedRequestId }
    : options.autoApprovedRequestId
      ? { kind: 'automatic', requestId: options.autoApprovedRequestId }
      : null;
  await printApprovedReceipt(type, snapshot, access, tracking);
  return 'printed';
}
