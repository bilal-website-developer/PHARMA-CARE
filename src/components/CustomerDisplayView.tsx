import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Heart, Sparkles } from 'lucide-react';
import PharmaLogo from './PharmaLogo';
import { readShopLogo, SHOP_LOGO_EVENT } from '../utils/storeSettings';
import {
  getCustomerDisplayPageSize,
  isCustomerDisplayChannelId,
  parseCustomerDisplayMessage,
  type CustomerDisplayMessage,
} from '../utils/customerDisplay';

function formatPaisa(value: number): string {
  return `Rs. ${(value / 100).toFixed(2)}`;
}

export function CustomerDisplayView() {
  const channelId = new URLSearchParams(window.location.search).get('channel');
  const [message, setMessage] = useState<CustomerDisplayMessage | null>(null);
  const [error, setError] = useState('');
  const [shopLogo, setShopLogo] = useState(readShopLogo);
  const [itemViewportHeight, setItemViewportHeight] = useState(0);
  const [displayPage, setDisplayPage] = useState(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const itemViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleLogoChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ logoUrl?: string }>;
      setShopLogo(customEvent.detail?.logoUrl ?? readShopLogo());
    };
    window.addEventListener(SHOP_LOGO_EVENT, handleLogoChange);
    return () => window.removeEventListener(SHOP_LOGO_EVENT, handleLogoChange);
  }, []);

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
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<unknown>) => {
      const nextMessage = parseCustomerDisplayMessage(event.data);
      if (!nextMessage || nextMessage.type === 'ready') return;
      if (nextMessage.type === 'closed') {
        setMessage(null);
      } else {
        setMessage(nextMessage);
      }
      if (nextMessage.type !== 'closed') {
        setError('');
      }
    };
    channel.postMessage({ type: 'ready' });

    return () => {
      channel.postMessage({ type: 'closed' });
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [channelId]);

  const snapshot = message?.type === 'snapshot' ? message : null;
  const displayLayout = getCustomerDisplayPageSize(itemViewportHeight, snapshot?.items.length ?? 0);
  const pageCount = snapshot ? Math.max(1, Math.ceil(snapshot.items.length / displayLayout.pageSize)) : 1;
  const pageItems = snapshot?.items.slice(
    displayPage * displayLayout.pageSize,
    (displayPage + 1) * displayLayout.pageSize,
  ) ?? [];

  useEffect(() => {
    const viewport = itemViewportRef.current;
    if (!viewport || !snapshot || snapshot.stage === 'welcome') return;
    const measure = () => setItemViewportHeight(viewport.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [snapshot?.stage, snapshot?.items.length]);

  useEffect(() => {
    setDisplayPage(0);
  }, [snapshot?.items.length, snapshot?.totalPaisa]);

  useEffect(() => {
    if (pageCount <= 1 || message?.type !== 'snapshot') return;
    const timer = window.setInterval(() => {
      setDisplayPage((page) => (page + 1) % pageCount);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [message?.type, message?.type === 'snapshot' ? message.stage : null, pageCount]);

  const chooseOption = (optionIndex: number) => {
    channelRef.current?.postMessage({ type: 'option_selected', optionIndex });
  };

  return (
    <main className="customer-display-shell relative h-[100dvh] min-h-0 overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-green-100 px-3 py-2 text-emerald-950 sm:px-6 sm:py-3 lg:px-10">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-emerald-200/40 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 -left-24 h-96 w-96 rounded-full bg-teal-100/70 blur-3xl" />
      <div className="relative mx-auto flex h-full min-h-0 max-w-5xl flex-col">
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-emerald-200/80 pb-2 sm:min-h-14 sm:pb-3">
          <div className="flex min-w-0 items-center">
            {shopLogo ? (
              <img src={shopLogo} alt="Shop logo" className="h-9 max-w-40 object-contain sm:h-10" />
            ) : (
              <PharmaLogo size={14} layout="inline" animated={false} className="customer-display-logo" />
            )}
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm sm:px-4 sm:text-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Live
          </span>
        </header>

        {error ? (
          <p role="alert" className="customer-display-enter mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-lg font-semibold text-red-800">
            {error}
          </p>
        ) : message?.type === 'thank_you' ? (
          <section aria-live="polite" className="customer-display-enter flex flex-1 flex-col items-center justify-center py-12 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shadow-inner sm:h-32 sm:w-32">
              <CheckCircle2 className="h-14 w-14 sm:h-20 sm:w-20" strokeWidth={1.7} />
            </span>
            <p className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-bold text-emerald-800 shadow-sm">
              <Heart size={16} /> Pharma Care
            </p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-emerald-950 sm:text-4xl">Thank you</h1>
            <p className="mt-2 max-w-xl text-base font-medium text-emerald-800 sm:text-lg">We appreciate your visit. Take care and feel well.</p>
          </section>
        ) : message?.type === 'options' ? (
          <section aria-live="polite" className="customer-display-enter flex-1 py-5 sm:py-7">
            <p className="text-sm font-semibold text-emerald-700">Other choices for {message.currentProductName}{message.strength ? ` · ${message.strength}` : ''}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-emerald-950 sm:text-3xl">Also available</h1>
            {message.options.length > 0 ? (
              <div className="mt-4 grid gap-2 sm:mt-5 sm:grid-cols-2 lg:grid-cols-3">
                {message.options.map((option, index) => (
                  <button
                    key={`${option.brandName}-${option.company}-${index}`}
                    type="button"
                    onClick={() => chooseOption(index)}
                    aria-label={`Choose ${option.brandName}, ${option.company}, ${formatPaisa(option.unitPricePaisa)} per ${option.unitName}`}
                    className="rounded-xl border border-emerald-100 bg-white/90 p-3 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 sm:p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-bold text-emerald-950 sm:text-lg">{option.brandName}</h2>
                        <p className="mt-0.5 truncate text-sm font-medium text-emerald-800">{option.company}</p>
                        <p className="mt-1 text-xs font-medium text-slate-600 sm:text-sm">
                          {[option.strength, option.unitName].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <p className="shrink-0 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-sm font-bold tabular-nums text-emerald-900 sm:text-base">
                        {formatPaisa(option.unitPricePaisa)}
                      </p>
                    </div>
                    <span className="mt-2 block text-xs font-semibold text-emerald-700">Tap to choose</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-emerald-100 bg-white/80 p-4 text-sm font-semibold text-emerald-800 sm:text-base">
                No other in-stock options are available right now.
              </p>
            )}
          </section>
        ) : !snapshot || (snapshot.stage === 'welcome' && snapshot.items.length === 0) ? (
          <section aria-live="polite" className="customer-display-enter flex flex-1 flex-col items-center justify-center py-12 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-[2rem] bg-emerald-100 text-emerald-700 shadow-inner sm:h-32 sm:w-32">
              <Sparkles className="h-12 w-12 sm:h-16 sm:w-16" strokeWidth={1.7} />
            </span>
            <h1 className="mt-5 text-3xl font-bold tracking-tight text-emerald-950 sm:text-4xl">Welcome</h1>
            <p className="mt-2 max-w-xl text-base font-medium leading-relaxed text-emerald-800 sm:text-lg">Your order details will appear here as we prepare them.</p>
          </section>
        ) : (
          <section aria-live="polite" className="customer-display-enter flex min-h-0 flex-1 flex-col py-1.5 sm:py-2">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
              <h1 className="text-lg font-bold tracking-tight text-emerald-950 sm:text-xl">
                {snapshot.stage === 'payment' ? 'Payment details' : 'Current order'}
              </h1>
              <span className="text-xs font-medium text-emerald-700 sm:text-sm">
                {snapshot.items.length} {snapshot.items.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-emerald-100 bg-white/90 shadow-md shadow-emerald-950/5">
              <div aria-hidden="true" className="grid shrink-0 grid-cols-[minmax(0,2fr)_0.55fr_minmax(0,1fr)_minmax(0,0.9fr)_auto] items-center gap-2 border-b border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800 sm:px-5 sm:text-[10px]">
                <span>Medicine</span><span className="text-center">Qty</span><span>Batch</span><span>Expiry</span><span className="text-right">Amount</span>
              </div>
              <div ref={itemViewportRef} className="min-h-0 flex-1 overflow-hidden">
                <ul aria-label="Items in this bill" className="divide-y divide-emerald-100/80">
                {pageItems.map((item, index) => (
                  <li key={`${item.productName}-${item.unitName}-${index}`} className={`customer-display-row customer-display-row-${displayLayout.density} grid grid-cols-[minmax(0,2fr)_0.55fr_minmax(0,1fr)_minmax(0,0.9fr)_auto] items-center gap-2 px-3 sm:px-5`}>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-emerald-950">{item.productName}</p>
                      <p className="truncate text-emerald-700/80">{item.unitName} · {formatPaisa(item.unitPricePaisa)} each</p>
                    </div>
                    <p className="text-center font-semibold tabular-nums text-emerald-950">{item.quantity}</p>
                    <p className="truncate text-[10px] text-emerald-800 sm:text-xs" title={item.batchNumber}>{item.batchNumber || '—'}</p>
                    <p className="truncate text-[10px] text-emerald-800 sm:text-xs" title={item.expiryDate}>{item.expiryDate || '—'}</p>
                    <p className="text-right font-bold tabular-nums text-emerald-950">{formatPaisa(item.lineTotalPaisa)}</p>
                  </li>
                ))}
                </ul>
              </div>
              {pageCount > 1 && (
                <p aria-live="polite" className="shrink-0 border-t border-emerald-100 px-3 py-1 text-center text-[10px] font-medium text-emerald-700">
                  Showing items {displayPage * displayLayout.pageSize + 1}–{Math.min((displayPage + 1) * displayLayout.pageSize, snapshot.items.length)} of {snapshot.items.length} · updates automatically
                </p>
              )}

              <div className="grid shrink-0 gap-2 border-t border-emerald-100 bg-emerald-50/50 p-2.5 sm:grid-cols-2 sm:px-4 sm:py-3">
                <dl className="space-y-1.5 text-xs sm:text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-emerald-800">Subtotal</dt>
                    <dd className="font-medium tabular-nums text-emerald-950">{formatPaisa(snapshot.subtotalPaisa)}</dd>
                  </div>
                  {snapshot.discountPaisa > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-emerald-800">Discount</dt>
                      <dd className="font-medium tabular-nums text-emerald-950">−{formatPaisa(snapshot.discountPaisa)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3 border-t border-emerald-200 pt-2 text-sm font-bold">
                    <dt className="text-emerald-950">Total</dt>
                    <dd className="tabular-nums text-emerald-950">{formatPaisa(snapshot.totalPaisa)}</dd>
                  </div>
                </dl>

                {snapshot.payment.method === 'CREDIT' ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm">
                    <span className="font-medium text-emerald-800">Due for this bill</span>
                    <span className="font-bold tabular-nums text-emerald-950">{formatPaisa(snapshot.payment.balanceDuePaisa)}</span>
                  </div>
                ) : (
                  <dl className="grid grid-cols-3 gap-2 rounded-xl bg-white px-3 py-2 text-[11px] sm:text-xs">
                    <div><dt className="text-emerald-700">Paid</dt><dd className="mt-0.5 font-semibold tabular-nums text-emerald-950">{formatPaisa(snapshot.payment.paidPaisa)}</dd></div>
                    <div><dt className="text-emerald-700">This bill due</dt><dd className="mt-0.5 font-semibold tabular-nums text-emerald-950">{formatPaisa(snapshot.payment.balanceDuePaisa)}</dd></div>
                    <div><dt className="text-emerald-700">Change</dt><dd className="mt-0.5 font-semibold tabular-nums text-emerald-950">{formatPaisa(snapshot.payment.changePaisa)}</dd></div>
                  </dl>
                )}
              </div>
            </div>
          </section>
        )}

        <footer className="shrink-0 border-t border-emerald-200/80 pt-1.5 text-center text-[10px] font-medium text-emerald-700/80 sm:text-xs">
          Pharma Care · Thank you for visiting
        </footer>
      </div>
    </main>
  );
}
