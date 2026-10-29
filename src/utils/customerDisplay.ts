import { UserRole } from '../types/pharmacy';

export interface CustomerDisplayLine {
  productName: string;
  unitName: string;
  quantity: number;
  unitPricePaisa: number;
  lineTotalPaisa: number;
}

export interface CustomerDisplaySnapshot {
  type: 'snapshot';
  items: CustomerDisplayLine[];
  subtotalPaisa: number;
  discountPaisa: number;
  totalPaisa: number;
}

export type CustomerDisplayMessage =
  | { type: 'ready' }
  | { type: 'closed' }
  | CustomerDisplaySnapshot;

const MAX_DISPLAY_LINES = 100;
const MAX_DISPLAY_LABEL_LENGTH = 120;
const CHANNEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canAccessCustomerDisplay(
  role: UserRole,
  permissions: readonly string[],
): boolean {
  return role === UserRole.ADMIN
    || role === UserRole.SUPER_ADMIN
    || permissions.includes('pos');
}

export function createCustomerDisplayChannelId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('This browser cannot create a secure customer display session.');
  }
  return globalThis.crypto.randomUUID();
}

export function isCustomerDisplayChannelId(value: string | null): value is string {
  return value !== null && CHANNEL_ID_PATTERN.test(value);
}

export function buildCustomerDisplaySnapshot(
  items: readonly CustomerDisplayLine[],
  subtotalPaisa: number,
  discountPaisa: number,
  totalPaisa: number,
): CustomerDisplaySnapshot {
  return {
    type: 'snapshot',
    items: items.map((item) => ({
      productName: item.productName,
      unitName: item.unitName,
      quantity: item.quantity,
      unitPricePaisa: item.unitPricePaisa,
      lineTotalPaisa: item.lineTotalPaisa,
    })),
    subtotalPaisa,
    discountPaisa,
    totalPaisa,
  };
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isDisplayLabel(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_DISPLAY_LABEL_LENGTH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCustomerDisplayMessage(value: unknown): CustomerDisplayMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'ready' || value.type === 'closed') return { type: value.type };
  if (value.type !== 'snapshot' || !Array.isArray(value.items) || value.items.length > MAX_DISPLAY_LINES) {
    return null;
  }
  if (!isNonNegativeSafeInteger(value.subtotalPaisa)
    || !isNonNegativeSafeInteger(value.discountPaisa)
    || !isNonNegativeSafeInteger(value.totalPaisa)) {
    return null;
  }

  const items: CustomerDisplayLine[] = [];
  for (const candidate of value.items) {
    if (!isRecord(candidate)
      || !isDisplayLabel(candidate.productName)
      || !isDisplayLabel(candidate.unitName)
      || !isNonNegativeSafeInteger(candidate.quantity)
      || candidate.quantity === 0
      || !isNonNegativeSafeInteger(candidate.unitPricePaisa)
      || !isNonNegativeSafeInteger(candidate.lineTotalPaisa)) {
      return null;
    }
    items.push({
      productName: candidate.productName,
      unitName: candidate.unitName,
      quantity: candidate.quantity,
      unitPricePaisa: candidate.unitPricePaisa,
      lineTotalPaisa: candidate.lineTotalPaisa,
    });
  }

  return {
    type: 'snapshot',
    items,
    subtotalPaisa: value.subtotalPaisa,
    discountPaisa: value.discountPaisa,
    totalPaisa: value.totalPaisa,
  };
}
