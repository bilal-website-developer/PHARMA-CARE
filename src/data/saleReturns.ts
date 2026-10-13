import {
  callSupabaseRpc,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isString,
} from './sales';
import type { ReturnDisposition } from './returnLogic';

export interface SaleReturnAllocation {
  allocationId: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantityBaseUnits: number;
  alreadyReturnedBaseUnits: number;
}

export interface SaleForReturnItem {
  saleItemId: string;
  medicineId: string;
  productName: string;
  genericName: string;
  unitName: string;
  conversionFactor: number;
  quantityInUnit: number;
  quantityBaseUnits: number;
  lineTotalPaisa: number;
  drugClass: string;
  storageCondition: string;
  allocations: SaleReturnAllocation[];
}

export interface SaleForReturn {
  id: string;
  invoiceNumber: string;
  saleDate: string;
  customerId: string | null;
  customerName: string;
  totalPaisa: number;
  items: SaleForReturnItem[];
}

export interface PendingReturnItem {
  id: string;
  saleItemId: string;
  medicineId: string;
  productName: string;
  unitName: string;
  conversionFactor: number;
  quantityBaseUnits: number;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  drugClass: string;
  storageCondition: string;
  medicineUnits: Array<{ id: string; name: string; conversionFactor: number }>;
}

export interface PendingSaleReturn {
  id: string;
  saleId: string;
  invoiceNumber: string;
  saleDate: string;
  customerName: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  items: PendingReturnItem[];
}

export interface ReturnPolicySettings {
  returnWindowDays: number;
  minimumRestockShelfLifeDays: number;
}

export interface SaleReturnRequestItem {
  saleItemId: string;
  allocationId: string;
  quantityBaseUnits: number;
}

export interface SaleReturnDecision {
  id: string;
  disposition: ReturnDisposition;
  sealedIntact: boolean;
  restockUnitId: string | null;
  reason: string;
}

export interface CompletedSaleReturn {
  id: string;
  invoiceNumber: string;
  status: 'COMPLETED';
  refundMethod: 'CASH' | 'CREDIT';
  refundTotalPaisa: number;
  customerBalancePaisa: number | null;
  customerStoreCreditPaisa: number | null;
  items: Array<{
    productName: string;
    unitName: string;
    quantityBaseUnits: number;
    disposition: ReturnDisposition;
    refundPaisa: number;
  }>;
}

function isDate(value: unknown): value is string {
  return isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isAllocation(value: unknown): value is SaleReturnAllocation {
  return isRecord(value)
    && isString(value.allocationId)
    && isString(value.batchId)
    && isString(value.batchNumber)
    && isDate(value.expiryDate)
    && isPositiveInteger(value.quantityBaseUnits)
    && isNonNegativeInteger(value.alreadyReturnedBaseUnits);
}

function isSaleItem(value: unknown): value is SaleForReturnItem {
  return isRecord(value)
    && isString(value.saleItemId)
    && isString(value.medicineId)
    && isString(value.productName)
    && isString(value.genericName)
    && isString(value.unitName)
    && isPositiveInteger(value.conversionFactor)
    && isPositiveInteger(value.quantityInUnit)
    && isPositiveInteger(value.quantityBaseUnits)
    && isNonNegativeInteger(value.lineTotalPaisa)
    && isString(value.drugClass)
    && isString(value.storageCondition)
    && Array.isArray(value.allocations)
    && value.allocations.every(isAllocation);
}

function isSaleForReturn(value: unknown): value is SaleForReturn {
  return isRecord(value)
    && isString(value.id)
    && isString(value.invoiceNumber)
    && isDate(value.saleDate)
    && (value.customerId === null || isString(value.customerId))
    && isString(value.customerName)
    && isNonNegativeInteger(value.totalPaisa)
    && Array.isArray(value.items)
    && value.items.every(isSaleItem);
}

function isPendingReturnItem(value: unknown): value is PendingReturnItem {
  return isRecord(value)
    && isString(value.id)
    && isString(value.saleItemId)
    && isString(value.medicineId)
    && isString(value.productName)
    && isString(value.unitName)
    && isPositiveInteger(value.conversionFactor)
    && isPositiveInteger(value.quantityBaseUnits)
    && isString(value.batchId)
    && isString(value.batchNumber)
    && isDate(value.expiryDate)
    && isString(value.drugClass)
    && isString(value.storageCondition)
    && Array.isArray(value.medicineUnits)
    && value.medicineUnits.every((unit: unknown) => isRecord(unit)
      && isString(unit.id)
      && isString(unit.name)
      && isPositiveInteger(unit.conversionFactor));
}

function isPendingReturn(value: unknown): value is PendingSaleReturn {
  return isRecord(value)
    && isString(value.id)
    && isString(value.saleId)
    && isString(value.invoiceNumber)
    && isDate(value.saleDate)
    && isString(value.customerName)
    && isString(value.reason)
    && isString(value.requestedBy)
    && isString(value.requestedAt)
    && Array.isArray(value.items)
    && value.items.every(isPendingReturnItem);
}

function isPolicy(value: unknown): value is ReturnPolicySettings {
  return isRecord(value)
    && isNonNegativeInteger(value.returnWindowDays)
    && isNonNegativeInteger(value.minimumRestockShelfLifeDays);
}

function isReturnRequestResponse(value: unknown): value is { id: string; status: 'PENDING'; invoiceNumber: string } {
  return isRecord(value)
    && isString(value.id)
    && value.status === 'PENDING'
    && isString(value.invoiceNumber);
}

function isCompletedReturn(value: unknown): value is CompletedSaleReturn {
  return isRecord(value)
    && isString(value.id)
    && isString(value.invoiceNumber)
    && value.status === 'COMPLETED'
    && (value.refundMethod === 'CASH' || value.refundMethod === 'CREDIT')
    && isNonNegativeInteger(value.refundTotalPaisa)
    && (value.customerBalancePaisa === null || isNonNegativeInteger(value.customerBalancePaisa))
    && (value.customerStoreCreditPaisa === null || isNonNegativeInteger(value.customerStoreCreditPaisa))
    && Array.isArray(value.items)
    && value.items.every((item: unknown) => isRecord(item)
      && isString(item.productName)
      && isString(item.unitName)
      && isPositiveInteger(item.quantityBaseUnits)
      && (item.disposition === 'RESTOCK' || item.disposition === 'QUARANTINE' || item.disposition === 'WRITE_OFF')
      && isNonNegativeInteger(item.refundPaisa));
}

export async function getReturnPolicySettings(): Promise<ReturnPolicySettings> {
  return callSupabaseRpc('get_return_policy_settings', undefined, 'Could not load return settings.', isPolicy);
}

export async function updateReturnPolicySettings(settings: ReturnPolicySettings): Promise<ReturnPolicySettings> {
  return callSupabaseRpc('update_return_policy_settings', {
    p_return_window_days: settings.returnWindowDays,
    p_minimum_restock_shelf_life_days: settings.minimumRestockShelfLifeDays,
  }, 'Could not save return settings.', isPolicy);
}

export async function loadSaleForReturn(invoiceNumber: string): Promise<SaleForReturn> {
  return callSupabaseRpc('sale_for_return', { p_invoice_number: invoiceNumber }, 'Could not find the sale.', isSaleForReturn);
}

export async function requestSaleReturn(
  saleId: string,
  reason: string,
  items: readonly SaleReturnRequestItem[],
): Promise<{ id: string; status: 'PENDING'; invoiceNumber: string }> {
  return callSupabaseRpc('request_sale_return', {
    p_sale_id: saleId,
    p_reason: reason,
    p_items: items.map((item) => ({
      sale_item_id: item.saleItemId,
      allocation_id: item.allocationId,
      quantity_base_units: item.quantityBaseUnits,
    })),
  }, 'Could not submit the return request.', isReturnRequestResponse);
}

export async function loadPendingSaleReturns(): Promise<PendingSaleReturn[]> {
  return callSupabaseRpc('pending_sale_returns', undefined, 'Could not load pending returns.', (value): value is PendingSaleReturn[] =>
    Array.isArray(value) && value.every(isPendingReturn));
}

export async function processSaleReturn(
  returnId: string,
  decisions: readonly SaleReturnDecision[],
): Promise<CompletedSaleReturn> {
  return callSupabaseRpc('process_sale_return', {
    p_return_id: returnId,
    p_decisions: decisions.map((decision) => ({
      id: decision.id,
      disposition: decision.disposition,
      sealedIntact: decision.sealedIntact,
      restockUnitId: decision.restockUnitId,
      reason: decision.reason,
    })),
  }, 'Could not process the return.', isCompletedReturn);
}

export async function rejectSaleReturn(returnId: string, reason: string): Promise<void> {
  await callSupabaseRpc('reject_sale_return', {
    p_return_id: returnId,
    p_reason: reason,
  }, 'Could not reject the return request.', (value): value is { id: string; status: 'REJECTED' } =>
    isRecord(value) && isString(value.id) && value.status === 'REJECTED');
}
