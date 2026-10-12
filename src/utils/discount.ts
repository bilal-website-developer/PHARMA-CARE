export type DiscountMode = 'amount' | 'percent';

export interface DiscountResult {
  discountPaisa: number;
  payablePaisa: number;
  percentShown: number;
  error?: string;
}

interface ComputeDiscountOptions {
  billPaisa: number;
  mode: DiscountMode;
  value: number | string;
  maxPercent?: number;
}

const INVALID_DISCOUNT = 'Enter a valid discount.';
const DISCOUNT_ABOVE_BILL = 'Discount cannot exceed the bill.';
const DISCOUNT_ABOVE_LIMIT = 'Discount above your limit. Ask a manager.';

function parseHundredths(value: number | string): bigint | null {
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  if (!text) return 0n;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(text);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  return whole * 100n + fraction;
}

function errorResult(billPaisa: number, error: string): DiscountResult {
  return { discountPaisa: 0, payablePaisa: billPaisa, percentShown: 0, error };
}

export function computeDiscount({
  billPaisa,
  mode,
  value,
  maxPercent,
}: ComputeDiscountOptions): DiscountResult {
  if (!Number.isSafeInteger(billPaisa) || billPaisa < 0) {
    return errorResult(0, 'Bill amount is invalid.');
  }
  if (mode !== 'amount' && mode !== 'percent') return errorResult(billPaisa, INVALID_DISCOUNT);

  const valueHundredths = parseHundredths(value);
  if (valueHundredths === null) return errorResult(billPaisa, INVALID_DISCOUNT);

  let discountPaisa: bigint;
  if (mode === 'amount') {
    discountPaisa = valueHundredths;
  } else {
    if (valueHundredths > 10_000n) return errorResult(billPaisa, 'Discount cannot exceed 100%.');
    discountPaisa = (BigInt(billPaisa) * valueHundredths + 5_000n) / 10_000n;
  }

  if (discountPaisa > BigInt(billPaisa)) return errorResult(billPaisa, DISCOUNT_ABOVE_BILL);

  if (maxPercent !== undefined) {
    if (!Number.isFinite(maxPercent) || maxPercent < 0 || maxPercent > 100) {
      return errorResult(billPaisa, 'Discount limit is invalid.');
    }
    const maxPercentHundredths = BigInt(Math.round(maxPercent * 100));
    if (mode === 'percent' && valueHundredths > maxPercentHundredths) {
      return errorResult(billPaisa, DISCOUNT_ABOVE_LIMIT);
    }
    if (discountPaisa * 10_000n > BigInt(billPaisa) * maxPercentHundredths) {
      return errorResult(billPaisa, DISCOUNT_ABOVE_LIMIT);
    }
  }

  const appliedDiscountPaisa = Number(discountPaisa);
  const percentShown = billPaisa === 0
    ? 0
    : Number((discountPaisa * 10_000n) / BigInt(billPaisa)) / 100;
  return {
    discountPaisa: appliedDiscountPaisa,
    payablePaisa: billPaisa - appliedDiscountPaisa,
    percentShown,
  };
}
