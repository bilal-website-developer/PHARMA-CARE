export type StockLevel = 'out' | 'low' | 'ok';

export interface StockBarState {
  level: StockLevel;
  percentage: number;
  quantity: number;
  reorderLevel: number;
}

export function getStockBarState(quantity: number, reorderLevel: number): StockBarState {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new RangeError('Stock quantity must be a finite non-negative number.');
  }
  if (!Number.isFinite(reorderLevel) || reorderLevel < 0) {
    throw new RangeError('Reorder level must be a finite non-negative number.');
  }

  const level: StockLevel = quantity === 0
    ? 'out'
    : reorderLevel > 0 && quantity <= reorderLevel
      ? 'low'
      : 'ok';
  const percentage = reorderLevel > 0
    ? Math.min(100, (quantity / reorderLevel) * 100)
    : quantity > 0 ? 100 : 0;

  return { level, percentage, quantity, reorderLevel };
}

export type ExpiryVariant = 'danger' | 'warning' | 'ok' | 'neutral';

export interface ExpiryDisplay {
  label: string;
  variant: ExpiryVariant;
  daysRemaining: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) return null;
  return timestamp;
}

export function getExpiryDisplay(
  expiryDate: string | null | undefined,
  quantity: number,
  today: Date = new Date(),
): ExpiryDisplay {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new RangeError('Stock quantity must be a finite non-negative number.');
  }
  if (quantity === 0) return { label: 'No stock', variant: 'neutral', daysRemaining: null };
  if (!expiryDate) return { label: 'No expiry date', variant: 'neutral', daysRemaining: null };

  const expiry = utcDate(expiryDate);
  if (expiry === null) return { label: 'Invalid expiry date', variant: 'neutral', daysRemaining: null };
  if (!Number.isFinite(today.getTime())) throw new RangeError('Today must be a valid date.');
  const todayValue = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysRemaining = Math.round((expiry - todayValue) / DAY_MS);

  if (daysRemaining < 0) {
    const daysExpired = Math.abs(daysRemaining);
    return {
      label: `Expired ${daysExpired} ${daysExpired === 1 ? 'day' : 'days'} ago`,
      variant: 'danger',
      daysRemaining,
    };
  }
  if (daysRemaining === 0) return { label: 'Expires today', variant: 'warning', daysRemaining };
  return {
    label: `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'}`,
    variant: daysRemaining < 90 ? 'warning' : 'ok',
    daysRemaining,
  };
}
