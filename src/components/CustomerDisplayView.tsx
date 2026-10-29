import { useEffect, useState } from 'react';
import {
  isCustomerDisplayChannelId,
  parseCustomerDisplayMessage,
  type CustomerDisplaySnapshot,
} from '../utils/customerDisplay';

function formatPaisa(value: number): string {
  return `Rs. ${(value / 100).toFixed(2)}`;
}

export function CustomerDisplayView() {
  const channelId = new URLSearchParams(window.location.search).get('channel');
  const [snapshot, setSnapshot] = useState<CustomerDisplaySnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isCustomerDisplayChannelId(channelId)) {
      setError('This customer display link is invalid. Open the display from POS Billing.');
      return;
    }
    if (typeof BroadcastChannel === 'undefined') {
      setError('This browser does not support live customer display.');
      return;
    }

    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(`pharma-care.customer-display.${channelId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the customer display.');
      return;
    }

    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseCustomerDisplayMessage(event.data);
      if (!message) return;
      if (message.type === 'snapshot') {
        setSnapshot(message);
        setError('');
      } else if (message.type === 'closed') {
        setSnapshot(null);
      }
    };
    channel.postMessage({ type: 'ready' });

    return () => channel.close();
  }, [channelId]);

  return (
    <main className="min-h-screen bg-white px-6 py-8 text-slate-950 sm:px-12 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col">
        <header className="border-b-2 border-slate-200 pb-5">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-700">Pharma Care</p>
          <h1 className="mt-2 text-3xl font-black sm:text-5xl">Your order</h1>
        </header>

        {error ? (
          <p role="alert" className="mt-8 rounded-xl border border-red-200 bg-red-50 p-5 text-lg font-semibold text-red-800">
            {error}
          </p>
        ) : snapshot === null ? (
          <div className="flex flex-1 items-center justify-center py-12 text-center">
            <p aria-live="polite" className="text-xl font-semibold text-slate-500 sm:text-3xl">
              Waiting for POS Billing…
            </p>
          </div>
        ) : snapshot.items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-12 text-center">
            <p aria-live="polite" className="text-xl font-semibold text-slate-500 sm:text-3xl">
              Your items will appear here.
            </p>
          </div>
        ) : (
          <div className="mt-6 flex-1">
            <div aria-live="polite" className="overflow-x-auto">
              <table className="w-full text-left text-lg sm:text-2xl">
                <thead className="border-b border-slate-200 text-sm uppercase tracking-wide text-slate-500 sm:text-base">
                  <tr>
                    <th className="py-3 pr-4">Item</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="py-3 pl-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshot.items.map((item, index) => (
                    <tr key={`${item.productName}-${item.unitName}-${index}`}>
                      <td className="py-4 pr-4 font-bold">
                        {item.productName}
                        <span className="block text-sm font-medium text-slate-500 sm:text-lg">{item.unitName}</span>
                      </td>
                      <td className="px-4 py-4 text-right">{item.quantity}</td>
                      <td className="px-4 py-4 text-right">{formatPaisa(item.unitPricePaisa)}</td>
                      <td className="py-4 pl-4 text-right font-bold">{formatPaisa(item.lineTotalPaisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="ml-auto mt-8 max-w-xl space-y-3 border-t-2 border-slate-200 pt-5 text-lg sm:text-2xl">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Subtotal</dt>
                <dd className="font-semibold">{formatPaisa(snapshot.subtotalPaisa)}</dd>
              </div>
              {snapshot.discountPaisa > 0 && (
                <div className="flex justify-between gap-4 text-emerald-800">
                  <dt>Discount</dt>
                  <dd className="font-semibold">−{formatPaisa(snapshot.discountPaisa)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4 border-t border-slate-200 pt-4 text-2xl font-black sm:text-4xl">
                <dt>Total</dt>
                <dd>{formatPaisa(snapshot.totalPaisa)}</dd>
              </div>
            </dl>
          </div>
        )}

        <footer className="mt-8 border-t border-slate-200 pt-4 text-center text-xs text-slate-400 sm:text-sm">
          Thank you for visiting.
        </footer>
      </div>
    </main>
  );
}
