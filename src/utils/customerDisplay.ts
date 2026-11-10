import type { PosCatalogProduct } from '../data/posCatalogLogic';
import { UserRole } from '../types/pharmacy';
import { allocateFefo, localIsoDate } from './fefo';

export type CustomerDisplayStage = 'welcome' | 'order' | 'payment';
export type CustomerDisplayPaymentMethod = 'CASH' | 'ONLINE' | 'CREDIT' | 'SPLIT';

export interface CustomerDisplayLine {
  productName: string;
  unitName: string;
  quantity: number;
  batchNumber: string;
  expiryDate: string;
  unitPricePaisa: number;
  lineTotalPaisa: number;
}

export interface CustomerDisplayPayment {
  method: CustomerDisplayPaymentMethod;
  paidPaisa: number;
  balanceDuePaisa: number;
  changePaisa: number;
}

export interface CustomerDisplaySnapshot {
  type: 'snapshot';
  stage: CustomerDisplayStage;
  items: CustomerDisplayLine[];
  subtotalPaisa: number;
  discountPaisa: number;
  totalPaisa: number;
  payment: CustomerDisplayPayment;
}

export interface CustomerDisplayOption {
  brandName: string;
  company: string;
  strength: string | null;
  unitName: string;
  unitPricePaisa: number;
}

export interface CustomerDisplayOptionCandidate extends CustomerDisplayOption {
  productId: string;
  unitId: string;
}

export type CustomerDisplayMessage =
  | { type: 'ready' }
  | { type: 'closed' }
  | { type: 'thank_you' }
  | { type: 'option_selected'; optionIndex: number }
  | { type: 'options'; currentProductName: string; strength: string | null; options: CustomerDisplayOption[] }
  | CustomerDisplaySnapshot;

const MAX_DISPLAY_LINES = 100;
const MAX_DISPLAY_OPTIONS = 3;
const MAX_DISPLAY_LABEL_LENGTH = 120;
const CHANNEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISPLAY_CHANNEL_KEY_PREFIX = 'pharma-care.customer-display.channel.';
const DISPLAY_ALTERNATIVES_EVENT = 'pharma-care:customer-display-alternatives-changed';
const PAYMENT_METHODS = new Set<CustomerDisplayPaymentMethod>(['CASH', 'ONLINE', 'CREDIT', 'SPLIT']);
const DISPLAY_STAGES = new Set<CustomerDisplayStage>(['welcome', 'order', 'payment']);

export type CustomerDisplayDensity = 'comfortable' | 'compact' | 'dense';

export function getCustomerDisplayPageSize(availableHeight: number, itemCount: number): {
  density: CustomerDisplayDensity;
  pageSize: number;
} {
  const density: CustomerDisplayDensity = itemCount <= 5
    ? 'comfortable'
    : itemCount <= 10 ? 'compact' : 'dense';
  const rowHeight = density === 'comfortable' ? 50 : density === 'compact' ? 42 : 40;
  const safeHeight = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  return {
    density,
    pageSize: Math.max(1, Math.floor(safeHeight / rowHeight)),
  };
}

function displayAlternativesKey(userId: string): string {
  return `pharma-care.customer-display.alternatives.${userId}`;
}

export function readCustomerDisplayAlternatives(userId: string): boolean {
  if (!userId) return false;
  try {
    return globalThis.localStorage?.getItem(displayAlternativesKey(userId)) === 'true';
  } catch {
    return false;
  }
}

export function saveCustomerDisplayAlternatives(userId: string, enabled: boolean): boolean {
  if (!userId) return false;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(displayAlternativesKey(userId), String(enabled));
    globalThis.dispatchEvent?.(new CustomEvent(DISPLAY_ALTERNATIVES_EVENT, {
      detail: { userId, enabled },
    }));
    return true;
  } catch {
    return false;
  }
}

export function subscribeCustomerDisplayAlternatives(
  userId: string,
  onChange: (enabled: boolean) => void,
): () => void {
  const handlePreference = (event: Event) => {
    const detail = (event as CustomEvent<{ userId?: unknown; enabled?: unknown }>).detail;
    if (detail?.userId === userId && typeof detail.enabled === 'boolean') onChange(detail.enabled);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === displayAlternativesKey(userId)) onChange(event.newValue === 'true');
  };
  globalThis.addEventListener?.(DISPLAY_ALTERNATIVES_EVENT, handlePreference);
  globalThis.addEventListener?.('storage', handleStorage);
  return () => {
    globalThis.removeEventListener?.(DISPLAY_ALTERNATIVES_EVENT, handlePreference);
    globalThis.removeEventListener?.('storage', handleStorage);
  };
}

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

export function getCustomerDisplayChannelId(userId: string): string {
  if (!userId) {
    throw new Error('Sign in before opening the customer display.');
  }
  const storageKey = `${DISPLAY_CHANNEL_KEY_PREFIX}${userId}`;
  let storage: Storage | undefined;
  let savedId: string | null;
  try {
    storage = globalThis.localStorage;
    savedId = storage?.getItem(storageKey) ?? null;
  } catch {
    throw new Error('Browser storage is unavailable; the customer display link could not be loaded.');
  }
  if (isCustomerDisplayChannelId(savedId)) return savedId;
  if (!storage) {
    throw new Error('Browser storage is unavailable; the customer display link could not be saved.');
  }

  const channelId = createCustomerDisplayChannelId();
  try {
    storage.setItem(storageKey, channelId);
  } catch {
    throw new Error('Browser storage is unavailable; the customer display link could not be saved.');
  }
  return channelId;
}

export function isCustomerDisplayChannelId(value: string | null): value is string {
  return value !== null && CHANNEL_ID_PATTERN.test(value);
}

export function buildCustomerDisplayPayment(
  method: CustomerDisplayPaymentMethod,
  totalPaisa: number,
  tenderedPaisa = 0,
): CustomerDisplayPayment {
  if (method === 'CREDIT') {
    return { method, paidPaisa: 0, balanceDuePaisa: totalPaisa, changePaisa: 0 };
  }
  if (method !== 'CASH') {
    return { method, paidPaisa: totalPaisa, balanceDuePaisa: 0, changePaisa: 0 };
  }

  // POS treats an untouched (zero) tender field as exact payment at completion.
  const receivedPaisa = tenderedPaisa || totalPaisa;
  const paidPaisa = Math.min(receivedPaisa, totalPaisa);
  return {
    method,
    paidPaisa,
    balanceDuePaisa: Math.max(0, totalPaisa - paidPaisa),
    changePaisa: Math.max(0, receivedPaisa - totalPaisa),
  };
}

export function buildCustomerDisplaySnapshot(
  items: readonly CustomerDisplayLine[],
  subtotalPaisa: number,
  discountPaisa: number,
  totalPaisa: number,
  stage: CustomerDisplayStage,
  payment: CustomerDisplayPayment,
): CustomerDisplaySnapshot {
  return {
    type: 'snapshot',
    stage,
    items: items.map((item) => ({
      productName: item.productName,
      unitName: item.unitName,
      quantity: item.quantity,
      batchNumber: item.batchNumber,
      expiryDate: item.expiryDate,
      unitPricePaisa: item.unitPricePaisa,
      lineTotalPaisa: item.lineTotalPaisa,
    })),
    subtotalPaisa,
    discountPaisa,
    totalPaisa,
    payment: {
      method: payment.method,
      paidPaisa: payment.paidPaisa,
      balanceDuePaisa: payment.balanceDuePaisa,
      changePaisa: payment.changePaisa,
    },
  };
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

export function buildSameMedicineOptions(
  products: readonly PosCatalogProduct[],
  currentProductId: string,
  quantityInUnit: number,
  today = localIsoDate(),
): CustomerDisplayOptionCandidate[] {
  const current = products.find((product) => product.id === currentProductId);
  if (!current || !Number.isSafeInteger(quantityInUnit) || quantityInUnit <= 0) return [];

  return products
    .filter((product) => product.id !== current.id
      && normalized(product.genericName) === normalized(current.genericName)
      && normalized(product.strength) === normalized(current.strength))
    .flatMap((product) => {
      const unit = product.units.find((candidate) => candidate.isDefaultSaleUnit) ?? product.units[0];
      if (!unit) return [];
      try {
        allocateFefo(product.batches, quantityInUnit * unit.conversionFactor, today);
      } catch {
        return [];
      }
      return [{
        productId: product.id,
        unitId: unit.id,
        brandName: product.brandName,
        company: product.company,
        strength: product.strength,
        unitName: unit.name,
        unitPricePaisa: unit.pricePerUnitPaisa,
      }];
    })
    .sort((left, right) => left.unitPricePaisa - right.unitPricePaisa
      || left.brandName.localeCompare(right.brandName))
    .slice(0, MAX_DISPLAY_OPTIONS);
}

export function buildCustomerDisplayOptionsMessage(
  currentProductName: string,
  strength: string | null,
  candidates: readonly CustomerDisplayOptionCandidate[],
): Extract<CustomerDisplayMessage, { type: 'options' }> {
  return {
    type: 'options',
    currentProductName,
    strength,
    options: candidates.slice(0, MAX_DISPLAY_OPTIONS).map((option) => ({
      brandName: option.brandName,
      company: option.company,
      strength: option.strength,
      unitName: option.unitName,
      unitPricePaisa: option.unitPricePaisa,
    })),
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

function isOptionalDisplayLabel(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= MAX_DISPLAY_LABEL_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDisplayOption(value: unknown): CustomerDisplayOption | null {
  if (!isRecord(value)
    || !isDisplayLabel(value.brandName)
    || !isDisplayLabel(value.company)
    || !isOptionalDisplayLabel(value.strength)
    || !isDisplayLabel(value.unitName)
    || !isNonNegativeSafeInteger(value.unitPricePaisa)) return null;
  return {
    brandName: value.brandName,
    company: value.company,
    strength: value.strength,
    unitName: value.unitName,
    unitPricePaisa: value.unitPricePaisa,
  };
}

export function parseCustomerDisplayMessage(value: unknown): CustomerDisplayMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'ready' || value.type === 'closed' || value.type === 'thank_you') {
    return { type: value.type };
  }
  if (value.type === 'option_selected') {
    return Number.isSafeInteger(value.optionIndex) && Number(value.optionIndex) >= 0
      && Number(value.optionIndex) < MAX_DISPLAY_OPTIONS
      ? { type: 'option_selected', optionIndex: Number(value.optionIndex) }
      : null;
  }
  if (value.type === 'options') {
    if (!isDisplayLabel(value.currentProductName)
      || !isOptionalDisplayLabel(value.strength)
      || !Array.isArray(value.options)
      || value.options.length > MAX_DISPLAY_OPTIONS) return null;
    const options = value.options.map(parseDisplayOption);
    if (options.some((option) => option === null)) return null;
    return {
      type: 'options',
      currentProductName: value.currentProductName,
      strength: value.strength,
      options: options as CustomerDisplayOption[],
    };
  }
  if (value.type !== 'snapshot'
    || !DISPLAY_STAGES.has(value.stage as CustomerDisplayStage)
    || !Array.isArray(value.items)
    || value.items.length > MAX_DISPLAY_LINES
    || !isRecord(value.payment)
    || !PAYMENT_METHODS.has(value.payment.method as CustomerDisplayPaymentMethod)
    || !isNonNegativeSafeInteger(value.payment.paidPaisa)
    || !isNonNegativeSafeInteger(value.payment.balanceDuePaisa)
    || !isNonNegativeSafeInteger(value.payment.changePaisa)
    || !isNonNegativeSafeInteger(value.subtotalPaisa)
    || !isNonNegativeSafeInteger(value.discountPaisa)
    || !isNonNegativeSafeInteger(value.totalPaisa)) return null;

  const items: CustomerDisplayLine[] = [];
  for (const candidate of value.items) {
    if (!isRecord(candidate)
      || !isDisplayLabel(candidate.productName)
      || !isDisplayLabel(candidate.unitName)
      || !isNonNegativeSafeInteger(candidate.quantity)
      || candidate.quantity === 0
      || typeof candidate.batchNumber !== 'string'
      || candidate.batchNumber.length > MAX_DISPLAY_LABEL_LENGTH
      || typeof candidate.expiryDate !== 'string'
      || candidate.expiryDate.length > MAX_DISPLAY_LABEL_LENGTH
      || !isNonNegativeSafeInteger(candidate.unitPricePaisa)
      || !isNonNegativeSafeInteger(candidate.lineTotalPaisa)) return null;
    items.push({
      productName: candidate.productName,
      unitName: candidate.unitName,
      quantity: candidate.quantity,
      batchNumber: candidate.batchNumber,
      expiryDate: candidate.expiryDate,
      unitPricePaisa: candidate.unitPricePaisa,
      lineTotalPaisa: candidate.lineTotalPaisa,
    });
  }

  const payment = value.payment;
  return {
    type: 'snapshot',
    stage: value.stage as CustomerDisplayStage,
    items,
    subtotalPaisa: value.subtotalPaisa,
    discountPaisa: value.discountPaisa,
    totalPaisa: value.totalPaisa,
    payment: {
      method: payment.method as CustomerDisplayPaymentMethod,
      paidPaisa: payment.paidPaisa as number,
      balanceDuePaisa: payment.balanceDuePaisa as number,
      changePaisa: payment.changePaisa as number,
    },
  };
}
