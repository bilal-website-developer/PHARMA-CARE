import { APP_NAME } from '../constants/brand';
import { DEFAULT_PHARMACY_MEMO_SETTINGS, MemoRounding, PharmacyMemoSettings } from './receipt';

const COMPANY_NAME_KEY = 'pharma-care.companyName';
const PHARMACY_MEMO_SETTINGS_KEY = 'pharma-care.pharmacyMemoSettings';
export const DEFAULT_COMPANY_NAME = APP_NAME;

export function readPharmacyMemoSettings(companyName = DEFAULT_COMPANY_NAME): PharmacyMemoSettings {
  const defaults = { ...DEFAULT_PHARMACY_MEMO_SETTINGS, storeName: companyName || APP_NAME };
  try {
    const stored = globalThis.localStorage?.getItem(PHARMACY_MEMO_SETTINGS_KEY);
    if (!stored) return defaults;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const value = parsed as Partial<PharmacyMemoSettings>;
    const roundNet: MemoRounding = ['none', '1', '5', '10'].includes(String(value.roundNet))
      ? value.roundNet as MemoRounding
      : defaults.roundNet;
    const notes = Array.isArray(value.notes) && value.notes.length === 3
      ? value.notes.map((note, index) => typeof note === 'string' ? note : defaults.notes[index]) as PharmacyMemoSettings['notes']
      : defaults.notes;
    return {
      storeName: typeof value.storeName === 'string' ? value.storeName : defaults.storeName,
      address: typeof value.address === 'string' ? value.address : defaults.address,
      phone: typeof value.phone === 'string' ? value.phone : defaults.phone,
      notes,
      terminalName: typeof value.terminalName === 'string' ? value.terminalName : defaults.terminalName,
      showBatchExpiry: typeof value.showBatchExpiry === 'boolean' ? value.showBatchExpiry : defaults.showBatchExpiry,
      roundNet,
      printTax: typeof value.printTax === 'boolean' ? value.printTax : defaults.printTax,
      duplicateLabel: typeof value.duplicateLabel === 'boolean' ? value.duplicateLabel : defaults.duplicateLabel,
      autoPrint: typeof value.autoPrint === 'boolean' ? value.autoPrint : defaults.autoPrint,
      numberDigits: typeof value.numberDigits === 'number' && Number.isInteger(value.numberDigits)
        ? Math.max(1, Math.min(20, value.numberDigits))
        : defaults.numberDigits,
    };
  } catch {
    return defaults;
  }
}

export function savePharmacyMemoSettings(settings: PharmacyMemoSettings): boolean {
  if (!settings.storeName.trim() || !settings.terminalName.trim()
    || settings.notes.some((note) => !note.trim())
    || !['none', '1', '5', '10'].includes(settings.roundNet)
    || !Number.isInteger(settings.numberDigits)
    || settings.numberDigits < 1
    || settings.numberDigits > 20) return false;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(PHARMACY_MEMO_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function readCompanyName(): string {
  try {
    const savedName = globalThis.localStorage?.getItem(COMPANY_NAME_KEY)?.trim();
    return savedName || DEFAULT_COMPANY_NAME;
  } catch {
    return DEFAULT_COMPANY_NAME;
  }
}

export function saveCompanyName(companyName: string): boolean {
  const normalizedName = companyName.trim();
  if (!normalizedName) return false;

  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(COMPANY_NAME_KEY, normalizedName);
    return true;
  } catch {
    return false;
  }
}
