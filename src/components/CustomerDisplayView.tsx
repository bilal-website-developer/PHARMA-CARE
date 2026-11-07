import { useEffect, useRef, useState, type CSSProperties } from 'react';
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

const FALLING_CAPSULES = Array.from({ length: 16 }, (_, index) => ({
  left: `${(index * 37 + 7) % 100}%`,
  delay: `${(index * 29 % 41) / 10}s`,
  duration: `${4 + (index * 17 % 21) / 10}s`,
}));
const BURST_CAPSULES = Array.from({ length: 14 }, (_, index) => {
  const radians = (index * 360 * Math.PI) / (14 * 180);
  return {
    x: `${Math.cos(radians) * 24}em`,
    y: `${Math.sin(radians) * 24}em`,
    delay: `${(index * 45) / 1400}s`,
  };
});

export function CustomerDisplayView() {
  const channelId = new URLSearchParams(window.location.search).get('channel');
  const [message, setMessage] = useState<CustomerDisplayMessage | null>(null);
  const [error, setError] = useState('');
  const [shopLogo, setShopLogo] = useState(readShopLogo);
  const [itemViewportHeight, setItemViewportHeight] = useState(0);
  const [displayPage, setDisplayPage] = useState(0);
  const [motionAllowed, setMotionAllowed] = useState(() =>
    typeof window !== 'undefined'
      && document.documentElement.dataset.animations !== 'off'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [showThankYouBurst, setShowThankYouBurst] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const itemViewportRef = useRef<HTMLDivElement>(null);
  const isThankYou = message?.type === 'thank_you';

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => {
      setMotionAllowed(root.dataset.animations !== 'off' && !mediaQuery.matches);
    };
    const preferenceObserver = new MutationObserver(updateMotionPreference);
    preferenceObserver.observe(root, { attributes: true, attributeFilter: ['data-animations'] });
    mediaQuery.addEventListener('change', updateMotionPreference);
    updateMotionPreference();
    return () => {
      preferenceObserver.disconnect();
      mediaQuery.removeEventListener('change', updateMotionPreference);
    };
  }, []);

  useEffect(() => {
    if (!isThankYou || !motionAllowed) {
      setShowThankYouBurst(false);
      return;
    }
    setShowThankYouBurst(true);
    const timer = window.setTimeout(() => setShowThankYouBurst(false), 2300);
    return () => window.clearTimeout(timer);
  }, [isThankYou, motionAllowed]);

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
    <main className={`customer-display-shell relative h-[100dvh] min-h-0 overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-green-100 px-3 py-2 text-emerald-950 sm:px-6 sm:py-3 lg:px-10 ${motionAllowed ? 'customer-display-motion-on' : ''}`}>
      <style>{`
        .customer-display-shell { --display-ink: #12382a; --display-green: #0f6b3e; --display-mint: #d9f7e8; --display-border: #cfe9da; }
        .customer-display-title { color: var(--display-ink); }
        .customer-display-muted { color: #426b58; }
        .customer-display-card { border: 1px solid var(--display-border); background: rgba(255,255,255,.95); box-shadow: 0 12px 32px rgba(15,107,62,.08); }
        .customer-display-header-cell { background: var(--display-mint); color: var(--display-green); }
        .customer-display-motion-on .customer-display-enter { animation: customer-display-clean-enter 420ms cubic-bezier(.2,.75,.25,1) both; }
        .customer-display-motion-on .customer-display-row { animation: customer-display-clean-enter 400ms ease-out both; }
        .customer-display-motion-on .customer-display-row:nth-child(2) { animation-delay: .15s; }
        .customer-display-motion-on .customer-display-row:nth-child(3) { animation-delay: .3s; }
        .customer-display-motion-on .customer-display-row:nth-child(4) { animation-delay: .45s; }
        .customer-display-motion-on .customer-display-row:nth-child(5) { animation-delay: .6s; }
        .customer-display-motion-on .customer-display-welcome-chip { animation: customer-display-clean-enter 420ms ease-out both; }
        .customer-display-live-dot { position: relative; }
        .customer-display-motion-on .customer-display-live-dot::after { position: absolute; inset: -3px; border: 1px solid #16a34a; border-radius: 9999px; content: ''; animation: customer-display-live-pulse 1.8s ease-out infinite; }
        .customer-display-motion-on .customer-display-capsule { animation: customer-display-pill-fall var(--pill-duration) linear var(--pill-delay) infinite; }
        .customer-display-motion-on .customer-display-burst-capsule { animation: customer-display-pill-burst 1.8s cubic-bezier(.2,.65,.3,1) var(--burst-delay) both; }
        .customer-display-pill { width: 2.6em; height: 1.1em; border-radius: 9999px; background: linear-gradient(90deg,#0f6b3e 0 50%,#bbf7d0 50% 100%); box-shadow: inset 0 1px 3px rgba(255,255,255,.48), inset 0 -2px 4px rgba(2,44,34,.2), 0 4px 10px rgba(2,44,34,.12); }
        .customer-display-motion-on .customer-display-wave-letter { display: inline-block; animation: customer-display-wave 1.6s ease-in-out infinite; animation-delay: calc(var(--letter-index) * .1s); }
        @keyframes customer-display-clean-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes customer-display-live-pulse { 0% { transform: scale(.8); opacity: .8; } 100% { transform: scale(1.9); opacity: 0; } }
        @keyframes customer-display-pill-fall { from { transform: translateY(-15vh) rotate(-12deg); } to { transform: translateY(115vh) rotate(18deg); } }
        @keyframes customer-display-pill-burst { 0% { opacity: .95; transform: translate(-50%,-50%) scale(.3) rotate(0deg); } 100% { opacity: 0; transform: translate(calc(-50% + var(--burst-x)),calc(-50% + var(--burst-y))) scale(1) rotate(540deg); } }
        @keyframes customer-display-wave { 0%,65%,100% { transform: translateY(0); } 32% { transform: translateY(-.25em); } }
        @media (prefers-reduced-motion: reduce) {
          .customer-display-motion-on .customer-display-enter,
          .customer-display-motion-on .customer-display-row,
          .customer-display-motion-on .customer-display-welcome-chip,
          .customer-display-motion-on .customer-display-live-dot::after,
          .customer-display-motion-on .customer-display-capsule,
          .customer-display-motion-on .customer-display-burst-capsule,
          .customer-display-motion-on .customer-display-wave-letter { animation: none !important; }
        }
      `}</style>
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-emerald-200/40 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 -left-24 h-96 w-96 rounded-full bg-teal-100/70 blur-3xl" />
      {isThankYou && motionAllowed && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          {FALLING_CAPSULES.map((capsule, index) => (
            <span
              key={`rain-${index}`}
              className="customer-display-pill customer-display-capsule absolute -top-[15vh] block text-base"
              style={{
                left: capsule.left,
                '--pill-delay': capsule.delay,
                '--pill-duration': capsule.duration,
              } as CSSProperties}
            />
          ))}
          {showThankYouBurst && BURST_CAPSULES.map((capsule, index) => (
            <span
              key={`burst-${index}`}
              className="customer-display-pill customer-display-burst-capsule absolute left-1/2 top-[18%] block text-base"
              style={{
                '--burst-x': capsule.x,
                '--burst-y': capsule.y,
                '--burst-delay': capsule.delay,
              } as CSSProperties}
            />
          ))}
        </div>
      )}
      <div className="relative z-10 mx-auto flex h-full min-h-0 max-w-5xl flex-col">
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-emerald-200/80 pb-2 sm:min-h-14 sm:pb-3">
          <div className="flex min-w-0 items-center">
            {shopLogo ? (
              <img src={shopLogo} alt="Shop logo" className="h-9 max-w-40 object-contain sm:h-10" />
            ) : (
              <PharmaLogo size={14} layout="inline" animated={false} className="customer-display-logo" />
            )}
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#cfe9da] bg-white px-3 py-1.5 text-xs font-bold text-[#0f6b3e] shadow-sm sm:px-4 sm:text-sm">
            <span className="customer-display-live-dot h-2 w-2 rounded-full bg-[#16a34a]" /> Live
          </span>
        </header>

        {error ? (
          <section role="alert" className="customer-display-card customer-display-enter mx-auto my-auto w-full max-w-2xl rounded-3xl p-6 text-center sm:p-10">
            <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#d9f7e8] text-2xl font-black text-[#0f6b3e]">!</span>
            <h1 className="customer-display-title mt-4 text-2xl font-bold sm:text-3xl">Customer display unavailable</h1>
            <p className="customer-display-muted mx-auto mt-2 max-w-lg text-sm leading-relaxed sm:text-base">{error}</p>
          </section>
        ) : message?.type === 'thank_you' ? (
          <section aria-live="polite" className="flex flex-1 flex-col items-center justify-center py-12 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#d9f7e8] text-[#0f6b3e] shadow-inner sm:h-32 sm:w-32">
              <CheckCircle2 className="h-14 w-14 sm:h-20 sm:w-20" strokeWidth={1.7} />
            </span>
            <p className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-[#0f6b3e] shadow-sm">
              <Heart size={16} /> Pharma Care
            </p>
            <h1 className="customer-display-title mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              {Array.from('Thank you').map((letter, index) => motionAllowed ? (
                <span key={`${letter}-${index}`} className="customer-display-wave-letter" style={{ '--letter-index': index } as CSSProperties}>{letter === ' ' ? '\u00a0' : letter}</span>
              ) : letter)}
            </h1>
            <p className="customer-display-muted mt-3 max-w-xl text-base font-medium sm:text-lg">We appreciate your visit. Take care and feel well.</p>
          </section>
        ) : message?.type === 'options' ? (
          <section aria-live="polite" className="customer-display-enter flex-1 py-5 sm:py-7">
            <div className="customer-display-card rounded-3xl p-4 sm:p-6">
            <p className="customer-display-muted text-sm font-semibold">Other choices for {message.currentProductName}{message.strength ? ` · ${message.strength}` : ''}</p>
            <h1 className="customer-display-title mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Also available</h1>
            {message.options.length > 0 ? (
              <div className="mt-4 grid gap-2 sm:mt-5 sm:grid-cols-2 lg:grid-cols-3">
                {message.options.map((option, index) => (
                  <button
                    key={`${option.brandName}-${option.company}-${index}`}
                    type="button"
                    onClick={() => chooseOption(index)}
                    aria-label={`Choose ${option.brandName}, ${option.company}, ${formatPaisa(option.unitPricePaisa)} per ${option.unitName}`}
                    className="customer-display-card rounded-xl p-3 text-left shadow-sm transition hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 sm:p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-bold text-[#12382a] sm:text-lg">{option.brandName}</h2>
                        <p className="customer-display-muted mt-0.5 truncate text-sm font-medium">{option.company}</p>
                        <p className="mt-1 text-xs font-medium text-slate-700 sm:text-sm">
                          {[option.strength, option.unitName].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <p className="shrink-0 rounded-lg bg-[#d9f7e8] px-2.5 py-1.5 text-sm font-bold tabular-nums text-[#0f6b3e] sm:text-base">
                        {formatPaisa(option.unitPricePaisa)}
                      </p>
                    </div>
                    <span className="mt-2 block text-xs font-semibold text-[#0f6b3e]">Tap to choose</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="customer-display-card customer-display-muted mt-4 rounded-xl p-4 text-sm font-semibold sm:text-base">
                No other in-stock options are available right now.
              </p>
            )}
            </div>
          </section>
        ) : !snapshot || (snapshot.stage === 'welcome' && snapshot.items.length === 0) ? (
          <section aria-live="polite" className="customer-display-enter flex flex-1 flex-col items-center justify-center py-12 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-[2rem] bg-[#d9f7e8] text-[#0f6b3e] shadow-inner sm:h-32 sm:w-32">
              <Sparkles className="h-12 w-12 sm:h-16 sm:w-16" strokeWidth={1.7} />
            </span>
            <h1 className="customer-display-title mt-5 text-4xl font-bold tracking-tight sm:text-6xl">Welcome</h1>
            <p className="customer-display-muted mt-2 max-w-xl text-base font-medium leading-relaxed sm:text-lg">Your order details will appear here as we prepare them.</p>
            <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row sm:flex-wrap">
              {['🛡️ Genuine medicines', '📅 Expiry checked', '💚 Friendly service'].map((label, index) => (
                <span key={label} className="customer-display-card customer-display-welcome-chip rounded-full px-4 py-2 text-sm font-semibold text-[#12382a]" style={{ animationDelay: `${index * 100}ms` }}>{label}</span>
              ))}
            </div>
          </section>
        ) : (
          <section aria-live="polite" className="customer-display-enter flex min-h-0 flex-1 flex-col py-1.5 sm:py-2">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
              <h1 className="customer-display-title text-lg font-bold tracking-tight sm:text-xl">
                {snapshot.stage === 'payment' ? 'Payment details' : 'Current order'}
              </h1>
              <span className="customer-display-muted text-xs font-medium sm:text-sm">
                {snapshot.items.length} {snapshot.items.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_19rem] lg:grid-rows-1">
              <div className="customer-display-card flex min-h-0 flex-col overflow-hidden rounded-2xl">
                <div aria-hidden="true" className="customer-display-header-cell grid shrink-0 grid-cols-[minmax(0,3fr)_0.6fr_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] items-center gap-2 border-b border-[#cfe9da] px-3 py-2 text-[9px] font-bold uppercase tracking-[.12em] sm:px-5 sm:text-[10px]">
                  <span>Medicine</span><span className="text-right">Qty</span><span>Batch</span><span>Expiry</span><span className="text-right">Amount</span>
                </div>
                <div ref={itemViewportRef} className="min-h-0 flex-1 overflow-hidden">
                  <ul aria-label="Items in this bill" className="divide-y divide-[#cfe9da]">
                    {pageItems.map((item, index) => (
                      <li key={`${item.productName}-${item.unitName}-${index}`} className={`customer-display-row customer-display-row-${displayLayout.density} grid grid-cols-[minmax(0,3fr)_0.6fr_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] items-center gap-2 px-3 sm:px-5`}>
                        <div className="min-w-0">
                          <p className="truncate font-bold text-[#12382a]">{item.productName}</p>
                          <p className="customer-display-muted truncate text-[10px] sm:text-xs">{item.unitName} · {formatPaisa(item.unitPricePaisa)} each</p>
                        </div>
                        <p className="text-right font-bold tabular-nums text-[#12382a]">{item.quantity}</p>
                        <p className="customer-display-muted truncate text-[10px] sm:text-xs" title={item.batchNumber}>{item.batchNumber || '—'}</p>
                        <p className="customer-display-muted truncate text-[10px] sm:text-xs" title={item.expiryDate}>{item.expiryDate || '—'}</p>
                        <p className="text-right font-bold tabular-nums text-[#12382a]">{formatPaisa(item.lineTotalPaisa)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
                {pageCount > 1 && (
                  <p aria-live="polite" className="shrink-0 border-t border-[#cfe9da] px-3 py-1 text-center text-[10px] font-medium text-[#0f6b3e]">
                    Showing items {displayPage * displayLayout.pageSize + 1}–{Math.min((displayPage + 1) * displayLayout.pageSize, snapshot.items.length)} of {snapshot.items.length} · updates automatically
                  </p>
                )}
              </div>

              <aside aria-label="Bill summary" className="customer-display-card flex shrink-0 flex-col justify-between rounded-2xl p-4 lg:sticky lg:top-2 lg:self-start">
                <div>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3"><dt className="customer-display-muted">Subtotal</dt><dd className="font-semibold tabular-nums text-[#12382a]">{formatPaisa(snapshot.subtotalPaisa)}</dd></div>
                    {snapshot.discountPaisa > 0 && (
                      <div className="flex justify-between gap-3"><dt className="customer-display-muted">Discount</dt><dd className="font-semibold tabular-nums text-[#12382a]">−{formatPaisa(snapshot.discountPaisa)}</dd></div>
                    )}
                  </dl>
                  <div className="mt-3 border-t border-[#cfe9da] pt-3">
                    <p className="text-3xl font-extrabold tabular-nums tracking-tight text-[#0f6b3e] sm:text-[2.5rem]">{formatPaisa(snapshot.totalPaisa)}</p>
                    <p className="customer-display-muted mt-0.5 text-xs font-semibold">Total · {snapshot.items.length} {snapshot.items.length === 1 ? 'item' : 'items'}</p>
                  </div>
                </div>
                <div className="mt-3 border-t border-[#cfe9da] pt-3">
                  {snapshot.payment.method === 'CREDIT' ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl bg-[#d9f7e8] px-3 py-2 text-sm">
                      <span className="font-semibold text-[#0f6b3e]">Due for this bill</span>
                      <span className="font-bold tabular-nums text-[#12382a]">{formatPaisa(snapshot.payment.balanceDuePaisa)}</span>
                    </div>
                  ) : (
                    <dl className="grid grid-cols-3 gap-2 text-[10px] sm:text-xs">
                      <div><dt className="customer-display-muted">Paid</dt><dd className="mt-0.5 truncate font-bold tabular-nums text-[#12382a]">{formatPaisa(snapshot.payment.paidPaisa)}</dd></div>
                      <div><dt className="customer-display-muted">This bill due</dt><dd className="mt-0.5 truncate font-bold tabular-nums text-[#12382a]">{formatPaisa(snapshot.payment.balanceDuePaisa)}</dd></div>
                      <div><dt className="customer-display-muted">Change</dt><dd className="mt-0.5 truncate font-bold tabular-nums text-[#12382a]">{formatPaisa(snapshot.payment.changePaisa)}</dd></div>
                    </dl>
                  )}
                </div>
              </aside>
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
