import { useEffect, useState } from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';

interface PublicReceipt {
  shop: { name: string; address: string; phone: string };
  invoiceNumber: string;
  dateTime: string;
  items: Array<{
    name: string;
    unit: string;
    quantity: number;
    pricePaisa: number;
    lineTotalPaisa: number;
    batchDetails: Array<{ batchNumber: string; expiryDate: string }>;
    returnStatus: 'not_returned' | 'partially_returned' | 'returned';
  }>;
  discountPaisa: number;
  totalPaisa: number;
  paidPaisa: number;
  changePaisa: number;
  creditDuePaisa: number | null;
  status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parsePublicReceipt(value: unknown): PublicReceipt {
  if (!isRecord(value) || !isRecord(value.shop)
    || !isText(value.shop.name) || !isText(value.shop.address) || !isText(value.shop.phone)
    || !isText(value.invoiceNumber) || !isText(value.dateTime) || !isText(value.status)
    || !isMoney(value.discountPaisa) || !isMoney(value.totalPaisa)
    || !isMoney(value.paidPaisa) || !isMoney(value.changePaisa)
    || (value.creditDuePaisa !== null && !isMoney(value.creditDuePaisa))
    || !Array.isArray(value.items)) {
    throw new Error('The receipt response is invalid.');
  }
  const items = value.items.map((item) => {
    if (!isRecord(item) || !isText(item.name) || !isText(item.unit)
      || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)
      || !isMoney(item.pricePaisa) || !isMoney(item.lineTotalPaisa)
      || !Array.isArray(item.batchDetails)
      || !['not_returned', 'partially_returned', 'returned'].includes(String(item.returnStatus))) {
      throw new Error('The receipt response is invalid.');
    }
    const batchDetails = item.batchDetails.map((batch) => {
      if (!isRecord(batch) || !isText(batch.batchNumber) || !isText(batch.expiryDate)) {
        throw new Error('The receipt response is invalid.');
      }
      return { batchNumber: batch.batchNumber, expiryDate: batch.expiryDate };
    });
    return {
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      pricePaisa: item.pricePaisa,
      lineTotalPaisa: item.lineTotalPaisa,
      batchDetails,
      returnStatus: item.returnStatus as PublicReceipt['items'][number]['returnStatus'],
    };
  });
  return {
    shop: { name: value.shop.name, address: value.shop.address, phone: value.shop.phone },
    invoiceNumber: value.invoiceNumber,
    dateTime: value.dateTime,
    items,
    discountPaisa: value.discountPaisa,
    totalPaisa: value.totalPaisa,
    paidPaisa: value.paidPaisa,
    changePaisa: value.changePaisa,
    creditDuePaisa: value.creditDuePaisa,
    status: value.status,
  };
}

function formatMoney(paisa: number) {
  return `Rs ${(paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface PublicReceiptPageProps {
  token: string | null;
}

export function PublicReceiptPage({ token }: PublicReceiptPageProps) {
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Receipt | Pharma Care';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(robots);
    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    document.head.appendChild(referrer);
    return () => {
      robots.remove();
      referrer.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (!token || !supabase) {
      setReceipt(null);
      setLoading(false);
      return () => { active = false; };
    }
    void supabase.functions.invoke('get-public-receipt', { body: { token } })
      .then(({ data, error }) => {
        if (error) throw error;
        const parsed = parsePublicReceipt(data);
        if (active) setReceipt(parsed);
      })
      .catch(() => {
        if (active) setReceipt(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  return (
    <main className="min-h-screen bg-surface px-3 py-6 text-text sm:px-6 sm:py-10">
      <div className="mx-auto max-w-xl">
        {loading ? (
          <section role="status" className="rounded-card border border-border bg-white p-8 text-center shadow-xs">
            <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted">Loading receipt…</p>
          </section>
        ) : !receipt ? (
          <section role="alert" className="rounded-card border border-border bg-white p-8 text-center shadow-xs">
            <AlertCircle className="mx-auto h-7 w-7 text-muted" />
            <h1 className="mt-3 text-lg font-bold">Receipt unavailable</h1>
            <p className="mt-2 text-sm text-muted">This receipt link is invalid, expired, or no longer available.</p>
          </section>
        ) : (
          <article className="overflow-hidden rounded-card border border-border bg-white shadow-xs">
            <header className="border-b border-border bg-surface p-5 text-center sm:p-7">
              <h1 className="text-xl font-black text-text">{receipt.shop.name}</h1>
              {receipt.shop.address && <p className="mt-1 text-sm text-muted">{receipt.shop.address}</p>}
              {receipt.shop.phone && <p className="text-sm text-muted">{receipt.shop.phone}</p>}
              <p className="mt-4 text-xs font-bold uppercase tracking-wide text-muted">Receipt</p>
              <p className="mt-1 text-base font-bold text-text">{receipt.invoiceNumber}</p>
              <p className="mt-1 text-xs text-muted">{new Date(receipt.dateTime).toLocaleString()}</p>
            </header>
            <section className="divide-y divide-border px-4 sm:px-6" aria-label="Receipt items">
              {receipt.items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-text">{item.name}</p>
                      <p className="mt-1 text-xs text-muted">
                        {item.quantity} {item.unit} × {formatMoney(item.pricePaisa)}
                      </p>
                      {item.batchDetails.length > 0 && (
                        <div className="mt-2 space-y-1" aria-label="Batch and expiry details">
                          {item.batchDetails.map((batch, batchIndex) => (
                            <div
                              key={`${batch.batchNumber}-${batch.expiryDate}-${batchIndex}`}
                              className="grid min-w-0 grid-cols-2 gap-2 rounded-control bg-surface px-2 py-1 text-[11px] leading-relaxed text-muted"
                            >
                              <span className="min-w-0 break-words"><strong className="text-text">Batch No.:</strong> {batch.batchNumber}</span>
                              <span className="min-w-0 break-words"><strong className="text-text">Expiry:</strong> {batch.expiryDate}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="mt-1 text-[11px] font-medium text-muted">
                        {item.returnStatus === 'returned'
                          ? 'Returned'
                          : item.returnStatus === 'partially_returned'
                            ? 'Partially returned'
                            : 'Not returned'}
                      </p>
                    </div>
                    <strong className="shrink-0 text-sm text-text">{formatMoney(item.lineTotalPaisa)}</strong>
                  </div>
                </div>
              ))}
            </section>
            <section className="space-y-2 border-t border-border bg-surface px-4 py-4 text-sm sm:px-6">
              <div className="flex justify-between gap-4"><span className="text-muted">Discount</span><span>{formatMoney(receipt.discountPaisa)}</span></div>
              <div className="flex justify-between gap-4 text-base font-bold"><span>Total</span><span>{formatMoney(receipt.totalPaisa)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted">Paid</span><span>{formatMoney(receipt.paidPaisa)}</span></div>
              {receipt.changePaisa > 0 && <div className="flex justify-between gap-4"><span className="text-muted">Change</span><span>{formatMoney(receipt.changePaisa)}</span></div>}
              {receipt.creditDuePaisa !== null && (
                <div className="flex justify-between gap-4 font-semibold"><span>Bill credit balance</span><span>{formatMoney(receipt.creditDuePaisa)}</span></div>
              )}
              <p className="pt-1 text-right text-xs font-semibold text-muted">{receipt.status.replaceAll('_', ' ')}</p>
              {receipt.creditDuePaisa !== null && (
                <p className="text-[11px] leading-relaxed text-muted">
                  This balance includes entries recorded against this bill. Later customer-account payments are not allocated to individual bills.
                </p>
              )}
            </section>
          </article>
        )}
      </div>
    </main>
  );
}
