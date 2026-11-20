export interface SalesProfitDay {
  date: string;
  revenuePaisa: number;
  costPaisa: number;
  grossProfitPaisa: number;
  orderCount: number;
}

export interface SalesProfitSummary {
  revenuePaisa: number;
  costPaisa: number;
  grossProfitPaisa: number;
  orderCount: number;
  daily: SalesProfitDay[];
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isProfitDay(value: unknown): value is SalesProfitDay {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('date' in value) || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
  if (!('revenuePaisa' in value) || !isNonNegativeInteger(value.revenuePaisa)) return false;
  if (!('costPaisa' in value) || !isNonNegativeInteger(value.costPaisa)) return false;
  if (!('grossProfitPaisa' in value) || !Number.isSafeInteger(value.grossProfitPaisa)) return false;
  if (!('orderCount' in value) || !isNonNegativeInteger(value.orderCount)) return false;
  return value.grossProfitPaisa === value.revenuePaisa - value.costPaisa;
}

export function isSalesProfitSummary(value: unknown): value is SalesProfitSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('revenuePaisa' in value) || !isNonNegativeInteger(value.revenuePaisa)) return false;
  if (!('costPaisa' in value) || !isNonNegativeInteger(value.costPaisa)) return false;
  if (!('grossProfitPaisa' in value) || !Number.isSafeInteger(value.grossProfitPaisa)) return false;
  if (!('orderCount' in value) || !isNonNegativeInteger(value.orderCount)) return false;
  if (!('daily' in value) || !Array.isArray(value.daily) || !value.daily.every(isProfitDay)) return false;

  const dailyRevenuePaisa = value.daily.reduce((sum, day) => sum + day.revenuePaisa, 0);
  const dailyCostPaisa = value.daily.reduce((sum, day) => sum + day.costPaisa, 0);
  const dailyOrderCount = value.daily.reduce((sum, day) => sum + day.orderCount, 0);
  return value.grossProfitPaisa === value.revenuePaisa - value.costPaisa
    && dailyRevenuePaisa === value.revenuePaisa
    && dailyCostPaisa === value.costPaisa
    && dailyOrderCount === value.orderCount;
}
