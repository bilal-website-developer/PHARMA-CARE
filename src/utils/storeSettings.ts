import { APP_NAME } from '../constants/brand';
import { DEFAULT_PHARMACY_MEMO_SETTINGS, MemoRounding, PharmacyMemoSettings } from './receipt';

const COMPANY_NAME_KEY = 'pharma-care.companyName';
const PHARMACY_MEMO_SETTINGS_KEY = 'pharma-care.pharmacyMemoSettings';
const SHOP_PROFILE_KEY = 'pharma-care.shopProfile';
export const SHOP_LOGO_KEY = 'pharma-care.shopLogo';
export const SHOP_LOGO_EVENT = 'pharma-care:shop-logo-changed';
export const DEFAULT_COMPANY_NAME = APP_NAME;

export function readShopLogo(): string {
  try {
    return globalThis.localStorage?.getItem(SHOP_LOGO_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export function saveShopLogo(logoUrl: string): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    const cleanUrl = logoUrl.trim();
    if (cleanUrl) {
      storage.setItem(SHOP_LOGO_KEY, cleanUrl);
    } else {
      storage.removeItem(SHOP_LOGO_KEY);
    }
    globalThis.dispatchEvent?.(new CustomEvent(SHOP_LOGO_EVENT, { detail: { logoUrl: cleanUrl } }));
    return true;
  } catch {
    return false;
  }
}

export function readPharmacyMemoSettings(companyName = DEFAULT_COMPANY_NAME): PharmacyMemoSettings {
  const fallbackLogo = readShopLogo();
  const defaults = { ...DEFAULT_PHARMACY_MEMO_SETTINGS, storeName: companyName || APP_NAME, logoUrl: fallbackLogo, printLogo: true };
  try {
    const savedProfile = globalThis.localStorage?.getItem(SHOP_PROFILE_KEY);
    const profile: unknown = savedProfile ? JSON.parse(savedProfile) : null;
    const profileValues = typeof profile === 'object' && profile !== null
      ? profile as { phone?: unknown; city?: unknown; logoUrl?: unknown }
      : {};
    const fallbackPhone = typeof profileValues.phone === 'string' ? profileValues.phone : '';
    const fallbackAddress = typeof profileValues.city === 'string' ? profileValues.city : '';
    const profileLogo = typeof profileValues.logoUrl === 'string' ? profileValues.logoUrl : fallbackLogo;
    const stored = globalThis.localStorage?.getItem(PHARMACY_MEMO_SETTINGS_KEY);
    if (!stored) return { ...defaults, address: fallbackAddress, phone: fallbackPhone, logoUrl: profileLogo };
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...defaults, address: fallbackAddress, phone: fallbackPhone, logoUrl: profileLogo };
    }
    const value = parsed as Partial<PharmacyMemoSettings>;
    const roundNet: MemoRounding = ['none', '1', '5', '10'].includes(String(value.roundNet))
      ? value.roundNet as MemoRounding
      : defaults.roundNet;
    const notes = Array.isArray(value.notes) && value.notes.length === 3
      ? value.notes.map((note, index) => typeof note === 'string' ? note : defaults.notes[index]) as PharmacyMemoSettings['notes']
      : defaults.notes;
    return {
      storeName: typeof value.storeName === 'string' ? value.storeName : defaults.storeName,
      address: typeof value.address === 'string' && value.address.trim() ? value.address : fallbackAddress,
      phone: typeof value.phone === 'string' && value.phone.trim() ? value.phone : fallbackPhone,
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
      logoUrl: typeof value.logoUrl === 'string' ? value.logoUrl : profileLogo,
      printLogo: typeof value.printLogo === 'boolean' ? value.printLogo : true,
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
    if (settings.logoUrl !== undefined) {
      saveShopLogo(settings.logoUrl);
    }
    return true;
  } catch {
    return false;
  }
}

export interface ShopProfile {
  phone: string;
  city: string;
}

export function readShopProfile(): ShopProfile {
  try {
    const saved = globalThis.localStorage?.getItem(SHOP_PROFILE_KEY);
    if (!saved) return { phone: '', city: '' };
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== 'object' || parsed === null) return { phone: '', city: '' };
    const values = parsed as Partial<Record<string, unknown>>;
    return {
      phone: typeof values.phone === 'string' ? values.phone : '',
      city: typeof values.city === 'string' ? values.city : '',
    };
  } catch {
    return { phone: '', city: '' };
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
