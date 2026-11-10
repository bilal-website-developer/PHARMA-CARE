import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRole } from '../types/pharmacy';
import {
  buildCustomerDisplayOptionsMessage,
  buildCustomerDisplayPayment,
  buildCustomerDisplaySnapshot,
  buildSameMedicineOptions,
  canAccessCustomerDisplay,
  getCustomerDisplayChannelId,
  getCustomerDisplayPageSize,
  isCustomerDisplayChannelId,
  parseCustomerDisplayMessage,
  readCustomerDisplayAlternatives,
  saveCustomerDisplayAlternatives,
} from './customerDisplay';
import { BatchStatus, DrugClass } from '../types/pharmacy';
import {
  readUserDisplayPreferences,
  saveUserDisplayPreferences,
} from './userDisplayPreferences';

const product = (overrides: Partial<Parameters<typeof buildSameMedicineOptions>[0][number]> = {}) => ({
  id: 'product-a',
  code: 'CODE-A',
  barcode: null,
  brandName: 'Brand A',
  genericName: 'Generic X',
  strength: '10 mg',
  category: 'Category',
  company: 'Company A',
  drugClass: DrugClass.OTC,
  units: [{ id: 'unit-a', name: 'Pack', conversionFactor: 1, isDefaultSaleUnit: true, pricePerUnitPaisa: 1000 }],
  batches: [{
    id: 'batch-a',
    productId: 'product-a',
    batchNumber: 'PRIVATE-BATCH',
    expiryDate: '2027-12-31',
    receivedDate: '2026-01-01',
    quantitySmallestUnit: 10,
    status: BatchStatus.ACTIVE,
  }],
  ...overrides,
});

test('customer display access follows POS permission and admin defaults', () => {
  assert.equal(canAccessCustomerDisplay(UserRole.ADMIN, []), true);
  assert.equal(canAccessCustomerDisplay(UserRole.SUPER_ADMIN, []), true);
  assert.equal(canAccessCustomerDisplay(UserRole.CASHIER, ['pos']), true);
  assert.equal(canAccessCustomerDisplay(UserRole.CASHIER, []), false);
  assert.equal(canAccessCustomerDisplay(UserRole.MANAGER, ['pos']), true);
  assert.equal(canAccessCustomerDisplay(UserRole.MANAGER, ['customers']), false);
  assert.equal(canAccessCustomerDisplay(UserRole.ACCOUNTANT, ['reports']), false);
});

test('similar-medicine display preference is per user and safely defaults off', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    assert.equal(readCustomerDisplayAlternatives('cashier-a'), false);
    assert.equal(saveCustomerDisplayAlternatives('cashier-a', true), true);
    assert.equal(readCustomerDisplayAlternatives('cashier-a'), true);
    assert.equal(readCustomerDisplayAlternatives('cashier-b'), false);
    assert.equal(saveCustomerDisplayAlternatives('', true), false);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('personal display settings persist per user and retain safe defaults', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    assert.deepEqual(readUserDisplayPreferences('user-a'), {
      theme: 'light', textSize: 'normal', animationsEnabled: true,
    });
    assert.equal(saveUserDisplayPreferences('user-a', {
      theme: 'night', textSize: 'large', animationsEnabled: false,
    }), true);
    assert.deepEqual(readUserDisplayPreferences('user-a'), {
      theme: 'night', textSize: 'large', animationsEnabled: false,
    });
    assert.deepEqual(readUserDisplayPreferences('user-b'), {
      theme: 'light', textSize: 'normal', animationsEnabled: true,
    });
    assert.equal(saveUserDisplayPreferences('', {
      theme: 'light', textSize: 'normal', animationsEnabled: true,
    }), false);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('customer display automatically tightens rows and pages to the available viewport', () => {
  assert.deepEqual(getCustomerDisplayPageSize(420, 4), { density: 'comfortable', pageSize: 8 });
  assert.deepEqual(getCustomerDisplayPageSize(420, 8), { density: 'compact', pageSize: 10 });
  assert.deepEqual(getCustomerDisplayPageSize(420, 18), { density: 'dense', pageSize: 10 });
  assert.deepEqual(getCustomerDisplayPageSize(1, 18), { density: 'dense', pageSize: 1 });
});

test('customer display snapshot projects only approved cart fields', () => {
  const sourceLine = {
    productName: 'Sample medicine',
    unitName: 'Strip',
    quantity: 2,
    batchNumber: 'BATCH-7',
    expiryDate: '2027-12-31',
    unitPricePaisa: 2500,
    lineTotalPaisa: 5000,
    genericName: 'Hidden generic detail',
    costPaisaPerUnit: 900,
    customerPhone: 'not copied',
  };
  const snapshot = buildCustomerDisplaySnapshot(
    [sourceLine],
    5000,
    0,
    5000,
    'order',
    buildCustomerDisplayPayment('CASH', 5000),
  );

  assert.deepEqual(Object.keys(snapshot), [
    'type', 'stage', 'items', 'subtotalPaisa', 'discountPaisa', 'totalPaisa', 'payment',
  ]);
  assert.deepEqual(snapshot.items[0], {
    productName: 'Sample medicine',
    unitName: 'Strip',
    quantity: 2,
    batchNumber: 'BATCH-7',
    expiryDate: '2027-12-31',
    unitPricePaisa: 2500,
    lineTotalPaisa: 5000,
  });
  assert.deepEqual(Object.keys(snapshot.payment), [
    'method', 'paidPaisa', 'balanceDuePaisa', 'changePaisa',
  ]);
});

test('payment summary shows only this bill due for credit and correct cash balance/change', () => {
  assert.deepEqual(buildCustomerDisplayPayment('CREDIT', 5000), {
    method: 'CREDIT', paidPaisa: 0, balanceDuePaisa: 5000, changePaisa: 0,
  });
  assert.deepEqual(buildCustomerDisplayPayment('CASH', 5000, 3500), {
    method: 'CASH', paidPaisa: 3500, balanceDuePaisa: 1500, changePaisa: 0,
  });
  assert.deepEqual(buildCustomerDisplayPayment('CASH', 5000, 6500), {
    method: 'CASH', paidPaisa: 5000, balanceDuePaisa: 0, changePaisa: 1500,
  });
});

test('same-medicine options match generic and strength, require sellable stock, sort, and cap at three', () => {
  const current = product();
  const candidates = Array.from({ length: 9 }, (_, index) => product({
    id: `option-${index}`,
    code: `OPTION-${index}`,
    brandName: `Option ${index}`,
    company: `Company ${index}`,
    units: [{
      id: `unit-${index}`,
      name: 'Pack',
      conversionFactor: 1,
      isDefaultSaleUnit: true,
      pricePerUnitPaisa: (9 - index) * 100,
    }],
    batches: [{
      id: `batch-${index}`,
      productId: `option-${index}`,
      batchNumber: `PRIVATE-${index}`,
      expiryDate: '2027-12-31',
      receivedDate: '2026-01-01',
      quantitySmallestUnit: index === 8 ? 0 : 20,
      status: BatchStatus.ACTIVE,
    }],
  }));
  const wrongGeneric = product({ id: 'wrong-generic', genericName: 'Other' });
  const wrongStrength = product({ id: 'wrong-strength', strength: '20 mg' });
  const expired = product({
    id: 'expired',
    batches: [{
      id: 'expired-batch', productId: 'expired', batchNumber: 'PRIVATE-EXPIRED',
      expiryDate: '2026-01-01', receivedDate: '2025-01-01', quantitySmallestUnit: 20,
      status: BatchStatus.ACTIVE,
    }],
  });

  const options = buildSameMedicineOptions(
    [current, ...candidates, wrongGeneric, wrongStrength, expired],
    current.id,
    1,
    '2026-11-05',
  );

  assert.equal(options.length, 3);
  assert.deepEqual(options.map((option) => option.unitPricePaisa), [200, 300, 400]);
  assert.ok(options.every((option) => option.productId.startsWith('option-')));
  assert.equal(Object.keys(options[0]).sort().join(','), [
    'brandName', 'company', 'productId', 'strength', 'unitId', 'unitName', 'unitPricePaisa',
  ].sort().join(','));
});

test('customer display options payload contains only the explicit presentation allowlist', () => {
  const candidate = {
    productId: 'medicine-id',
    unitId: 'unit-id',
    brandName: 'Safe Brand',
    company: 'Safe Company',
    strength: '10 mg',
    unitName: 'Pack',
    unitPricePaisa: 1000,
    costPaisaPerUnit: 900,
    marginPaisa: 100,
    supplierName: 'Private supplier',
    batchNumber: 'Private batch',
    exactStock: 30,
    phone: '03000000000',
    history: ['private'],
  };
  const message = buildCustomerDisplayOptionsMessage('Current brand', '10 mg', [candidate]);

  assert.deepEqual(Object.keys(message).sort(), ['currentProductName', 'options', 'strength', 'type'].sort());
  assert.deepEqual(Object.keys(message.options[0]).sort(), [
    'brandName', 'company', 'strength', 'unitName', 'unitPricePaisa',
  ].sort());
  assert.equal(parseCustomerDisplayMessage(message)?.type, 'options');
});

test('customer display message parser strips unapproved fields and rejects invalid amounts', () => {
  const parsed = parseCustomerDisplayMessage({
    type: 'snapshot',
    stage: 'order',
    items: [{
      productName: 'Sample medicine',
      unitName: 'Strip',
      quantity: 1,
      batchNumber: 'BATCH-1',
      expiryDate: '2028-01-31',
      unitPricePaisa: 2500,
      lineTotalPaisa: 2500,
      costPaisaPerUnit: 900,
      customerName: 'Not for display',
    }],
    subtotalPaisa: 2500,
    discountPaisa: 0,
    totalPaisa: 2500,
    payment: { method: 'CASH', paidPaisa: 2500, balanceDuePaisa: 0, changePaisa: 0 },
    customerPhone: 'Not for display',
  });

  assert.deepEqual(parsed, {
    type: 'snapshot',
    stage: 'order',
    items: [{
      productName: 'Sample medicine',
      unitName: 'Strip',
      quantity: 1,
      batchNumber: 'BATCH-1',
      expiryDate: '2028-01-31',
      unitPricePaisa: 2500,
      lineTotalPaisa: 2500,
    }],
    subtotalPaisa: 2500,
    discountPaisa: 0,
    totalPaisa: 2500,
    payment: { method: 'CASH', paidPaisa: 2500, balanceDuePaisa: 0, changePaisa: 0 },
  });
  assert.equal(parseCustomerDisplayMessage({
    type: 'snapshot', stage: 'order', items: [], subtotalPaisa: -1, discountPaisa: 0,
    totalPaisa: 0, payment: { method: 'CASH', paidPaisa: 0, balanceDuePaisa: 0, changePaisa: 0 },
  }), null);
  assert.equal(parseCustomerDisplayMessage({ type: 'ready' })?.type, 'ready');
  assert.equal(parseCustomerDisplayMessage({ type: 'closed' })?.type, 'closed');
  assert.equal(parseCustomerDisplayMessage({ type: 'thank_you' })?.type, 'thank_you');
  assert.deepEqual(parseCustomerDisplayMessage({ type: 'option_selected', optionIndex: 2 }), {
    type: 'option_selected', optionIndex: 2,
  });
  assert.equal(parseCustomerDisplayMessage({ type: 'option_selected', optionIndex: 3 }), null);
});

test('customer display channel id must be a UUID', () => {
  assert.equal(isCustomerDisplayChannelId('d8de2ef6-20a0-4b9b-8db7-2ad0d011aaaa'), true);
  assert.equal(isCustomerDisplayChannelId('not-a-channel'), false);
  assert.equal(isCustomerDisplayChannelId(null), false);
});

test('customer display channel link persists per user', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    const firstUserId = getCustomerDisplayChannelId('user-a');
    assert.equal(getCustomerDisplayChannelId('user-a'), firstUserId);
    assert.equal(getCustomerDisplayChannelId('user-b') === firstUserId, false);
    assert.equal(isCustomerDisplayChannelId(firstUserId), true);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
