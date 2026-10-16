import type {
  BillingTemplate,
  MemoData,
  PharmacyMemoSettings,
  ReceiptFormat,
} from './receipt';
import { isAdminRole } from '../permissions';
import { UserRole } from '../types/pharmacy';

export type PrintRequestType = 'sale' | 'payment';

export type PrintSnapshot = {
  data: MemoData;
  settings: Pick<
    PharmacyMemoSettings,
    | 'storeName'
    | 'address'
    | 'phone'
    | 'notes'
    | 'terminalName'
    | 'showBatchExpiry'
    | 'roundNet'
    | 'printTax'
    | 'duplicateLabel'
    | 'numberDigits'
    | 'logoUrl'
    | 'printLogo'
  >;
  format: ReceiptFormat;
  template: BillingTemplate;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Receipt snapshot ${name} must be text.`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Receipt snapshot ${name} must be a finite number.`);
  }
  return value;
}

function requiredNumber(value: unknown, name: string): number {
  const result = optionalNumber(value, name);
  if (result === undefined) throw new Error(`Receipt snapshot ${name} is required.`);
  return result;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Receipt snapshot ${name} must be boolean.`);
  return value;
}

function cleanMemoData(value: unknown): MemoData {
  if (!isRecord(value)) throw new Error('Receipt snapshot data must be an object.');
  const kind = value.kind;
  if (kind !== 'SALE' && kind !== 'PAYMENT' && kind !== 'RETURN') {
    throw new Error('Receipt snapshot has an unsupported memo kind.');
  }
  if (!Array.isArray(value.lines)) throw new Error('Receipt snapshot lines must be an array.');

  const lines = value.lines.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Receipt snapshot line ${index + 1} must be an object.`);
    return {
      qty: requiredNumber(item.qty, `line ${index + 1} quantity`),
      name: requiredString(item.name, `line ${index + 1} name`),
      ratePaisa: requiredNumber(item.ratePaisa, `line ${index + 1} rate`),
      batch: optionalString(item.batch, `line ${index + 1} batch`),
      expiry: optionalString(item.expiry, `line ${index + 1} expiry`),
    };
  });

  return {
    kind,
    memoNo: requiredString(value.memoNo, 'memo number'),
    originalMemoNo: optionalString(value.originalMemoNo, 'original memo number'),
    dateTime: requiredString(value.dateTime, 'date and time'),
    customerName: optionalString(value.customerName, 'customer name'),
    lines,
    discountPaisa: requiredNumber(value.discountPaisa, 'discount'),
    roundingPaisa: optionalNumber(value.roundingPaisa, 'rounding'),
    salesTaxPaisa: optionalNumber(value.salesTaxPaisa, 'sales tax'),
    paidPaisa: optionalNumber(value.paidPaisa, 'paid amount'),
    changePaisa: optionalNumber(value.changePaisa, 'change amount'),
    paymentMode: optionalString(value.paymentMode, 'payment method'),
    isCredit: optionalBoolean(value.isCredit, 'credit status'),
    isDuplicate: optionalBoolean(value.isDuplicate, 'duplicate status'),
    cashier: requiredString(value.cashier, 'cashier name'),
    role: requiredString(value.role, 'role'),
    terminal: requiredString(value.terminal, 'terminal'),
    amountReceivedPaisa: optionalNumber(value.amountReceivedPaisa, 'amount received'),
    balanceAfterPaisa: optionalNumber(value.balanceAfterPaisa, 'balance after'),
  };
}

export function buildPrintSnapshot(
  data: MemoData,
  settings: PharmacyMemoSettings,
  format: ReceiptFormat,
  template: BillingTemplate = 'pharmacy-memo',
): PrintSnapshot {
  return parsePrintSnapshot({ data, settings, format, template });
}

export function parsePrintSnapshot(value: unknown): PrintSnapshot {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.settings)) {
    throw new Error('Receipt snapshot must include data and settings.');
  }
  if (!['thermal58', 'thermal80', 'a4'].includes(String(value.format))) {
    throw new Error('Receipt snapshot has an unsupported paper format.');
  }
  if (!['simple', 'classic', 'professional', 'modern', 'pharmacy-memo'].includes(String(value.template))) {
    throw new Error('Receipt snapshot has an unsupported receipt template.');
  }
  const settings = value.settings;
  if (!Array.isArray(settings.notes) || settings.notes.length !== 3
    || !settings.notes.every((note) => typeof note === 'string')) {
    throw new Error('Receipt snapshot must contain three note lines.');
  }
  if (typeof settings.showBatchExpiry !== 'boolean'
    || typeof settings.printTax !== 'boolean'
    || typeof settings.duplicateLabel !== 'boolean'
    || !['none', '1', '5', '10'].includes(String(settings.roundNet))) {
    throw new Error('Receipt snapshot has invalid print settings.');
  }
  const numberDigits = requiredNumber(settings.numberDigits, 'memo number digits');
  if (typeof settings.storeName !== 'string'
    || typeof settings.address !== 'string'
    || typeof settings.phone !== 'string'
    || typeof settings.terminalName !== 'string') {
    throw new Error('Receipt snapshot has invalid shop details.');
  }

  return {
    data: cleanMemoData(value.data),
    settings: {
      storeName: settings.storeName,
      address: settings.address,
      phone: settings.phone,
      notes: [settings.notes[0], settings.notes[1], settings.notes[2]],
      terminalName: settings.terminalName,
      showBatchExpiry: settings.showBatchExpiry,
      roundNet: settings.roundNet as PharmacyMemoSettings['roundNet'],
      printTax: settings.printTax,
      duplicateLabel: settings.duplicateLabel,
      numberDigits,
      logoUrl: typeof settings.logoUrl === 'string' ? settings.logoUrl : '',
      printLogo: typeof settings.printLogo === 'boolean' ? settings.printLogo : true,
    },
    format: value.format as ReceiptFormat,
    template: value.template as BillingTemplate,
  };
}

export function snapshotWithDuplicateLabel(snapshot: PrintSnapshot): PrintSnapshot {
  return {
    ...snapshot,
    data: { ...snapshot.data, isDuplicate: true },
    settings: { ...snapshot.settings, duplicateLabel: true },
  };
}

export function canPrintReceipt(
  role: UserRole,
  permissions: readonly string[],
  type: PrintRequestType,
): boolean {
  if (isAdminRole(role)) return true;
  const key = type === 'sale' ? 'pos_print_sale' : 'pos_print_payment';
  return permissions.includes('pos') && permissions.includes(key);
}

export function isPrintSnapshotSafe(snapshot: PrintSnapshot): boolean {
  const forbiddenField = /(cost|profit|margin|purchase.?price)/i;
  const containsForbiddenField = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsForbiddenField);
    if (!isRecord(value)) return false;
    return Object.entries(value).some(([key, nested]) =>
      forbiddenField.test(key) || containsForbiddenField(nested)
    );
  };
  return !containsForbiddenField(snapshot);
}
