export type DiscountMode = 'amount' | 'percent';

export interface DiscountResult {
  discountPaisa: number;
  payablePaisa: number;
  percentShown: number;
  error?: string;
  limited?: boolean;
  maxDiscountPaisa?: number;
}

interface ComputeDiscountOptions {
  billPaisa: number;
  mode: DiscountMode;
  value: number | string;
  maxPercent?: number;
  maxPaisa?: number;
}

const INVALID_DISCOUNT = 'Enter a valid discount.';

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
  maxPaisa,
}: ComputeDiscountOptions): DiscountResult {
  if (!Number.isSafeInteger(billPaisa) || billPaisa < 0) {
    return errorResult(0, 'Bill amount is invalid.');
  }
  if (mode !== 'amount' && mode !== 'percent') return errorResult(billPaisa, INVALID_DISCOUNT);
  if (maxPaisa !== undefined && (!Number.isSafeInteger(maxPaisa) || maxPaisa < 0)) {
    return errorResult(billPaisa, 'Discount limit is invalid.');
  }

  const valueHundredths = parseHundredths(value);
  if (valueHundredths === null) return errorResult(billPaisa, INVALID_DISCOUNT);

  let requestedDiscountPaisa: bigint;
  if (mode === 'amount') {
    requestedDiscountPaisa = valueHundredths;
  } else {
    if (valueHundredths > 10_000n) return errorResult(billPaisa, 'Discount cannot exceed 100%.');
    requestedDiscountPaisa = (BigInt(billPaisa) * valueHundredths + 5_000n) / 10_000n;
  }

  let maximumDiscountPaisa = BigInt(billPaisa);
  if (maxPercent !== undefined) {
    if (!Number.isFinite(maxPercent) || maxPercent < 0 || maxPercent > 100) {
      return errorResult(billPaisa, 'Discount limit is invalid.');
    }
    const maxPercentHundredths = BigInt(Math.round(maxPercent * 100));
    const roleLimitPaisa = BigInt(billPaisa) * maxPercentHundredths / 10_000n;
    if (roleLimitPaisa < maximumDiscountPaisa) maximumDiscountPaisa = roleLimitPaisa;
  }

  if (maxPaisa !== undefined && BigInt(maxPaisa) < maximumDiscountPaisa) {
    maximumDiscountPaisa = BigInt(maxPaisa);
  }

  const limited = requestedDiscountPaisa > maximumDiscountPaisa;
  const discountPaisa = limited ? maximumDiscountPaisa : requestedDiscountPaisa;
  const appliedDiscountPaisa = Number(discountPaisa);
  const percentShown = billPaisa === 0
    ? 0
    : Number((discountPaisa * 10_000n) / BigInt(billPaisa)) / 100;
  return {
    discountPaisa: appliedDiscountPaisa,
    payablePaisa: billPaisa - appliedDiscountPaisa,
    percentShown,
    ...(limited ? { limited: true, maxDiscountPaisa: Number(maximumDiscountPaisa) } : {}),
  };
}

export function formatDiscountLimit(maxDiscountPaisa: number): string {
  const amount = maxDiscountPaisa / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}
