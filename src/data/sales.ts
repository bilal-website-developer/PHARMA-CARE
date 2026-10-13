import {
  DrugClass,
  PaymentMethod,
  type BatchAllocation,
  type CartItem,
  type CompletedSale,
  type Customer,
} from '../types/pharmacy';
import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';

export interface SalePaymentInput {
  paymentMethod: Exclude<PaymentMethod, PaymentMethod.SPLIT>;
  amountPaisa: number;
}

export interface PostSaleInput {
  customerId: string | null;
  customerName: string;
  items: Array<{ medicineId: string; unitId: string; quantityInUnit: number }>;
  discountPaisa: number;
  roundingPaisa: number;
  tenderedPaisa: number;
  payments: SalePaymentInput[];
}

export interface CustomerAccountsData {
  customers: Customer[];
  ledgerEntries: Record<string, Array<{
    id: string;
    customerId: string;
    date: string;
    type: 'INVOICE' | 'PAYMENT' | 'RETURN';
    referenceNo: string;
    description: string;
    debitPaisa: number;
    creditPaisa: number;
    runningBalancePaisa: number;
  }>>;
}

export interface CustomerPaymentResult {
  referenceNo: string;
  dateTime: string;
  balanceAfterPaisa: number;
  storeCreditPaisa: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isDrugClass(value: unknown): value is DrugClass {
  return Object.values(DrugClass).some((drugClass) => drugClass === value);
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return Object.values(PaymentMethod).some((paymentMethod) => paymentMethod === value);
}

function isCustomer(value: unknown): value is Customer {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isString(value.phone)
    && isString(value.address)
    && isNonNegativeInteger(value.creditLimitPaisa)
    && isNonNegativeInteger(value.currentBalancePaisa)
    && isNonNegativeInteger(value.storeCreditPaisa);
}

function isLedgerEntry(value: unknown): value is CustomerAccountsData['ledgerEntries'][string][number] {
  return isRecord(value)
    && isString(value.id)
    && isString(value.customerId)
    && isString(value.date)
    && (value.type === 'INVOICE' || value.type === 'PAYMENT' || value.type === 'RETURN')
    && isString(value.referenceNo)
    && isString(value.description)
    && isNonNegativeInteger(value.debitPaisa)
    && isNonNegativeInteger(value.creditPaisa)
    && Number.isSafeInteger(value.runningBalancePaisa);
}

function isCustomerAccountsData(value: unknown): value is CustomerAccountsData {
  if (!isRecord(value) || !Array.isArray(value.customers) || !value.customers.every(isCustomer)
      || !isRecord(value.ledgerEntries)) return false;
  return Object.values(value.ledgerEntries).every((entries) =>
    Array.isArray(entries) && entries.every(isLedgerEntry));
}

function isBatchAllocation(value: unknown): value is BatchAllocation {
  return isRecord(value)
    && isString(value.batchId)
    && isString(value.batchNumber)
    && isString(value.expiryDate)
    && isPositiveInteger(value.quantitySmallestUnit);
}

function isCartItem(value: unknown): value is CartItem {
  return isRecord(value)
    && isString(value.productId)
    && isString(value.productName)
    && isString(value.genericName)
    && isString(value.batchId)
    && isString(value.batchNumber)
    && isString(value.expiryDate)
    && isDrugClass(value.drugClass)
    && (value.unitId === undefined || isString(value.unitId))
    && isString(value.unitName)
    && isPositiveInteger(value.conversionFactor)
    && isPositiveInteger(value.quantityInUnit)
    && isNonNegativeInteger(value.mrpPaisaPerUnit)
    && value.costPaisaPerUnit === null
    && isNonNegativeInteger(value.discountPercent)
    && isNonNegativeInteger(value.lineTotalPaisa)
    && Array.isArray(value.batchAllocations)
    && value.batchAllocations.every(isBatchAllocation);
}

function isCompletedSale(value: unknown): value is CompletedSale {
  return isRecord(value)
    && isString(value.id)
    && isString(value.invoiceNumber)
    && isString(value.timestamp)
    && isString(value.cashierName)
    && (value.customerId === null || isString(value.customerId))
    && isString(value.customerName)
    && isString(value.customerPhone)
    && Array.isArray(value.items)
    && value.items.every(isCartItem)
    && isNonNegativeInteger(value.subtotalPaisa)
    && isNonNegativeInteger(value.discountPaisa)
    && isNonNegativeInteger(value.totalPaisa)
    && isNonNegativeInteger(value.roundingPaisa)
    && isPaymentMethod(value.paymentMethod)
    && isNonNegativeInteger(value.amountTenderedPaisa)
    && isNonNegativeInteger(value.changePaisa);
}

function parseSaleHistory(value: unknown): CompletedSale | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items = value.items.map((item): CartItem | null => {
    if (!isRecord(item) || !Array.isArray(item.batchAllocations)) return null;
    const batchAllocations: BatchAllocation[] = [];
    for (const allocation of item.batchAllocations) {
      if (!isRecord(allocation)
          || !isString(allocation.batchId)
          || !isString(allocation.batchNumber)
          || !isString(allocation.expiryDate)
          || !isPositiveInteger(allocation.quantityBaseUnits)) return null;
      batchAllocations.push({
        batchId: allocation.batchId,
        batchNumber: allocation.batchNumber,
        expiryDate: allocation.expiryDate,
        quantitySmallestUnit: allocation.quantityBaseUnits,
      });
    }
    const firstAllocation = batchAllocations[0];
    if (!firstAllocation) return null;
    const candidate: unknown = {
      productId: item.medicineId,
      productName: item.productName,
      genericName: item.genericName,
      batchId: firstAllocation.batchId,
      batchNumber: firstAllocation.batchNumber,
      expiryDate: firstAllocation.expiryDate,
      drugClass: item.drugClass,
      unitId: item.unitId,
      unitName: item.unitName,
      conversionFactor: item.conversionFactor,
      quantityInUnit: item.quantityInUnit,
      mrpPaisaPerUnit: item.pricePaisaPerUnit,
      costPaisaPerUnit: null,
      discountPercent: 0,
      lineTotalPaisa: item.lineTotalPaisa,
      batchAllocations,
    };
    return isCartItem(candidate) ? candidate : null;
  });
  const parsedItems = items.filter((item): item is CartItem => item !== null);
  if (parsedItems.length !== value.items.length) return null;

  const sale = {
    id: value.id,
    invoiceNumber: value.invoiceNumber,
    timestamp: value.timestamp,
    cashierName: value.cashierName,
    customerId: value.customerId,
    customerName: value.customerName,
    customerPhone: value.customerPhone,
    items: parsedItems,
    subtotalPaisa: value.subtotalPaisa,
    discountPaisa: value.discountPaisa,
    totalPaisa: value.totalPaisa,
    roundingPaisa: value.roundingPaisa,
    paymentMethod: value.paymentMethod,
    amountTenderedPaisa: value.amountTenderedPaisa,
    changePaisa: value.changePaisa,
  };
  return isCompletedSale(sale) ? sale : null;
}

export async function callSupabaseRpc<T>(
  name: string,
  args: Record<string, unknown> | undefined,
  fallback: string,
  validate: (value: unknown) => value is T,
): Promise<T> {
  if (!supabase) {
    throw new Error(getSupabaseErrorMessage(new Error('Supabase is not configured.'), fallback));
  }
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(getSupabaseErrorMessage(error, fallback));
  if (!validate(data)) {
    throw new Error(getSupabaseErrorMessage(new Error(`${name} returned an invalid response.`), fallback));
  }
  return data;
}

export async function loadPosCustomers(): Promise<Customer[]> {
  return callSupabaseRpc('pos_customers', undefined, 'Could not load POS customers.', (value): value is Customer[] =>
    Array.isArray(value) && value.every(isCustomer));
}

export async function loadCustomerAccountsSummary(): Promise<CustomerAccountsData> {
  return callSupabaseRpc(
    'customer_accounts_summary',
    undefined,
    'Could not load customer accounts.',
    isCustomerAccountsData,
  );
}

export async function saveCustomer(input: {
  name: string;
  phone: string;
  cnic: string;
  address: string;
  creditLimitPaisa: number;
}): Promise<Customer> {
  return callSupabaseRpc('save_customer', {
    p_name: input.name,
    p_phone: input.phone,
    p_cnic: input.cnic || null,
    p_address: input.address,
    p_credit_limit_paisa: input.creditLimitPaisa,
  }, 'Could not save customer.', isCustomer);
}

export async function recordCustomerPayment(
  customerId: string,
  amountPaisa: number,
  note: string,
): Promise<CustomerPaymentResult> {
  return callSupabaseRpc('record_customer_payment', {
    p_customer_id: customerId,
    p_amount_paisa: amountPaisa,
    p_note: note,
  }, 'Could not record customer payment.', (value): value is CustomerPaymentResult =>
    isRecord(value)
      && isString(value.referenceNo)
      && isString(value.dateTime)
      && isNonNegativeInteger(value.balanceAfterPaisa)
      && isNonNegativeInteger(value.storeCreditPaisa));
}

export async function postSale(input: PostSaleInput): Promise<CompletedSale> {
  const raw = await callSupabaseRpc('post_sale', {
    p_customer_id: input.customerId,
    p_customer_name: input.customerName,
    p_items: input.items.map((item) => ({
      medicine_id: item.medicineId,
      unit_id: item.unitId,
      quantity_in_unit: item.quantityInUnit,
    })),
    p_discount_paisa: input.discountPaisa,
    p_rounding_paisa: input.roundingPaisa,
    p_tendered_paisa: input.tenderedPaisa,
    p_payments: input.payments.map((payment) => ({
      payment_method: payment.paymentMethod,
      amount_paisa: payment.amountPaisa,
    })),
  }, 'Could not complete the sale.', isCompletedSale);
  return raw;
}

export async function loadSalesHistory(limit = 100): Promise<CompletedSale[]> {
  const raw = await callSupabaseRpc('sales_history', { p_limit: limit }, 'Could not load sales history.', (value): value is unknown[] =>
    Array.isArray(value));
  const parsed = raw.map(parseSaleHistory);
  if (parsed.some((sale) => sale === null)) {
    throw new Error(getSupabaseErrorMessage(
      new Error('Sales history returned an invalid response.'),
      'Could not load sales history.',
    ));
  }
  return parsed.filter((sale): sale is CompletedSale => sale !== null);
}
