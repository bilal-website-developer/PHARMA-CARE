import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentMethod, UserRole } from '../types/pharmacy';
import {
  canOpenDemoPreview,
  DEMO_PREVIEW_ROLES,
  getDemoRolePages,
  parseDemoPreviewRole,
} from './demoPreview';
import {
  addRoleDemoExpense,
  createRoleDemoState,
  postRoleDemoCheckout,
  postRoleDemoPurchase,
  postRoleDemoSale,
  readRoleDemoState,
  recordRoleDemoPayment,
  returnRoleDemoSale,
  writeRoleDemoState,
} from './roleDemoSandbox';
import {
  clearDemoAccountEntry,
  clearDemoAccountMarker,
  clearRoleDemoSession,
  consumeDemoAccountEntry,
  DEMO_ACCOUNT_MARKER_KEY,
  markDemoAccountEntry,
  readDemoAccountMarker,
  ROLE_DEMO_ROLE_KEY,
  ROLE_DEMO_STATE_KEY,
  writeDemoAccountMarker,
} from './roleDemoStorage';
import { availableSmallestUnits } from './fefo';

test('only Super Admin can open the Role Demo page in the real workspace', () => {
  assert.equal(canOpenDemoPreview(UserRole.SUPER_ADMIN), true);
  assert.equal(canOpenDemoPreview(UserRole.ADMIN), false);
  assert.equal(canOpenDemoPreview(UserRole.MANAGER), false);
  assert.equal(canOpenDemoPreview(UserRole.CASHIER), false);
  assert.equal(canOpenDemoPreview(UserRole.ACCOUNTANT), false);
});

test('role picker includes every app role and safely parses persisted roles', () => {
  assert.deepEqual(DEMO_PREVIEW_ROLES, [
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.CASHIER,
    UserRole.ACCOUNTANT,
  ]);
  assert.equal(parseDemoPreviewRole(UserRole.MANAGER), UserRole.MANAGER);
  assert.equal(parseDemoPreviewRole('not-a-role'), null);
});

test('demo workspaces keep role-specific page access', () => {
  const superAdminPages = getDemoRolePages(UserRole.SUPER_ADMIN).map(({ key }) => key);
  const adminPages = getDemoRolePages(UserRole.ADMIN).map(({ key }) => key);
  const cashierPages = getDemoRolePages(UserRole.CASHIER).map(({ key }) => key);
  const accountantPages = getDemoRolePages(UserRole.ACCOUNTANT).map(({ key }) => key);

  assert.ok(superAdminPages.includes('shops'));
  assert.ok(superAdminPages.includes('manage-users'));
  assert.ok(!superAdminPages.includes('pos'));
  assert.ok(adminPages.includes('pos'));
  assert.ok(adminPages.includes('trash-bin'));
  assert.ok(!adminPages.includes('shops'));
  assert.ok(cashierPages.includes('pos'));
  assert.ok(cashierPages.includes('sales-history'));
  assert.ok(!cashierPages.includes('purchases'));
  assert.ok(!cashierPages.includes('settings'));
  assert.ok(accountantPages.includes('reports'));
  assert.ok(!accountantPages.includes('pos'));
});

test('30-day sandbox seed contains coherent purchase, sale, customer, and expense activity', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');
  const state = createRoleDemoState(now);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);

  assert.equal(state.products.length, 5);
  assert.equal(state.purchases.length, 3);
  assert.equal(state.sales.length, 10);
  assert.equal(state.customers.length, 2);
  assert.ok(state.sales.every((sale) => new Date(sale.timestamp) >= cutoff && new Date(sale.timestamp) <= now));
  assert.ok(state.transactions.some((transaction) => transaction.type === 'EXPENSE'));
  assert.ok(state.sales.some((sale) => sale.paymentMethod === PaymentMethod.CREDIT));
  assert.ok(state.customers.some((customer) => customer.currentBalancePaisa > 0));
});

test('purchase, POS sale, credit payment, return, and expenses update the shared sandbox', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');
  let state = createRoleDemoState(now);
  const product = state.products[0];
  const beforePurchaseStock = availableSmallestUnits(product.batches);

  state = postRoleDemoPurchase(state, {
    productId: product.id,
    quantity: 7,
    costPaisaPerUnit: 2800,
    mrpPaisaPerUnit: 3500,
    supplierName: 'Premier Distributors Ltd',
  }, now);
  assert.equal(availableSmallestUnits(state.products[0].batches), beforePurchaseStock + 7);
  assert.equal(state.purchases[0].quantity, 7);

  const beforeSaleStock = availableSmallestUnits(state.products[0].batches);
  state = postRoleDemoSale(state, {
    productId: product.id,
    quantity: 2,
    paymentMethod: PaymentMethod.CASH,
  }, now);
  assert.equal(availableSmallestUnits(state.products[0].batches), beforeSaleStock - 2);
  assert.equal(state.sales[0].invoiceNumber, 'DEMO-0011');

  const creditSale = state.sales.find((sale) => sale.paymentMethod === PaymentMethod.CREDIT);
  assert.ok(creditSale);
  const returnStockBefore = availableSmallestUnits(state.products.find(({ id }) => id === creditSale.items[0].productId)!.batches);
  const customer = state.customers.find(({ id }) => id === creditSale.customerId);
  assert.ok(customer && customer.currentBalancePaisa > 0);
  const payment = recordRoleDemoPayment(state, customer.id, 100, 'Test payment', now);
  state = payment.state;
  assert.ok(state.ledgerEntries[customer.id].some((entry) => entry.type === 'PAYMENT'));

  const currentCreditSale = state.sales.find(({ id }) => id === creditSale.id)!;
  state = returnRoleDemoSale(state, currentCreditSale.id, currentCreditSale.items[0].productId, 1, now);
  const returnedProduct = state.products.find(({ id }) => id === currentCreditSale.items[0].productId)!;
  assert.equal(availableSmallestUnits(returnedProduct.batches), returnStockBefore + 1);
  assert.equal(state.returns.length, 1);
  assert.throws(
    () => returnRoleDemoSale(state, currentCreditSale.id, currentCreditSale.items[0].productId, 1, now),
    /exceeds the quantity sold/,
  );

  const transactionCount = state.transactions.length;
  state = addRoleDemoExpense(state, 'Test expense', 2500, now);
  assert.equal(state.transactions.length, transactionCount + 1);
  assert.equal(state.transactions[0].type, 'EXPENSE');
});

test('real POS checkout supports multi-item discounts and split payments in the sandbox', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');
  const initial = createRoleDemoState(now);
  const firstProduct = initial.products[0];
  const secondProduct = initial.products[2];
  const customer = initial.customers[0];
  const firstUnit = firstProduct.units[0];
  const secondUnit = secondProduct.units[0];
  const subtotalPaisa = firstUnit.pricePerUnitPaisa * 2 + secondUnit.pricePerUnitPaisa;
  const discountPaisa = 1_000;
  const totalPaisa = subtotalPaisa - discountPaisa;
  const checkout = postRoleDemoCheckout(initial, {
    customerId: customer.id,
    customerName: customer.name,
    customerType: 'REGISTERED',
    customerPhone: customer.phone,
    customerWhatsapp: customer.phone,
    customerAddress: customer.address ?? '',
    customerNotes: '',
    items: [
      { medicineId: firstProduct.id, unitId: firstUnit.id, quantityInUnit: 2 },
      { medicineId: secondProduct.id, unitId: secondUnit.id, quantityInUnit: 1 },
    ],
    discountPaisa,
    roundingPaisa: 0,
    tenderedPaisa: totalPaisa,
    payments: [
      { paymentMethod: PaymentMethod.CASH, providerId: 'cash', amountPaisa: 20_000 },
      { paymentMethod: PaymentMethod.CREDIT, amountPaisa: totalPaisa - 20_000 },
    ],
  }, now);

  assert.equal(checkout.sale.items.length, 2);
  assert.equal(checkout.sale.discountPaisa, discountPaisa);
  assert.equal(checkout.sale.totalPaisa, totalPaisa);
  assert.equal(checkout.sale.paymentMethod, PaymentMethod.SPLIT);
  assert.equal(checkout.state.customers[0].currentBalancePaisa, customer.currentBalancePaisa + totalPaisa - 20_000);
  assert.equal(checkout.state.transactions[0].amountPaisa, 20_000);

  const returnedState = returnRoleDemoSale(
    checkout.state,
    checkout.sale.id,
    firstProduct.id,
    1,
    now,
  );
  assert.ok(returnedState.customers[0].currentBalancePaisa < checkout.state.customers[0].currentBalancePaisa);
  assert.equal(returnedState.transactions[0].type, 'EXPENSE');
  assert.ok(returnedState.transactions[0].amountPaisa < returnedState.returns[0].refundPaisa);
});

test('demo state survives refresh using session storage and exit clears only demo keys', () => {
  const values = new Map<string, string>([[ROLE_DEMO_ROLE_KEY, UserRole.MANAGER]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const state = createRoleDemoState(new Date('2026-11-16T12:00:00.000Z'));

  assert.equal(writeRoleDemoState(storage, state), null);
  const restored = readRoleDemoState(storage);
  assert.equal(restored.warning, null);
  assert.equal(restored.state.sales.length, state.sales.length);
  assert.equal(restored.state.sales[0].invoiceNumber, state.sales[0].invoiceNumber);
  assert.equal(values.has(ROLE_DEMO_STATE_KEY), true);
  assert.equal(clearRoleDemoSession(storage), null);
  assert.equal(values.has(ROLE_DEMO_STATE_KEY), false);
  assert.equal(values.has(ROLE_DEMO_ROLE_KEY), false);
});

test('demo account remembers identity and entry state without persisting a password', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const marker = { userId: 'demo-admin-id', role: UserRole.ADMIN };

  assert.equal(writeDemoAccountMarker(storage, marker), null);
  assert.deepEqual(readDemoAccountMarker(storage), { marker, warning: null });
  assert.doesNotMatch(values.get(DEMO_ACCOUNT_MARKER_KEY) ?? '', /password/i);

  assert.equal(markDemoAccountEntry(storage, marker.userId), null);
  assert.deepEqual(consumeDemoAccountEntry(storage, marker.userId), { shouldEnter: true, warning: null });
  assert.deepEqual(consumeDemoAccountEntry(storage, marker.userId), { shouldEnter: false, warning: null });
  assert.equal(clearDemoAccountMarker(storage), null);
  assert.equal(clearDemoAccountEntry(storage), null);
});

test('malformed saved sandbox data is replaced with a fresh seed and a visible warning', () => {
  const values = new Map<string, string>([[ROLE_DEMO_STATE_KEY, '{broken']]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const loaded = readRoleDemoState(storage, new Date('2026-11-16T12:00:00.000Z'));

  assert.match(loaded.warning ?? '', /could not be restored/);
  assert.equal(loaded.state.sales.length, 10);
});
