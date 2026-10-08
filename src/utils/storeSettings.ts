import { APP_NAME } from '../constants/brand';

const COMPANY_NAME_KEY = 'pharma-care.companyName';
export const DEFAULT_COMPANY_NAME = APP_NAME;

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
