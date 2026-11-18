export type ReceiptQrPlacement = 'footer' | 'after_totals' | 'below_header';

export interface ReceiptQrSettings {
  publicReceiptsEnabled: boolean;
  linkLifetimeDays: number;
  showMedicineNames: boolean;
  qrPlacement: ReceiptQrPlacement;
  qrBaseUrl: string;
}

export interface ReceiptQrLink {
  token: string;
  expiresAt: string;
  publicUrl: string;
  placement: ReceiptQrPlacement;
}

const placements: readonly ReceiptQrPlacement[] = ['footer', 'after_totals', 'below_header'];
const tokenPattern = /^[0-9a-f]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseReceiptQrSettings(value: unknown): ReceiptQrSettings {
  if (!isRecord(value)
    || typeof value.publicReceiptsEnabled !== 'boolean'
    || !Number.isInteger(value.linkLifetimeDays)
    || (value.linkLifetimeDays as number) < 1
    || (value.linkLifetimeDays as number) > 3650
    || typeof value.showMedicineNames !== 'boolean'
    || typeof value.qrPlacement !== 'string'
    || !placements.includes(value.qrPlacement as ReceiptQrPlacement)
    || typeof value.qrBaseUrl !== 'string') {
    throw new Error('The server returned invalid public receipt settings.');
  }
  return {
    publicReceiptsEnabled: value.publicReceiptsEnabled,
    linkLifetimeDays: value.linkLifetimeDays as number,
    showMedicineNames: value.showMedicineNames,
    qrPlacement: value.qrPlacement as ReceiptQrPlacement,
    qrBaseUrl: value.qrBaseUrl === '' ? '' : normalizeReceiptBaseUrl(value.qrBaseUrl),
  };
}

export function parseReceiptQrLink(value: unknown): ReceiptQrLink {
  if (!isRecord(value)
    || typeof value.token !== 'string'
    || !tokenPattern.test(value.token)
    || typeof value.expiresAt !== 'string'
    || typeof value.qrBaseUrl !== 'string'
    || typeof value.qrPlacement !== 'string'
    || !placements.includes(value.qrPlacement as ReceiptQrPlacement)) {
    throw new Error('The server returned an invalid receipt QR link.');
  }
  const expiresAt = new Date(value.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) throw new Error('The server returned an invalid QR expiry date.');
  const baseUrl = normalizeReceiptBaseUrl(value.qrBaseUrl);
  return {
    token: value.token,
    expiresAt: expiresAt.toISOString(),
    publicUrl: `${baseUrl}/r/${encodeURIComponent(value.token)}`,
    placement: value.qrPlacement as ReceiptQrPlacement,
  };
}

export function normalizeReceiptBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Set a valid HTTPS public app URL in Receipt QR settings before generating links.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Receipt QR base URL must be an HTTPS origin without a path, query, or credentials.');
  }
  return url.origin;
}

export function parseReceiptScan(value: string):
  | { kind: 'link'; token: string }
  | { kind: 'invoice'; invoiceNumber: string }
  | null {
  const input = value.trim();
  const tokenPath = /^\/r\/([0-9a-f]{64})\/?$/i;
  if (/^https:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      if (url.username || url.password || url.search || url.hash) return null;
      const match = url.pathname.match(tokenPath);
      return match ? { kind: 'link', token: match[1] } : null;
    } catch {
      return null;
    }
  }
  if (/^\/r\//.test(input)) {
    const match = input.match(tokenPath);
    return match ? { kind: 'link', token: match[1] } : null;
  }
  if (!input || /[\u0000-\u001f]/.test(input)) return null;
  return { kind: 'invoice', invoiceNumber: input };
}
