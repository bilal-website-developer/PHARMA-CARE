import { computeDiscount, DiscountMode, formatDiscountLimit } from '../utils/discount';

interface DiscountBoxProps {
  billPaisa: number;
  discount: { mode: DiscountMode; value: string };
  maxPercent: number;
  maxPaisa: number;
  notice?: string;
  onChange: (discount: { mode: DiscountMode; value: string }) => void;
}

const QUICK_PERCENTAGES = [2, 5, 10, 15, 20] as const;

export function DiscountBox({ billPaisa, discount, maxPercent, maxPaisa, notice, onChange }: DiscountBoxProps) {
  const result = computeDiscount({
    billPaisa,
    mode: discount.mode,
    value: discount.value,
    maxPercent,
    maxPaisa,
  });
  const limitMessage = result.limited
    ? `${discount.mode === 'amount' ? 'Maximum discount is' : 'Limited to'} Rs ${formatDiscountLimit(result.maxDiscountPaisa ?? 0)}`
    : '';
  const message = notice || result.error || limitMessage;

  return (
    <section className="order-4 space-y-2 rounded-control border border-border bg-surface p-3" aria-label="Discount">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-text">Disc:</span>
        <div className="inline-flex rounded-control border border-border p-0.5" role="group" aria-label="Discount type">
          {(['amount', 'percent'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={discount.mode === mode}
              onClick={() => onChange({ ...discount, mode })}
              className={`rounded-control px-3 py-1.5 text-xs font-bold ${
                discount.mode === mode ? 'bg-primary text-white' : 'text-text hover:bg-surface'
              }`}
            >
              {mode === 'amount' ? 'Rs' : '%'}
            </button>
          ))}
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-1 rounded-control border border-border bg-white px-2 text-sm font-semibold text-muted focus-within:ring-2 focus-within:ring-accent">
          <span>{discount.mode === 'amount' ? 'Rs.' : '%'}</span>
          <input
            aria-label="Discount amount"
            type="text"
            inputMode="decimal"
            value={discount.value}
            onChange={(event) => onChange({ ...discount, value: event.target.value })}
            className="min-w-0 flex-1 bg-transparent py-2 font-mono text-text outline-none"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-muted">Quick %:</span>
        {QUICK_PERCENTAGES.map((percent) => (
          <button
            key={percent}
            type="button"
            aria-pressed={discount.mode === 'percent' && discount.value === String(percent)}
            onClick={() => onChange({ mode: 'percent', value: String(percent) })}
            className={`rounded-control border px-2 py-1 font-bold ${
              discount.mode === 'percent' && discount.value === String(percent)
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-white text-text hover:bg-surface'
            }`}
          >
            {percent}%
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ mode: 'percent', value: '' })}
          className="rounded-control border border-border px-2 py-1 font-bold text-text hover:bg-surface"
        >
          Clear
        </button>
      </div>
      {message && <p role="alert" className="text-xs font-semibold text-danger">{message}</p>}
    </section>
  );
}
