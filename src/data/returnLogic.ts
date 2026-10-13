export type ReturnDisposition = 'RESTOCK' | 'QUARANTINE' | 'WRITE_OFF';

export interface ReturnLineValue {
  soldQuantityBaseUnits: number;
  lineTotalPaisa: number;
  alreadyReturnedBaseUnits: number;
}

export interface ReturnRestockConditions {
  sealedIntact: boolean;
  drugClass: string;
  storageCondition: string;
  saleDate: string;
  expiryDate: string;
  returnWindowDays: number;
  minimumShelfLifeDays: number;
  today: string;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function calculateReturnAmountPaisa(line: ReturnLineValue, quantityBaseUnits: number): number {
  if (
    !Number.isSafeInteger(line.soldQuantityBaseUnits)
    || line.soldQuantityBaseUnits <= 0
    || !isNonNegativeSafeInteger(line.lineTotalPaisa)
    || !isNonNegativeSafeInteger(line.alreadyReturnedBaseUnits)
    || !Number.isSafeInteger(quantityBaseUnits)
    || quantityBaseUnits <= 0
    || line.alreadyReturnedBaseUnits + quantityBaseUnits > line.soldQuantityBaseUnits
  ) {
    throw new RangeError('Return quantity or original sale line is invalid.');
  }

  const before = Math.floor(line.lineTotalPaisa * line.alreadyReturnedBaseUnits / line.soldQuantityBaseUnits);
  const after = Math.floor(
    line.lineTotalPaisa * (line.alreadyReturnedBaseUnits + quantityBaseUnits) / line.soldQuantityBaseUnits,
  );
  return after - before;
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getRestockEligibilityReason(conditions: ReturnRestockConditions): string | null {
  if (!conditions.sealedIntact) return 'Only sealed, intact original packs may be restocked.';
  if (conditions.storageCondition === 'COLD_REFRIGERATED') return 'Cold-chain medicine cannot be restocked.';
  if (conditions.drugClass === 'CONTROLLED' || conditions.drugClass === 'NARCOTIC') {
    return 'Controlled and narcotic medicines cannot be restocked.';
  }

  const saleDate = parseDate(conditions.saleDate);
  const expiryDate = parseDate(conditions.expiryDate);
  const today = parseDate(conditions.today);
  if (!saleDate || !expiryDate || !today) return 'Sale, expiry, or current date is invalid.';
  if (!Number.isSafeInteger(conditions.returnWindowDays) || conditions.returnWindowDays < 0) {
    return 'Return-window setting is invalid.';
  }
  if (!Number.isSafeInteger(conditions.minimumShelfLifeDays) || conditions.minimumShelfLifeDays < 0) {
    return 'Minimum shelf-life setting is invalid.';
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const ageDays = Math.floor((today.getTime() - saleDate.getTime()) / millisecondsPerDay);
  const remainingShelfDays = Math.floor((expiryDate.getTime() - today.getTime()) / millisecondsPerDay);
  if (ageDays < 0 || ageDays > conditions.returnWindowDays) return 'Return is outside the allowed return window.';
  if (remainingShelfDays < conditions.minimumShelfLifeDays) {
    return 'Medicine does not have enough remaining shelf life to be restocked.';
  }
  return null;
}
