import {
  BillingPreferences,
  BillingTemplate,
  MemoRounding,
  PharmacyMemoSettings,
  ReceiptFormat,
} from './receipt';

export interface ShopOperationalSettings extends BillingPreferences {
  maxDiscountPaisa: number;
  roleDiscountPercentCap: {
    admin: number;
    manager: number;
    cashier: number;
    accountant: number;
  };
  expiryWarningDays: number;
  memo: Pick<
    PharmacyMemoSettings,
    | 'notes'
    | 'terminalName'
    | 'showBatchNumber'
    | 'showExpiryDate'
    | 'roundNet'
    | 'printTax'
    | 'duplicateLabel'
    | 'autoPrint'
    | 'numberDigits'
    | 'printLogo'
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function requireIntegerInRange(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`The server returned invalid shop settings for ${field}.`);
  }
  return value;
}

function requireNumberInRange(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`The server returned invalid shop settings for ${field}.`);
  }
  return value;
}

export function parseShopOperationalSettings(value: unknown): ShopOperationalSettings {
  if (!isRecord(value)) {
    throw new Error('The server returned invalid shop settings.');
  }

  if (!isOneOf<BillingTemplate>(value.billingTemplate, [
    'simple',
    'classic',
    'professional',
    'modern',
    'pharmacy-memo',
  ]) || !isOneOf<ReceiptFormat>(value.receiptFormat, ['thermal58', 'thermal80', 'a4'])) {
    throw new Error('The server returned invalid shop billing settings.');
  }

  const caps = value.roleDiscountPercentCap;
  if (!isRecord(caps)) {
    throw new Error('The server returned invalid shop discount caps.');
  }

  const memo = value.memo;
  const legacyShowBatchExpiry = isRecord(memo) && typeof memo.showBatchExpiry === 'boolean'
    ? memo.showBatchExpiry
    : true;
  if (!isRecord(memo) || !Array.isArray(memo.notes) || memo.notes.length !== 3
    || !memo.notes.every((note) => typeof note === 'string' && note.trim().length > 0 && note.length <= 200)
    || typeof memo.terminalName !== 'string' || !memo.terminalName.trim() || memo.terminalName.length > 80
    || (memo.showBatchNumber !== undefined && typeof memo.showBatchNumber !== 'boolean')
    || (memo.showExpiryDate !== undefined && typeof memo.showExpiryDate !== 'boolean')
    || (memo.showBatchExpiry !== undefined && typeof memo.showBatchExpiry !== 'boolean')
    || !isOneOf<MemoRounding>(memo.roundNet, ['none', '1', '5', '10'])
    || typeof memo.printTax !== 'boolean'
    || typeof memo.duplicateLabel !== 'boolean'
    || typeof memo.autoPrint !== 'boolean'
    || typeof memo.printLogo !== 'boolean') {
    throw new Error('The server returned invalid Pharmacy Memo settings.');
  }

  return {
    template: value.billingTemplate,
    format: value.receiptFormat,
    maxDiscountPaisa: requireIntegerInRange(value.maxDiscountPaisa, 0, 20000, 'maximum discount'),
    roleDiscountPercentCap: {
      admin: requireNumberInRange(caps.admin, 0, 30, 'Admin discount cap'),
      manager: requireNumberInRange(caps.manager, 0, 15, 'Manager discount cap'),
      cashier: requireNumberInRange(caps.cashier, 0, 10, 'Cashier discount cap'),
      accountant: requireNumberInRange(caps.accountant, 0, 0, 'Accountant discount cap'),
    },
    expiryWarningDays: requireIntegerInRange(value.expiryWarningDays, 1, 365, 'expiry warning'),
    memo: {
      notes: memo.notes as [string, string, string],
      terminalName: memo.terminalName,
      showBatchNumber: typeof memo.showBatchNumber === 'boolean' ? memo.showBatchNumber : legacyShowBatchExpiry,
      showExpiryDate: typeof memo.showExpiryDate === 'boolean' ? memo.showExpiryDate : legacyShowBatchExpiry,
      roundNet: memo.roundNet,
      printTax: memo.printTax,
      duplicateLabel: memo.duplicateLabel,
      autoPrint: memo.autoPrint,
      numberDigits: requireIntegerInRange(memo.numberDigits, 1, 20, 'memo number digits'),
      printLogo: memo.printLogo,
    },
  };
}

export function toShopSettingsRpcPayload(settings: ShopOperationalSettings): Record<string, unknown> {
  return {
    billingTemplate: settings.template,
    receiptFormat: settings.format,
    maxDiscountPaisa: settings.maxDiscountPaisa,
    roleDiscountPercentCap: settings.roleDiscountPercentCap,
    expiryWarningDays: settings.expiryWarningDays,
    memo: {
      notes: [...settings.memo.notes],
      terminalName: settings.memo.terminalName,
      showBatchNumber: settings.memo.showBatchNumber,
      showExpiryDate: settings.memo.showExpiryDate,
      showBatchExpiry: settings.memo.showBatchNumber && settings.memo.showExpiryDate,
      roundNet: settings.memo.roundNet,
      printTax: settings.memo.printTax,
      duplicateLabel: settings.memo.duplicateLabel,
      autoPrint: settings.memo.autoPrint,
      numberDigits: settings.memo.numberDigits,
      printLogo: settings.memo.printLogo,
    },
  };
}
