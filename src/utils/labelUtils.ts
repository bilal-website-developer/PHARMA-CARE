export type BarcodeFormat = 'CODE128' | 'EAN13' | 'UPC' | 'CODE39' | 'ITF';

export const MAX_LABELS_PER_PRODUCT = 200;
export const MAX_LABELS_PER_PRINT_JOB = 1000;

export const BARCODE_FORMATS = [
  { value: 'CODE128', label: 'Code 128' },
  { value: 'EAN13', label: 'EAN-13' },
  { value: 'UPC', label: 'UPC-A' },
  { value: 'CODE39', label: 'Code 39' },
  { value: 'ITF', label: 'ITF-14' },
] as const satisfies readonly { value: BarcodeFormat; label: string }[];

export interface LabelQuantity {
  id: string;
  name: string;
  quantity: number;
}

export function validateLabelQuantities(items: readonly LabelQuantity[]): string | null {
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_LABELS_PER_PRODUCT) {
      return `${item.name}: enter a whole number from 1 to ${MAX_LABELS_PER_PRODUCT}.`;
    }
  }

  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  if (total > MAX_LABELS_PER_PRINT_JOB) {
    return `Print jobs are limited to ${MAX_LABELS_PER_PRINT_JOB} labels. Current total: ${total}.`;
  }

  return null;
}

export function ean13CheckDigit(payload12: string): string {
  const digits = payload12.replace(/\D/g, '');
  if (digits.length !== 12) {
    throw new Error('EAN-13 payload must contain exactly 12 digits.');
  }

  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    const digit = Number(digits[index]);
    sum += index % 2 === 0 ? digit : digit * 3;
  }

  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 13) {
    return false;
  }

  const payload12 = digits.slice(0, 12);
  return digits[12] === ean13CheckDigit(payload12);
}

export function isValidForFormat(value: string, format: BarcodeFormat): boolean {
  const trimmed = value.trim();

  switch (format) {
    case 'EAN13':
      return trimmed.length > 0 && isValidEan13(trimmed);
    case 'UPC': {
      const digits = trimmed.replace(/\D/g, '');
      return digits.length === 12 && /^\d{12}$/.test(digits);
    }
    case 'CODE39': {
      return trimmed.length > 0 && /^[A-Z0-9\-\.\s\$\+\%\/]+$/.test(trimmed.toUpperCase());
    }
    case 'ITF': {
      const digits = trimmed.replace(/\D/g, '');
      return digits.length >= 4 && digits.length % 2 === 0;
    }
    case 'CODE128':
    default:
      return trimmed.length > 0;
  }
}
