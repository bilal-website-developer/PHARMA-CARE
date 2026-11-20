export type ReceiptLanguage = 'en' | 'ur';

export class PublicReceiptRequestError extends Error {
  constructor(readonly status: number) {
    super('Public receipt request failed.');
    this.name = 'PublicReceiptRequestError';
  }
}

export async function requestPublicReceipt(
  supabaseUrl: string | undefined,
  anonKey: string | undefined,
  token: string,
  revealItemNames: boolean,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  if (!supabaseUrl || !anonKey) throw new PublicReceiptRequestError(503);
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/get-public-receipt`;
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    body: JSON.stringify({ token, revealItemNames }),
  });
  if (!response.ok) throw new PublicReceiptRequestError(response.status);
  return response.json();
}

export function normalizePakistaniWhatsAppNumber(value: string): string | null {
  const compact = value.trim().replace(/[()\s.-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;

  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (digits.startsWith('0092') && digits.length === 14) return digits.slice(2);
  if (digits.startsWith('92') && digits.length === 12) return digits;
  if (digits.startsWith('03') && digits.length === 11) return `92${digits.slice(1)}`;
  if (digits.startsWith('3') && digits.length === 10) return `92${digits}`;
  return null;
}

export function normalizeTelephoneNumber(value: string): string | null {
  const compact = value.trim().replace(/[()\s.-]/g, '');
  if (!/^\+?\d{7,15}$/.test(compact)) return null;
  return compact;
}

export function buildWhatsAppUrl(phone: string, message: string): string | null {
  const number = normalizePakistaniWhatsAppNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}

export function formatReceiptMoney(paisa: number): string {
  const rupees = paisa / 100;
  const fractionDigits = paisa % 100 === 0 ? 0 : 2;
  return `Rs ${rupees.toLocaleString('en-PK', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}

export function formatReceiptDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const datePart = new Intl.DateTimeFormat('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-PK', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Karachi',
  }).format(date).replace(/\b(am|pm)$/i, (period) => period.toUpperCase());
  return `${datePart}, ${timePart}`;
}

export function formatExpiryMonth(value: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PK', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function receiptCode(invoiceNumber: string): string {
  return invoiceNumber.slice(-6).toUpperCase();
}

export function readReceiptLanguage(): ReceiptLanguage {
  try {
    return window.localStorage.getItem('pharma-care.public-receipt-language') === 'ur' ? 'ur' : 'en';
  } catch {
    return 'en';
  }
}

export function saveReceiptLanguage(language: ReceiptLanguage): void {
  try {
    window.localStorage.setItem('pharma-care.public-receipt-language', language);
  } catch {
    // Language selection remains available for the current page when storage is disabled.
  }
}
