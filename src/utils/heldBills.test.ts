import assert from 'node:assert/strict';
import test from 'node:test';
import { DrugClass, type CartItem } from '../types/pharmacy';
import {
  heldBillsStorageKey,
  readHeldBills,
  writeHeldBills,
  type HeldBill,
} from './heldBills';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const cartItem: CartItem = {
  productId: 'medicine-1',
  productName: 'Test medicine',
  genericName: 'Test',
  batchId: 'batch-1',
  batchNumber: 'B-1',
  expiryDate: '2027-01-01',
  drugClass: DrugClass.OTC,
  unitId: 'unit-1',
  unitName: 'Tablet',
  conversionFactor: 1,
  quantityInUnit: 2,
  mrpPaisaPerUnit: 125,
  costPaisaPerUnit: null,
  discountPercent: 0,
  lineTotalPaisa: 250,
};

const heldBill: HeldBill = {
  id: 'held-1',
  heldAt: 1_800_000_000_000,
  cart: [cartItem],
  discount: { mode: 'amount', value: '10.00' },
  customerId: 'customer-1',
  customerName: 'Test customer',
  customerType: 'REGISTERED',
  totalPaisa: 240,
};

test('held bills persist independently for each signed-in user', () => {
  const storage = new MemoryStorage();

  writeHeldBills('user one', [heldBill], storage);

  assert.deepEqual(readHeldBills('user one', storage), [heldBill]);
  assert.deepEqual(readHeldBills('user two', storage), []);
  assert.match(heldBillsStorageKey('user one'), /user%20one$/);
});

test('invalid saved held-bill data is reported instead of silently discarded', () => {
  const storage = new MemoryStorage();
  storage.setItem(heldBillsStorageKey('user-1'), JSON.stringify([{ ...heldBill, cart: [] }]));

  assert.throws(() => readHeldBills('user-1', storage), /invalid/);
});

test('held-bill storage errors are surfaced to the caller', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded');
    },
  };

  assert.throws(() => writeHeldBills('user-1', [heldBill], storage), /quota exceeded/);
});
