import { useEffect } from 'react';
import { FlaskConical, Receipt } from 'lucide-react';
import { DEMO_RECEIPTS } from '../utils/demoReceipt';

function formatMoney(paisa: number) {
  return `Rs ${(paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function returnStatusLabel(status: string) {
  if (status === 'returned') return 'Returned';
  if (status === 'partially_returned') return 'Partially returned';
  return 'Not returned';
}

export function DemoReceiptsPage() {
  useEffect(() => {
    document.title = 'Sample Receipts | Pharma Care';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  return (
    <main className="min-h-screen bg-surface px-3 py-6 text-text sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-card border border-primary/20 bg-white p-5 shadow-xs sm:p-7">
          <div className="flex items-start gap-3">
            <FlaskConical className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-primary">Pharma Care demo</p>
              <h1 className="mt-1 text-2xl font-black">Sample sales and receipts</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                These are fictional examples for preview only. They are not connected to a pharmacy, customer account, or Supabase data.
              </p>
            </div>
          </div>
        </header>

        {DEMO_RECEIPTS.map((receipt) => (
          <article key={receipt.invoiceNumber} className="overflow-hidden rounded-card border border-border bg-white shadow-xs">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface px-4 py-4 sm:px-6">
              <div className="flex items-start gap-2.5">
                <Receipt className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-bold">{receipt.invoiceNumber}</h2>
                  <p className="mt-1 text-xs text-muted">{receipt.dateTime}</p>
                </div>
              </div>
              <span className="rounded-full border border-border bg-white px-2.5 py-1 text-xs font-semibold text-text">
                {receipt.status}
              </span>
            </header>
            <section className="divide-y divide-border px-4 sm:px-6" aria-label={`Items for ${receipt.invoiceNumber}`}>
              {receipt.items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold">{item.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {item.quantity} {item.unit} × {formatMoney(item.pricePaisa)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted">{returnStatusLabel(item.returnStatus)}</p>
                  </div>
                  <strong className="shrink-0 text-sm">{formatMoney(item.lineTotalPaisa)}</strong>
                </div>
              ))}
            </section>
            <section className="space-y-2 border-t border-border bg-surface px-4 py-4 text-sm sm:px-6">
              <div className="flex justify-between gap-3 text-muted"><span>Discount</span><span>{formatMoney(receipt.discountPaisa)}</span></div>
              <div className="flex justify-between gap-3 font-bold"><span>Total</span><span>{formatMoney(receipt.totalPaisa)}</span></div>
              <div className="flex justify-between gap-3 text-muted"><span>Paid</span><span>{formatMoney(receipt.paidPaisa)}</span></div>
              {receipt.changePaisa > 0 && (
                <div className="flex justify-between gap-3 text-muted"><span>Change</span><span>{formatMoney(receipt.changePaisa)}</span></div>
              )}
              {receipt.creditDuePaisa !== null && (
                <div className="flex justify-between gap-3 font-semibold"><span>Sample credit due</span><span>{formatMoney(receipt.creditDuePaisa)}</span></div>
              )}
            </section>
          </article>
        ))}
        <p className="text-center text-xs text-muted">Demo only · No real sale or customer information is shown.</p>
      </div>
    </main>
  );
}
