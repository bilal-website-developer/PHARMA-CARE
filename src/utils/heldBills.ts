import { DrugClass, type CartItem, type SaleCustomerType } from '../types/pharmacy';
import type { DiscountMode } from './discount';

export interface HeldBill {
  id: string;
  heldAt: number;
  cart: CartItem[];
  discount: { mode: DiscountMode; value: string };
  customerId: string;
  customerName: string;
  customerType: SaleCustomerType;
  totalPaisa: number;
}

type HeldBillStorage = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_PREFIX = 'pharma-care.pos.held-bills.v1';
const CUSTOMER_TYPES: readonly SaleCustomerType[] = [
  'WALK_IN',
  'REGISTERED',
  'CREDIT',
  'DOCTOR_CLINIC',
  'WHOLESALE_RETAILER',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBatchAllocation(value: unknown): boolean {
  return isRecord(value)
    && typeof value.batchId === 'string'
    && typeof value.batchNumber === 'string'
    && typeof value.expiryDate === 'string'
    && isNonNegativeInteger(value.quantitySmallestUnit);
}

function isCartItem(value: unknown): value is CartItem {
  return isRecord(value)
    && typeof value.productId === 'string'
    && typeof value.productName === 'string'
    && typeof value.genericName === 'string'
    && typeof value.batchId === 'string'
    && typeof value.batchNumber === 'string'
    && typeof value.expiryDate === 'string'
    && Object.values(DrugClass).some((drugClass) => drugClass === value.drugClass)
    && (value.unitId === undefined || typeof value.unitId === 'string')
    && typeof value.unitName === 'string'
    && typeof value.conversionFactor === 'number'
    && Number.isFinite(value.conversionFactor)
    && value.conversionFactor > 0
    && typeof value.quantityInUnit === 'number'
    && Number.isSafeInteger(value.quantityInUnit)
    && value.quantityInUnit > 0
    && isNonNegativeInteger(value.mrpPaisaPerUnit)
    && (value.costPaisaPerUnit === null || isNonNegativeInteger(value.costPaisaPerUnit))
    && typeof value.discountPercent === 'number'
    && Number.isFinite(value.discountPercent)
    && isNonNegativeInteger(value.lineTotalPaisa)
    && (value.batchAllocations === undefined
      || (Array.isArray(value.batchAllocations) && value.batchAllocations.every(isBatchAllocation)));
}

function isHeldBill(value: unknown): value is HeldBill {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && isNonNegativeInteger(value.heldAt)
    && Array.isArray(value.cart)
    && value.cart.length > 0
    && value.cart.every(isCartItem)
    && isRecord(value.discount)
    && (value.discount.mode === 'amount' || value.discount.mode === 'percent')
    && typeof value.discount.value === 'string'
    && typeof value.customerId === 'string'
    && typeof value.customerName === 'string'
    && CUSTOMER_TYPES.some((customerType) => customerType === value.customerType)
    && isNonNegativeInteger(value.totalPaisa);
}

function getStorage(storage?: HeldBillStorage): HeldBillStorage {
  if (storage) return storage;
  if (!globalThis.localStorage) {
    throw new Error('Browser storage is unavailable for held bills.');
  }
  return globalThis.localStorage;
}

export function heldBillsStorageKey(userId: string): string {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error('A signed-in user is required to store held bills.');
  return `${STORAGE_PREFIX}.${encodeURIComponent(normalizedUserId)}`;
}

export function readHeldBills(userId: string, storage?: HeldBillStorage): HeldBill[] {
  const saved = getStorage(storage).getItem(heldBillsStorageKey(userId));
  if (saved === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch {
    throw new Error('Saved held bills could not be read because the browser data is invalid.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Saved held bills have an unexpected format.');
  }

  const bills = parsed.filter(isHeldBill);
  if (bills.length !== parsed.length) {
    throw new Error('One or more saved held bills are invalid and were not loaded.');
  }
  return bills;
}

export function writeHeldBills(
  userId: string,
  bills: readonly HeldBill[],
  storage?: HeldBillStorage,
): void {
  if (!bills.every(isHeldBill)) {
    throw new Error('Held bills could not be saved because their data is invalid.');
  }
  getStorage(storage).setItem(heldBillsStorageKey(userId), JSON.stringify(bills));
}
