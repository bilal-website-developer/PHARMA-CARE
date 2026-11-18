import {
  BatchStatus,
  DrugClass,
  PaymentMethod,
  type Batch,
  type CashTransaction,
  type CartItem,
  type CompletedSale,
  type Customer,
  type LedgerEntry,
  type Product,
} from '../types/pharmacy';
import type { PostSaleInput } from '../data/sales';
import { allocateFefo, localIsoDate, restoreBatchAllocations } from './fefo';
import { ROLE_DEMO_STATE_KEY } from './roleDemoStorage';

export interface DemoPurchase {
  id: string;
  reference: string;
  timestamp: string;
  supplierName: string;
  productName: string;
  quantity: number;
  totalPaisa: number;
}

export interface DemoSaleReturn {
  id: string;
  saleId: string;
  invoiceNumber: string;
  productName: string;
  quantity: number;
  refundPaisa: number;
  timestamp: string;
}

export interface RoleDemoState {
  version: 1;
  products: Product[];
  sales: CompletedSale[];
  customers: Customer[];
  ledgerEntries: Record<string, LedgerEntry[]>;
  transactions: CashTransaction[];
  purchases: DemoPurchase[];
  returns: DemoSaleReturn[];
  suppliers: Array<{ id: string; name: string; phone: string }>;
  nextSaleNumber: number;
  nextPurchaseNumber: number;
  nextEntityNumber: number;
}

export interface DemoSaleInput {
  productId: string;
  quantity: number;
  paymentMethod: PaymentMethod.CASH | PaymentMethod.CREDIT;
  customerId?: string;
}

export interface DemoPurchaseInput {
  productId: string;
  quantity: number;
  costPaisaPerUnit: number;
  mrpPaisaPerUnit: number;
  supplierName: string;
}

const DEMO_CASHIER = 'Demo Cashier';
const DEFAULT_SUPPLIER = 'Premier Distributors Ltd';

function daysFrom(now: Date, offset: number): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + offset);
  return date;
}

function timestampLabel(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function makeProduct(
  now: Date,
  input: {
    id: string;
    code: string;
    name: string;
    generic: string;
    category: string;
    company: string;
    price: number;
    cost: number;
    quantity: number;
    expiryDays: number;
    minStock: number;
    drugClass?: DrugClass;
  },
): Product {
  const expiry = localIsoDate(daysFrom(now, input.expiryDays));
  const received = localIsoDate(daysFrom(now, -45));
  return {
    id: input.id,
    code: input.code,
    barcode: `89640001${input.code.slice(-4).padStart(4, '0')}`,
    brandName: input.name,
    genericName: input.generic,
    category: input.category,
    company: input.company,
    drugClass: input.drugClass ?? DrugClass.OTC,
    storageCondition: 'ROOM_TEMPERATURE',
    rackLocation: `A-${input.id.slice(-1)}-01`,
    units: [{
      id: `${input.id}-unit`,
      name: 'Pack',
      conversionFactor: 1,
      isDefaultSaleUnit: true,
      pricePerUnitPaisa: input.price,
    }],
    batches: [{
      id: `${input.id}-batch-1`,
      productId: input.id,
      batchNumber: `${input.code}-A`,
      expiryDate: expiry,
      receivedDate: received,
      costPricePaisa: input.cost,
      mrpPaisa: input.price,
      quantitySmallestUnit: input.quantity,
      status: input.expiryDays <= 30 ? BatchStatus.NEAR_EXPIRY : BatchStatus.ACTIVE,
      supplierName: DEFAULT_SUPPLIER,
    }, ...(input.id === 'demo-product-5' ? [{
      id: `${input.id}-batch-expired`,
      productId: input.id,
      batchNumber: `${input.code}-OLD`,
      expiryDate: localIsoDate(daysFrom(now, -20)),
      receivedDate: localIsoDate(daysFrom(now, -120)),
      costPricePaisa: input.cost,
      mrpPaisa: input.price,
      quantitySmallestUnit: 4,
      status: BatchStatus.EXPIRED,
      supplierName: DEFAULT_SUPPLIER,
    }] : [])],
    minStockAlert: input.minStock,
    requiresPrescription: input.drugClass === DrugClass.RX,
  };
}

function createEmptyState(now: Date): RoleDemoState {
  const customers: Customer[] = [
    {
      id: 'demo-customer-1',
      name: 'Ayesha Khan',
      phone: '0300-1112233',
      creditLimitPaisa: 2_000_000,
      currentBalancePaisa: 0,
      address: 'Gulshan-e-Iqbal, Karachi',
    },
    {
      id: 'demo-customer-2',
      name: 'Usman Ali',
      phone: '0300-2223344',
      creditLimitPaisa: 1_500_000,
      currentBalancePaisa: 0,
      address: 'North Nazimabad, Karachi',
    },
  ];

  const products = [
    makeProduct(now, {
      id: 'demo-product-1', code: 'DEMO-001', name: 'Panadol 500mg',
      generic: 'Paracetamol', category: 'Pain Relief', company: 'GSK Pakistan',
      price: 3500, cost: 2800, quantity: 120, expiryDays: 220, minStock: 20,
    }),
    makeProduct(now, {
      id: 'demo-product-2', code: 'DEMO-002', name: 'Augmentin 625mg',
      generic: 'Amoxicillin + Clavulanic Acid', category: 'Antibiotics', company: 'GSK Pakistan',
      price: 48000, cost: 39000, quantity: 35, expiryDays: 180, minStock: 10, drugClass: DrugClass.RX,
    }),
    makeProduct(now, {
      id: 'demo-product-3', code: 'DEMO-003', name: 'Risek 20mg',
      generic: 'Omeprazole', category: 'Gastrointestinal', company: 'Getz Pharma',
      price: 39200, cost: 31000, quantity: 45, expiryDays: 250, minStock: 12,
    }),
    makeProduct(now, {
      id: 'demo-product-4', code: 'DEMO-004', name: 'Brufen 400mg',
      generic: 'Ibuprofen', category: 'Pain Relief', company: 'Abbott Laboratories',
      price: 4600, cost: 3700, quantity: 60, expiryDays: 20, minStock: 15,
    }),
    makeProduct(now, {
      id: 'demo-product-5', code: 'DEMO-005', name: 'Arinac Forte',
      generic: 'Ibuprofen + Pseudoephedrine', category: 'Cold & Flu', company: 'Abbott Laboratories',
      price: 3200, cost: 2500, quantity: 55, expiryDays: 160, minStock: 12,
    }),
  ];

  return {
    version: 1,
    products,
    sales: [],
    customers,
    ledgerEntries: Object.fromEntries(customers.map((customer) => [customer.id, []])),
    transactions: [{
      id: 'demo-opening-float',
      time: timestampLabel(daysFrom(now, -30)),
      type: 'OPENING_FLOAT',
      description: 'Opening cash float',
      amountPaisa: 50_000_00,
      isOutflow: false,
      handledBy: 'Demo Admin',
    }],
    purchases: [],
    returns: [],
    suppliers: [{
      id: 'demo-supplier-1',
      name: DEFAULT_SUPPLIER,
      phone: '0300-8201122',
    }],
    nextSaleNumber: 1,
    nextPurchaseNumber: 1,
    nextEntityNumber: 1,
  };
}

export function postRoleDemoSale(
  state: RoleDemoState,
  input: DemoSaleInput,
  now = new Date(),
): RoleDemoState {
  const product = state.products.find(({ id }) => id === input.productId);
  if (!product) throw new Error('Choose a product from the demo catalog.');
  const unit = product.units.find(({ isDefaultSaleUnit }) => isDefaultSaleUnit) ?? product.units[0];
  if (!unit) throw new Error('This demo product has no sale unit.');
  const customer = input.customerId
    ? state.customers.find(({ id }) => id === input.customerId)
    : undefined;
  if (input.paymentMethod === PaymentMethod.CREDIT && !customer) {
    throw new Error('Select a customer for a credit sale.');
  }

  const totalPaisa = unit.pricePerUnitPaisa * input.quantity;
  const result = postRoleDemoCheckout(state, {
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? '',
    customerType: input.paymentMethod === PaymentMethod.CREDIT
      ? 'CREDIT'
      : customer ? 'REGISTERED' : 'WALK_IN',
    customerPhone: customer?.phone ?? '',
    customerWhatsapp: customer?.phone ?? '',
    customerAddress: customer?.address ?? '',
    customerNotes: '',
    items: [{ medicineId: product.id, unitId: unit.id, quantityInUnit: input.quantity }],
    discountPaisa: 0,
    roundingPaisa: 0,
    tenderedPaisa: input.paymentMethod === PaymentMethod.CREDIT ? 0 : totalPaisa,
    payments: [{
      paymentMethod: input.paymentMethod,
      amountPaisa: totalPaisa,
      ...(input.paymentMethod === PaymentMethod.CASH ? { providerId: 'cash' } : {}),
    }],
  }, now);
  return result.state;
}

export function postRoleDemoCheckout(
  state: RoleDemoState,
  input: PostSaleInput,
  now = new Date(),
): { state: RoleDemoState; sale: CompletedSale } {
  if (input.items.length === 0) throw new Error('Add at least one product to the demo sale.');

  const products = [...state.products];
  const saleItems: CartItem[] = input.items.map((line) => {
    if (!Number.isSafeInteger(line.quantityInUnit) || line.quantityInUnit <= 0) {
      throw new RangeError('Enter a whole quantity greater than zero.');
    }
    const productIndex = products.findIndex(({ id }) => id === line.medicineId);
    const product = products[productIndex];
    if (!product) throw new Error('Choose a product from the demo catalog.');
    const unit = product.units.find(({ id }) => id === line.unitId);
    if (!unit) throw new Error(`Choose a configured sale unit for ${product.brandName}.`);

    const requiredUnits = line.quantityInUnit * unit.conversionFactor;
    if (!Number.isSafeInteger(requiredUnits)) throw new RangeError('The requested quantity is too large.');
    const allocations = allocateFefo(product.batches, requiredUnits, localIsoDate(now));
    const batchById = new Map(product.batches.map((batch) => [batch.id, batch]));
    const firstBatch = batchById.get(allocations[0].batchId);
    if (!firstBatch) throw new Error('The allocated demo stock batch was not found.');
    const costPaisa = allocations.reduce((sum, allocation) => {
      const batch = batchById.get(allocation.batchId);
      if (!batch) throw new Error(`Allocated batch ${allocation.batchId} was not found.`);
      return sum + batch.costPricePaisa * allocation.quantitySmallestUnit;
    }, 0);
    const lineTotalPaisa = unit.pricePerUnitPaisa * line.quantityInUnit;
    if (!Number.isSafeInteger(lineTotalPaisa) || lineTotalPaisa <= 0) {
      throw new RangeError('The sale total is invalid.');
    }
    products[productIndex] = {
      ...product,
      batches: product.batches.map((batch) => {
        const allocated = allocations
          .filter(({ batchId }) => batchId === batch.id)
          .reduce((sum, allocation) => sum + allocation.quantitySmallestUnit, 0);
        return { ...batch, quantitySmallestUnit: batch.quantitySmallestUnit - allocated };
      }),
    };
    return {
      productId: product.id,
      productName: product.brandName,
      genericName: product.genericName,
      batchId: firstBatch.id,
      batchNumber: firstBatch.batchNumber,
      expiryDate: firstBatch.expiryDate,
      drugClass: product.drugClass,
      unitId: unit.id,
      unitName: unit.name,
      conversionFactor: unit.conversionFactor,
      quantityInUnit: line.quantityInUnit,
      mrpPaisaPerUnit: unit.pricePerUnitPaisa,
      costPaisaPerUnit: Math.round(costPaisa / line.quantityInUnit),
      discountPercent: 0,
      lineTotalPaisa,
      batchAllocations: allocations,
    };
  });

  const subtotalPaisa = saleItems.reduce((sum, item) => sum + item.lineTotalPaisa, 0);
  if (!Number.isSafeInteger(subtotalPaisa)
    || !Number.isSafeInteger(input.discountPaisa)
    || input.discountPaisa < 0
    || input.discountPaisa > subtotalPaisa
    || !Number.isSafeInteger(input.roundingPaisa)) {
    throw new RangeError('The demo sale totals are invalid.');
  }
  const totalPaisa = subtotalPaisa - input.discountPaisa + input.roundingPaisa;
  if (!Number.isSafeInteger(totalPaisa) || totalPaisa <= 0) {
    throw new RangeError('The sale total is invalid.');
  }
  if (!Number.isSafeInteger(input.tenderedPaisa) || input.tenderedPaisa < 0
    || input.payments.length === 0
    || input.payments.some((payment) => !Number.isSafeInteger(payment.amountPaisa) || payment.amountPaisa <= 0)
    || input.payments.reduce((sum, payment) => sum + payment.amountPaisa, 0) !== totalPaisa) {
    throw new RangeError('Payment amounts must equal the demo sale total.');
  }

  const customer = input.customerId
    ? state.customers.find(({ id }) => id === input.customerId)
    : undefined;
  if (input.customerId && !customer) throw new Error('Choose a customer from the demo ledger.');
  const creditPaisa = input.payments
    .filter(({ paymentMethod }) => paymentMethod === PaymentMethod.CREDIT)
    .reduce((sum, payment) => sum + payment.amountPaisa, 0);
  if (creditPaisa > 0 && !customer) throw new Error('Select a customer for a credit sale.');
  if (customer && creditPaisa > 0
    && customer.currentBalancePaisa + creditPaisa > customer.creditLimitPaisa) {
    throw new RangeError('This sale would exceed the customer credit limit.');
  }

  const invoiceNumber = `DEMO-${String(state.nextSaleNumber).padStart(4, '0')}`;
  const sale: CompletedSale = {
    id: `demo-sale-${state.nextSaleNumber}`,
    invoiceNumber,
    timestamp: now.toISOString(),
    cashierName: DEMO_CASHIER,
    customerType: input.customerType,
    customerName: input.customerName.trim() || customer?.name || undefined,
    customerPhone: input.customerPhone || undefined,
    customerWhatsapp: input.customerWhatsapp || undefined,
    customerAddress: input.customerAddress || undefined,
    customerNotes: input.customerNotes || undefined,
    customerId: customer?.id,
    items: saleItems,
    subtotalPaisa,
    discountPaisa: input.discountPaisa,
    totalPaisa,
    roundingPaisa: input.roundingPaisa,
    paymentMethod: input.payments.length === 1
      ? input.payments[0].paymentMethod
      : PaymentMethod.SPLIT,
    paymentDetails: input.payments.map((payment) => ({ ...payment })),
    amountTenderedPaisa: input.tenderedPaisa,
    changePaisa: Math.max(0, input.tenderedPaisa - totalPaisa),
  };

  let ledgerEntries = state.ledgerEntries;
  let customers = state.customers;
  if (customer && creditPaisa > 0) {
    const balance = customer.currentBalancePaisa + creditPaisa;
    const entry: LedgerEntry = {
      id: `demo-ledger-${state.nextEntityNumber}`,
      customerId: customer.id,
      date: now.toISOString(),
      type: 'INVOICE',
      referenceNo: invoiceNumber,
      description: `Credit sale - ${saleItems.map((item) => item.productName).join(', ')}`,
      debitPaisa: creditPaisa,
      creditPaisa: 0,
      runningBalancePaisa: balance,
    };
    ledgerEntries = {
      ...state.ledgerEntries,
      [customer.id]: [entry, ...(state.ledgerEntries[customer.id] ?? [])],
    };
    customers = state.customers.map((item) => item.id === customer.id
      ? { ...item, currentBalancePaisa: balance }
      : item);
  }

  const cashPaisa = input.payments
    .filter(({ paymentMethod }) => paymentMethod === PaymentMethod.CASH)
    .reduce((sum, payment) => sum + payment.amountPaisa, 0);
  const cashTransaction: CashTransaction | null = cashPaisa > 0
    ? {
      id: `demo-cash-sale-${state.nextEntityNumber}`,
      time: timestampLabel(now),
      type: 'SALE',
      description: `Sale ${invoiceNumber}`,
      amountPaisa: cashPaisa,
      isOutflow: false,
      handledBy: DEMO_CASHIER,
    }
    : null;
  const nextState: RoleDemoState = {
    ...state,
    products,
    sales: [sale, ...state.sales],
    customers,
    ledgerEntries,
    transactions: cashTransaction ? [cashTransaction, ...state.transactions] : state.transactions,
    nextSaleNumber: state.nextSaleNumber + 1,
    nextEntityNumber: state.nextEntityNumber + 1,
  };
  return { state: nextState, sale };
}

export function postRoleDemoPurchase(
  state: RoleDemoState,
  input: DemoPurchaseInput,
  now = new Date(),
): RoleDemoState {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError('Enter a whole purchase quantity greater than zero.');
  }
  if (!Number.isSafeInteger(input.costPaisaPerUnit) || input.costPaisaPerUnit <= 0
    || !Number.isSafeInteger(input.mrpPaisaPerUnit) || input.mrpPaisaPerUnit <= 0) {
    throw new RangeError('Enter valid purchase cost and selling price amounts.');
  }
  const product = state.products.find(({ id }) => id === input.productId);
  if (!product) throw new Error('Choose a product from the demo catalog.');
  if (!input.supplierName.trim()) throw new Error('Choose a supplier for the demo purchase.');
  const totalPaisa = input.quantity * input.costPaisaPerUnit;
  if (!Number.isSafeInteger(totalPaisa)) throw new RangeError('The purchase total is too large.');
  const reference = `DEMO-PO-${String(state.nextPurchaseNumber).padStart(4, '0')}`;
  const batch: Batch = {
    id: `demo-purchase-batch-${state.nextEntityNumber}`,
    productId: product.id,
    batchNumber: `DEMO-${state.nextPurchaseNumber}-A`,
    expiryDate: localIsoDate(daysFrom(now, 240)),
    receivedDate: localIsoDate(now),
    costPricePaisa: input.costPaisaPerUnit,
    mrpPaisa: input.mrpPaisaPerUnit,
    quantitySmallestUnit: input.quantity,
    status: BatchStatus.ACTIVE,
    supplierName: input.supplierName,
  };
  const purchase: DemoPurchase = {
    id: `demo-purchase-${state.nextPurchaseNumber}`,
    reference,
    timestamp: now.toISOString(),
    supplierName: input.supplierName,
    productName: product.brandName,
    quantity: input.quantity,
    totalPaisa,
  };
  return {
    ...state,
    products: state.products.map((item) => item.id === product.id
      ? { ...item, batches: [...item.batches, batch] }
      : item),
    purchases: [purchase, ...state.purchases],
    nextPurchaseNumber: state.nextPurchaseNumber + 1,
    nextEntityNumber: state.nextEntityNumber + 1,
  };
}

export function recordRoleDemoPayment(
  state: RoleDemoState,
  customerId: string,
  amountPaisa: number,
  note: string,
  now = new Date(),
): { state: RoleDemoState; referenceNo: string; dateTime: string; balanceAfterPaisa: number } {
  const customer = state.customers.find(({ id }) => id === customerId);
  if (!customer) throw new Error('Choose a customer in the demo ledger.');
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa <= 0) {
    throw new RangeError('Payment must be a positive whole paisa amount.');
  }
  if (amountPaisa > customer.currentBalancePaisa) {
    throw new RangeError('Payment cannot be more than the customer balance.');
  }

  const referenceNo = `DEMO-PAY-${String(state.nextEntityNumber).padStart(4, '0')}`;
  const balanceAfterPaisa = customer.currentBalancePaisa - amountPaisa;
  const entry: LedgerEntry = {
    id: `demo-ledger-${state.nextEntityNumber}`,
    customerId,
    date: now.toISOString(),
    type: 'PAYMENT',
    referenceNo,
    description: note.trim() || 'Demo customer payment',
    debitPaisa: 0,
    creditPaisa: amountPaisa,
    runningBalancePaisa: balanceAfterPaisa,
  };
  return {
    state: {
      ...state,
      customers: state.customers.map((item) => item.id === customerId
        ? { ...item, currentBalancePaisa: balanceAfterPaisa }
        : item),
      ledgerEntries: {
        ...state.ledgerEntries,
        [customerId]: [entry, ...(state.ledgerEntries[customerId] ?? [])],
      },
      transactions: [{
        id: `demo-cash-payment-${state.nextEntityNumber}`,
        time: timestampLabel(now),
        type: 'CREDIT_RECOVERY',
        description: `Payment from ${customer.name}`,
        amountPaisa,
        isOutflow: false,
        handledBy: DEMO_CASHIER,
      }, ...state.transactions],
      nextEntityNumber: state.nextEntityNumber + 1,
    },
    referenceNo,
    dateTime: now.toISOString(),
    balanceAfterPaisa,
  };
}

export function addRoleDemoCustomer(
  state: RoleDemoState,
  input: { name: string; phone: string; cnic: string; address: string; creditLimitPaisa: number },
): Customer {
  if (!input.name.trim()) throw new Error('Enter the customer name.');
  if (!Number.isSafeInteger(input.creditLimitPaisa) || input.creditLimitPaisa < 0) {
    throw new RangeError('Enter a valid credit limit.');
  }
  const customer: Customer = {
    id: `demo-customer-${state.nextEntityNumber + 2}`,
    name: input.name.trim(),
    phone: input.phone.trim(),
    cnic: input.cnic.trim() || undefined,
    address: input.address.trim(),
    creditLimitPaisa: input.creditLimitPaisa,
    currentBalancePaisa: 0,
  };
  return customer;
}

export function appendRoleDemoCustomer(state: RoleDemoState, customer: Customer): RoleDemoState {
  return {
    ...state,
    customers: [...state.customers, customer],
    ledgerEntries: { ...state.ledgerEntries, [customer.id]: [] },
    nextEntityNumber: state.nextEntityNumber + 1,
  };
}

export function addRoleDemoExpense(
  state: RoleDemoState,
  description: string,
  amountPaisa: number,
  now = new Date(),
): RoleDemoState {
  if (!description.trim()) throw new Error('Enter an expense description.');
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa <= 0) {
    throw new RangeError('Expense must be a positive whole paisa amount.');
  }
  return {
    ...state,
    transactions: [{
      id: `demo-expense-${state.nextEntityNumber}`,
      time: timestampLabel(now),
      type: 'EXPENSE',
      description: description.trim(),
      amountPaisa,
      isOutflow: true,
      handledBy: DEMO_CASHIER,
    }, ...state.transactions],
    nextEntityNumber: state.nextEntityNumber + 1,
  };
}

export function returnRoleDemoSale(
  state: RoleDemoState,
  saleId: string,
  productId: string,
  quantity: number,
  now = new Date(),
): RoleDemoState {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError('Enter a whole return quantity greater than zero.');
  }
  const sale = state.sales.find(({ id }) => id === saleId);
  const item = sale?.items.find(({ productId: itemProductId }) => itemProductId === productId);
  if (!sale || !item) throw new Error('Choose an item from a demo sale.');
  const alreadyReturned = state.returns
    .filter((entry) => entry.saleId === saleId && entry.productName === item.productName)
    .reduce((sum, entry) => sum + entry.quantity, 0);
  if (quantity > item.quantityInUnit - alreadyReturned) {
    throw new RangeError('Return quantity exceeds the quantity sold.');
  }
  const product = state.products.find(({ id }) => id === productId);
  if (!product) throw new Error('The demo product for this sale no longer exists.');

  let remainingSmallestUnits = quantity * item.conversionFactor;
  const originalAllocations = item.batchAllocations ?? [{
    batchId: item.batchId,
    batchNumber: item.batchNumber,
    expiryDate: item.expiryDate,
    quantitySmallestUnit: item.quantityInUnit * item.conversionFactor,
  }];
  const allocations = originalAllocations.flatMap((allocation) => {
    const returned = Math.min(remainingSmallestUnits, allocation.quantitySmallestUnit);
    remainingSmallestUnits -= returned;
    return returned > 0 ? [{ ...allocation, quantitySmallestUnit: returned }] : [];
  });
  if (remainingSmallestUnits > 0) throw new Error('The original sale batch allocation is incomplete.');
  const batches = restoreBatchAllocations(product.batches, allocations);
  const previousRefundPaisa = Math.round(
    (item.lineTotalPaisa * sale.totalPaisa / sale.subtotalPaisa)
      * alreadyReturned / item.quantityInUnit,
  );
  const cumulativeRefundPaisa = Math.round(
    (item.lineTotalPaisa * sale.totalPaisa / sale.subtotalPaisa)
      * (alreadyReturned + quantity) / item.quantityInUnit,
  );
  const refundPaisa = cumulativeRefundPaisa - previousRefundPaisa;
  const returned: DemoSaleReturn = {
    id: `demo-return-${state.nextEntityNumber}`,
    saleId,
    invoiceNumber: sale.invoiceNumber,
    productName: item.productName,
    quantity,
    refundPaisa,
    timestamp: now.toISOString(),
  };

  const paymentDetails = sale.paymentDetails?.length
    ? sale.paymentDetails
    : sale.paymentMethod === PaymentMethod.SPLIT
      ? []
      : [{ paymentMethod: sale.paymentMethod, amountPaisa: sale.totalPaisa }];
  const cashPaidPaisa = paymentDetails
    .filter(({ paymentMethod }) => paymentMethod === PaymentMethod.CASH)
    .reduce((sum, payment) => sum + payment.amountPaisa, 0);
  const creditPaidPaisa = paymentDetails
    .filter(({ paymentMethod }) => paymentMethod === PaymentMethod.CREDIT)
    .reduce((sum, payment) => sum + payment.amountPaisa, 0);
  const creditRefundPaisa = sale.totalPaisa > 0
    ? Math.round(refundPaisa * creditPaidPaisa / sale.totalPaisa)
    : 0;
  const cashRefundPaisa = sale.totalPaisa > 0
    ? Math.min(
      refundPaisa - creditRefundPaisa,
      Math.round(refundPaisa * cashPaidPaisa / sale.totalPaisa),
    )
    : 0;
  let customers = state.customers;
  let ledgerEntries = state.ledgerEntries;
  if ((creditRefundPaisa > 0 || refundPaisa > cashRefundPaisa) && sale.customerId) {
    const originalCustomer = state.customers.find(({ id }) => id === sale.customerId);
    if (!originalCustomer) throw new Error('The demo customer for this sale was not found.');
    const appliedCreditPaisa = Math.min(creditRefundPaisa, originalCustomer.currentBalancePaisa);
    const storeCreditPaisa = refundPaisa - cashRefundPaisa - appliedCreditPaisa;
    const balance = originalCustomer.currentBalancePaisa - appliedCreditPaisa;
    customers = state.customers.map((customer) => customer.id === sale.customerId
      ? {
        ...customer,
        currentBalancePaisa: balance,
        storeCreditPaisa: (customer.storeCreditPaisa ?? 0) + storeCreditPaisa,
      }
      : customer);
    if (appliedCreditPaisa > 0) {
      const entry: LedgerEntry = {
        id: `demo-ledger-${state.nextEntityNumber}`,
        customerId: sale.customerId,
        date: now.toISOString(),
        type: 'RETURN',
        referenceNo: `DEMO-RET-${state.nextEntityNumber}`,
        description: `Return - ${item.productName}`,
        debitPaisa: 0,
        creditPaisa: appliedCreditPaisa,
        runningBalancePaisa: balance,
      };
      ledgerEntries = {
        ...state.ledgerEntries,
        [sale.customerId]: [entry, ...(state.ledgerEntries[sale.customerId] ?? [])],
      };
    }
  }

  const cashTransaction: CashTransaction | null = cashRefundPaisa > 0
    ? {
      id: `demo-cash-return-${state.nextEntityNumber}`,
      time: timestampLabel(now),
      type: 'EXPENSE',
      description: `Refund for ${sale.invoiceNumber}`,
      amountPaisa: cashRefundPaisa,
      isOutflow: true,
      handledBy: DEMO_CASHIER,
    }
    : null;
  return {
    ...state,
    products: state.products.map((entry) => entry.id === product.id ? { ...product, batches } : entry),
    customers,
    ledgerEntries,
    returns: [returned, ...state.returns],
    transactions: cashTransaction ? [cashTransaction, ...state.transactions] : state.transactions,
    nextEntityNumber: state.nextEntityNumber + 1,
  };
}

export function createRoleDemoState(now = new Date()): RoleDemoState {
  let state = createEmptyState(now);
  const purchaseFixtures = [
    { daysAgo: 25, productId: 'demo-product-1', quantity: 10 },
    { daysAgo: 17, productId: 'demo-product-2', quantity: 6 },
    { daysAgo: 8, productId: 'demo-product-4', quantity: 8 },
  ];
  for (const fixture of purchaseFixtures) {
    const product = state.products.find(({ id }) => id === fixture.productId);
    const batch = product?.batches[0];
    if (!product || !batch) continue;
    state = postRoleDemoPurchase(state, {
      productId: product.id,
      quantity: fixture.quantity,
      costPaisaPerUnit: batch.costPricePaisa,
      mrpPaisaPerUnit: batch.mrpPaisa,
      supplierName: DEFAULT_SUPPLIER,
    }, daysFrom(now, -fixture.daysAgo));
  }

  const saleFixtures = [
    { daysAgo: 28, productId: 'demo-product-1', customerId: 'demo-customer-1', method: PaymentMethod.CREDIT },
    { daysAgo: 25, productId: 'demo-product-2', method: PaymentMethod.CASH },
    { daysAgo: 22, productId: 'demo-product-3', method: PaymentMethod.CASH },
    { daysAgo: 19, productId: 'demo-product-4', customerId: 'demo-customer-2', method: PaymentMethod.CREDIT },
    { daysAgo: 16, productId: 'demo-product-5', method: PaymentMethod.CASH },
    { daysAgo: 13, productId: 'demo-product-1', method: PaymentMethod.CASH },
    { daysAgo: 10, productId: 'demo-product-2', method: PaymentMethod.CASH },
    { daysAgo: 7, productId: 'demo-product-3', customerId: 'demo-customer-1', method: PaymentMethod.CREDIT },
    { daysAgo: 4, productId: 'demo-product-4', method: PaymentMethod.CASH },
    { daysAgo: 1, productId: 'demo-product-5', method: PaymentMethod.CASH },
  ] as const;
  for (const fixture of saleFixtures) {
    state = postRoleDemoSale(state, {
      productId: fixture.productId,
      quantity: 1,
      paymentMethod: fixture.method,
      customerId: 'customerId' in fixture ? fixture.customerId : undefined,
    }, daysFrom(now, -fixture.daysAgo));
  }

  for (const [index, fixture] of [
    { daysAgo: 24, description: 'Utility bill', amountPaisa: 12_500_00 },
    { daysAgo: 14, description: 'Shop supplies', amountPaisa: 4_500_00 },
    { daysAgo: 5, description: 'Local delivery', amountPaisa: 2_000_00 },
  ].entries()) {
    state = addRoleDemoExpense(state, fixture.description, fixture.amountPaisa, daysFrom(now, -fixture.daysAgo));
    if (index === 0) {
      const customer = state.customers.find(({ id }) => id === 'demo-customer-1');
      if (customer?.currentBalancePaisa) {
        const payment = recordRoleDemoPayment(
          state,
          customer.id,
          Math.min(5_000, customer.currentBalancePaisa),
          'Part payment',
          daysFrom(now, -21),
        );
        state = payment.state;
      }
    }
  }
  return state;
}

function isRoleDemoState(value: unknown): value is RoleDemoState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<RoleDemoState>;
  return state.version === 1
    && Array.isArray(state.products)
    && Array.isArray(state.sales)
    && Array.isArray(state.customers)
    && typeof state.ledgerEntries === 'object'
    && state.ledgerEntries !== null
    && Array.isArray(state.transactions)
    && Array.isArray(state.purchases)
    && Array.isArray(state.returns)
    && Array.isArray(state.suppliers)
    && Number.isSafeInteger(state.nextSaleNumber)
    && Number.isSafeInteger(state.nextPurchaseNumber)
    && Number.isSafeInteger(state.nextEntityNumber);
}

type DemoStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readRoleDemoState(
  storage: DemoStorage,
  now = new Date(),
): { state: RoleDemoState; warning: string | null } {
  try {
    const stored = storage.getItem(ROLE_DEMO_STATE_KEY);
    if (stored === null) return { state: createRoleDemoState(now), warning: null };
    const parsed: unknown = JSON.parse(stored);
    if (isRoleDemoState(parsed)) return { state: parsed, warning: null };
    return {
      state: createRoleDemoState(now),
      warning: 'Saved demo data was invalid, so a fresh demo workspace was started.',
    };
  } catch (error) {
    return {
      state: createRoleDemoState(now),
      warning: `Demo changes could not be restored from this browser session. ${error instanceof Error ? error.message : ''}`.trim(),
    };
  }
}

export function writeRoleDemoState(storage: DemoStorage, state: RoleDemoState): string | null {
  try {
    storage.setItem(ROLE_DEMO_STATE_KEY, JSON.stringify(state));
    return null;
  } catch (error) {
    return `Demo changes could not be saved for this browser session. ${error instanceof Error ? error.message : ''}`.trim();
  }
}
