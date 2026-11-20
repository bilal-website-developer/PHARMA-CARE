import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import {
  buildWhatsAppUrl,
  formatExpiryMonth,
  formatReceiptDate,
  formatReceiptMoney,
  normalizeTelephoneNumber,
  PublicReceiptRequestError,
  readReceiptLanguage,
  requestPublicReceipt,
  receiptCode,
  saveReceiptLanguage,
  type ReceiptLanguage,
} from '../utils/publicReceipt';
import './PublicReceiptPage.css';

type ReceiptIconName = 'check' | 'download' | 'phone' | 'retry';
type PaymentMethod = 'CASH' | 'CARD' | 'EASYPAISA' | 'JAZZCASH' | 'CREDIT';
type ReturnStatus = 'pending' | 'partially_returned' | 'returned';

function ReceiptIcon({ name, size = 17 }: { name: ReceiptIconName; size?: number }) {
  const paths: Record<ReceiptIconName, string> = {
    check: 'M20 6 9 17l-5-5 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
    phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.8 2.1Z',
    retry: 'M20 7v5h-5 M4 17v-5h5 M5.6 9a7 7 0 0 1 11.6-2L20 12 M4 12l2.8 5a7 7 0 0 0 11.6-2',
  };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

interface PublicReceipt {
  shop: { name: string; address: string; phone: string; logoUrl: string | null };
  invoiceNumber: string;
  dateTime: string;
  itemsHidden: boolean;
  items: Array<{
    name: string;
    unit: string;
    quantity: number;
    pricePaisa: number;
    lineTotalPaisa: number;
    expiryMonths?: string[];
    returnStatus?: ReturnStatus;
  }>;
  discountPaisa: number;
  totalPaisa: number;
  paidPaisa: number;
  paymentMethods: Array<{ method: PaymentMethod; amountPaisa: number }>;
  changePaisa: number;
  creditDuePaisa: number | null;
  paymentStatus: 'paid' | 'partially_paid' | 'due';
}

type PageState = 'loading' | 'loaded' | 'unavailable' | 'retryable';

const translations = {
  en: {
    loading: 'Loading receipt…',
    unavailableTitle: 'Receipt unavailable',
    unavailable: 'This receipt link is not available. Please ask the shop.',
    retry: 'Try again',
    verified: 'Verified receipt',
    totalPaid: 'Total paid',
    paid: 'Paid',
    partiallyPaid: 'Partially paid',
    due: 'Due',
    receiptCode: 'Receipt code',
    viewItems: 'View items',
    hiddenItems: (count: number) => `${count} ${count === 1 ? 'item' : 'items'} hidden for privacy`,
    itemLoadError: 'Could not load item names. Please try again.',
    discount: 'Discount',
    total: 'Total',
    change: 'Change',
    payment: 'Paid',
    dueThisBill: 'Due for this bill',
    cash: 'Cash',
    card: 'Card',
    easypaisa: 'Easypaisa',
    jazzcash: 'JazzCash',
    credit: 'Credit',
    returned: 'Returned',
    partiallyReturned: 'Partially returned',
    returnPending: 'Return pending',
    expiry: 'Exp.',
    download: 'Download',
    callShop: 'Call shop',
    somethingWrong: 'Something wrong with this bill? Message us on WhatsApp.',
    thankYou: 'Thank you for shopping with us.',
    privateLink: 'This is a private link. Anyone with it can view this receipt.',
    messagePrefix: 'Hello, I have a question about receipt code',
    language: 'Language',
    itemsLabel: 'Receipt items',
    totalsLabel: 'Receipt totals',
    actionsLabel: 'Receipt actions',
  },
  ur: {
    loading: 'رسید لوڈ ہو رہی ہے…', // needs native-speaker review
    unavailableTitle: 'رسید دستیاب نہیں', // needs native-speaker review
    unavailable: 'یہ رسید کا لنک دستیاب نہیں۔ براہ کرم دکان سے رابطہ کریں۔', // needs native-speaker review
    retry: 'دوبارہ کوشش کریں', // needs native-speaker review
    verified: 'تصدیق شدہ رسید', // needs native-speaker review
    totalPaid: 'کل ادا شدہ', // needs native-speaker review
    paid: 'ادا شدہ', // needs native-speaker review
    partiallyPaid: 'جزوی ادائیگی', // needs native-speaker review
    due: 'بقایا', // needs native-speaker review
    receiptCode: 'رسید کوڈ', // needs native-speaker review
    viewItems: 'اشیاء دیکھیں', // needs native-speaker review
    hiddenItems: (count: number) => `${count} اشیاء رازداری کے لیے چھپائی گئی ہیں`, // needs native-speaker review
    itemLoadError: 'اشیاء کے نام لوڈ نہیں ہو سکے۔ دوبارہ کوشش کریں۔', // needs native-speaker review
    discount: 'رعایت', // needs native-speaker review
    total: 'کل', // needs native-speaker review
    change: 'واپس رقم', // needs native-speaker review
    payment: 'ادائیگی', // needs native-speaker review
    dueThisBill: 'اس رسید کا بقایا', // needs native-speaker review
    cash: 'نقد', // needs native-speaker review
    card: 'کارڈ', // needs native-speaker review
    easypaisa: 'ایزی پیسہ', // needs native-speaker review
    jazzcash: 'جاز کیش', // needs native-speaker review
    credit: 'ادھار', // needs native-speaker review
    returned: 'واپس شدہ', // needs native-speaker review
    partiallyReturned: 'جزوی طور پر واپس', // needs native-speaker review
    returnPending: 'واپسی زیر التوا', // needs native-speaker review
    expiry: 'میعاد', // needs native-speaker review
    download: 'ڈاؤن لوڈ', // needs native-speaker review
    callShop: 'دکان پر کال کریں', // needs native-speaker review
    somethingWrong: 'رسید میں کوئی مسئلہ ہے؟ ہمیں واٹس ایپ پر پیغام بھیجیں۔', // needs native-speaker review
    thankYou: 'خریداری کا شکریہ۔', // needs native-speaker review
    privateLink: 'یہ نجی لنک ہے۔ جس کے پاس یہ لنک ہو وہ رسید دیکھ سکتا ہے۔', // needs native-speaker review
    messagePrefix: 'السلام علیکم، رسید کوڈ کے بارے میں سوال ہے', // needs native-speaker review
    language: 'زبان', // needs native-speaker review
    itemsLabel: 'رسید کی اشیاء', // needs native-speaker review
    totalsLabel: 'رسید کا حساب', // needs native-speaker review
    actionsLabel: 'رسید کے اختیارات', // needs native-speaker review
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === 'CASH' || value === 'CARD' || value === 'EASYPAISA'
    || value === 'JAZZCASH' || value === 'CREDIT';
}

function isReturnStatus(value: unknown): value is ReturnStatus {
  return value === 'pending' || value === 'partially_returned' || value === 'returned';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((month) => isText(month) && /^\d{4}-(0[1-9]|1[0-2])$/.test(month));
}

function parsePublicReceipt(value: unknown): PublicReceipt {
  if (!isRecord(value) || !isRecord(value.shop)
    || !isText(value.shop.name) || !isText(value.shop.address) || !isText(value.shop.phone)
    || (value.shop.logoUrl !== undefined && value.shop.logoUrl !== null && !isText(value.shop.logoUrl))
    || !isText(value.invoiceNumber) || !isText(value.dateTime)
    || typeof value.itemsHidden !== 'boolean'
    || !isMoney(value.discountPaisa) || !isMoney(value.totalPaisa)
    || !isMoney(value.paidPaisa) || !isMoney(value.changePaisa)
    || (value.creditDuePaisa !== null && !isMoney(value.creditDuePaisa))
    || (value.paymentStatus !== 'paid' && value.paymentStatus !== 'partially_paid' && value.paymentStatus !== 'due')
    || !Array.isArray(value.paymentMethods) || !Array.isArray(value.items)) {
    throw new Error('The receipt response is invalid.');
  }

  const paymentMethods = value.paymentMethods.map((payment) => {
    if (!isRecord(payment) || !isPaymentMethod(payment.method) || !isMoney(payment.amountPaisa)) {
      throw new Error('The receipt response is invalid.');
    }
    return { method: payment.method, amountPaisa: payment.amountPaisa };
  });
  const items = value.items.map((item) => {
    if (!isRecord(item) || !isText(item.name) || !isText(item.unit)
      || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)
      || !isMoney(item.pricePaisa) || !isMoney(item.lineTotalPaisa)
      || (item.expiryMonths !== undefined && !isStringArray(item.expiryMonths))
      || (item.returnStatus !== undefined && !isReturnStatus(item.returnStatus))) {
      throw new Error('The receipt response is invalid.');
    }
    return {
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      pricePaisa: item.pricePaisa,
      lineTotalPaisa: item.lineTotalPaisa,
      ...(isStringArray(item.expiryMonths) ? { expiryMonths: item.expiryMonths } : {}),
      ...(isReturnStatus(item.returnStatus) ? { returnStatus: item.returnStatus } : {}),
    };
  });
  return {
    shop: {
      name: value.shop.name,
      address: value.shop.address,
      phone: value.shop.phone,
      logoUrl: isText(value.shop.logoUrl) ? value.shop.logoUrl : null,
    },
    invoiceNumber: value.invoiceNumber,
    dateTime: value.dateTime,
    itemsHidden: value.itemsHidden,
    items,
    discountPaisa: value.discountPaisa,
    totalPaisa: value.totalPaisa,
    paidPaisa: value.paidPaisa,
    paymentMethods,
    changePaisa: value.changePaisa,
    creditDuePaisa: value.creditDuePaisa,
    paymentStatus: value.paymentStatus,
  };
}

function errorStatus(error: unknown): number | null {
  return error instanceof PublicReceiptRequestError ? error.status : null;
}

interface PublicReceiptPageProps {
  token: string | null;
}

export function PublicReceiptPage({ token }: PublicReceiptPageProps) {
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [language, setLanguage] = useState<ReceiptLanguage>(readReceiptLanguage);
  const [isRevealing, setIsRevealing] = useState(false);
  const [itemLoadError, setItemLoadError] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const text = translations[language];
  const isRightToLeft = language === 'ur';

  useEffect(() => {
    document.title = 'Receipt';
    document.body.classList.add('public-receipt');
    document.documentElement.classList.add('public-receipt');
    const robots = document.querySelector('meta[name="robots"]') ?? document.createElement('meta');
    robots.setAttribute('name', 'robots');
    robots.setAttribute('content', 'noindex, nofollow, noarchive');
    if (!robots.parentElement) document.head.appendChild(robots);
    const referrer = document.querySelector('meta[name="referrer"]') ?? document.createElement('meta');
    referrer.setAttribute('name', 'referrer');
    referrer.setAttribute('content', 'no-referrer');
    if (!referrer.parentElement) document.head.appendChild(referrer);
    return () => {
      document.body.classList.remove('public-receipt');
      document.documentElement.classList.remove('public-receipt');
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ur' ? 'rtl' : 'ltr';
  }, [language]);

  const loadReceipt = useCallback(async (revealItemNames = false) => {
    if (!token) {
      setReceipt(null);
      setPageState('unavailable');
      setIsRevealing(false);
      return;
    }
    if (revealItemNames) {
      setIsRevealing(true);
      setItemLoadError(false);
    } else {
      setPageState('loading');
    }
    try {
      const data = await requestPublicReceipt(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        token,
        revealItemNames,
      );
      setReceipt(parsePublicReceipt(data));
      setPageState('loaded');
    } catch (error) {
      if (revealItemNames) setItemLoadError(true);
      else setPageState(errorStatus(error) === 404 ? 'unavailable' : 'retryable');
    } finally {
      setIsRevealing(false);
    }
  }, [token]);

  useEffect(() => {
    void loadReceipt();
  }, [loadReceipt]);

  const changeLanguage = (nextLanguage: ReceiptLanguage) => {
    setLanguage(nextLanguage);
    saveReceiptLanguage(nextLanguage);
  };

  const formatPaymentMethod = (method: PaymentMethod) => {
    const labels: Record<PaymentMethod, string> = {
      CASH: text.cash,
      CARD: text.card,
      EASYPAISA: text.easypaisa,
      JAZZCASH: text.jazzcash,
      CREDIT: text.credit,
    };
    return labels[method];
  };

  if (pageState === 'loading') {
    return (
      <main className="receipt-page" role="status" aria-live="polite">
        <section className="receipt-card receipt-skeleton" aria-label={text.loading}>
          <div className="receipt-skeleton-mark" />
          <div className="receipt-skeleton-line receipt-skeleton-title" />
          <div className="receipt-skeleton-line receipt-skeleton-short" />
          <div className="receipt-skeleton-summary" />
          <div className="receipt-skeleton-row" />
          <div className="receipt-skeleton-row" />
          <p className="receipt-skeleton-label">{text.loading}</p>
        </section>
      </main>
    );
  }

  if (pageState === 'unavailable' || pageState === 'retryable' || !receipt) {
    return (
      <main className="receipt-page" lang={language} dir={isRightToLeft ? 'rtl' : 'ltr'}>
        <section className="receipt-card receipt-message" role="alert">
          <h1>{text.unavailableTitle}</h1>
          <p>{text.unavailable}</p>
          {pageState === 'retryable' && (
            <button className="receipt-button receipt-button-primary" onClick={() => void loadReceipt()}>
              <ReceiptIcon name="retry" />
              {text.retry}
            </button>
          )}
        </section>
      </main>
    );
  }

  const code = receiptCode(receipt.invoiceNumber);
  const phoneLink = normalizeTelephoneNumber(receipt.shop.phone);
  const message = `${text.messagePrefix} ${code}`;
  const whatsappUrl = buildWhatsAppUrl(receipt.shop.phone, message);
  const dateTime = formatReceiptDate(receipt.dateTime);
  const paymentMethodText = receipt.paymentMethods.map(({ method }) => formatPaymentMethod(method)).join(' + ');
  const paymentStatusLabel = receipt.paymentStatus === 'paid'
    ? text.paid
    : receipt.paymentStatus === 'partially_paid'
      ? text.partiallyPaid
      : text.due;
  const initial = Array.from(receipt.shop.name.trim())[0]?.toLocaleUpperCase() ?? 'S';

  return (
    <main className="receipt-page" lang={language} dir={isRightToLeft ? 'rtl' : 'ltr'}>
      <article className="receipt-card">
        <header className="receipt-header">
          <div className="receipt-language" role="group" aria-label={text.language}>
            <button
              type="button"
              aria-pressed={language === 'en'}
              onClick={() => changeLanguage('en')}
            >
              English
            </button>
            <span aria-hidden="true">|</span>
            <button
              type="button"
              aria-pressed={language === 'ur'}
              onClick={() => changeLanguage('ur')}
            >
              اردو {/* needs native-speaker review */}
            </button>
          </div>
          {receipt.shop.logoUrl && !logoFailed ? (
            <img
              src={receipt.shop.logoUrl}
              alt={`${receipt.shop.name} logo`}
              className="receipt-logo"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <div className="receipt-initial" aria-hidden="true">{initial}</div>
          )}
          <h1 className="receipt-shop-name">{receipt.shop.name}</h1>
          {receipt.shop.address && <p className="receipt-contact" dir="auto">{receipt.shop.address}</p>}
          {receipt.shop.phone && <p className="receipt-contact" dir="ltr">{receipt.shop.phone}</p>}
          <span className="receipt-verified">
            <ReceiptIcon name="check" size={14} />
            {text.verified}
          </span>
          <section className="receipt-summary" aria-label={text.totalPaid}>
            <div className="receipt-summary-heading">
              <span>{receipt.creditDuePaisa !== null ? text.paid : text.totalPaid}</span>
              <span className={`receipt-status receipt-status-${receipt.paymentStatus}`}>
                {paymentStatusLabel}
              </span>
            </div>
            <strong className="receipt-summary-amount">{formatReceiptMoney(receipt.paidPaisa)}</strong>
            {receipt.creditDuePaisa !== null && receipt.creditDuePaisa > 0 && (
              <p className="receipt-summary-due">{text.due} {formatReceiptMoney(receipt.creditDuePaisa)}</p>
            )}
            <p className="receipt-summary-meta">
              {paymentMethodText && <span>{paymentMethodText}</span>}
              {paymentMethodText && dateTime && <span aria-hidden="true">·</span>}
              <time dateTime={receipt.dateTime}>{dateTime}</time>
            </p>
          </section>
        </header>

        <div className="receipt-code">
          <span>{text.receiptCode}</span>
          <strong dir="ltr">{code}</strong>
        </div>

        <section className="receipt-items" aria-label={text.itemsLabel}>
          {receipt.itemsHidden && (
            <div className="receipt-hidden-items">
              <span>{text.hiddenItems(receipt.items.length)}</span>
              <button
                type="button"
                className="receipt-text-button"
                disabled={isRevealing}
                onClick={() => void loadReceipt(true)}
              >
                {isRevealing ? text.loading : text.viewItems}
              </button>
              {itemLoadError && <p role="alert">{text.itemLoadError}</p>}
            </div>
          )}
          {!receipt.itemsHidden && receipt.items.map((item, index) => (
            <div className="receipt-item" key={`${item.name}-${index}`}>
              <div className="receipt-item-description">
                <strong className="receipt-item-name">{item.name}</strong>
                <span className="receipt-item-meta" dir="ltr">
                  {item.quantity} {item.unit} × {formatReceiptMoney(item.pricePaisa)}
                </span>
                {item.expiryMonths?.map((month) => {
                  const formattedMonth = formatExpiryMonth(month);
                  return formattedMonth ? (
                    <span className="receipt-expiry" key={month} dir="ltr">
                      {text.expiry} {formattedMonth}
                    </span>
                  ) : null;
                })}
                {item.returnStatus && (
                  <span className={`receipt-return receipt-return-${item.returnStatus}`}>
                    {item.returnStatus === 'pending'
                      ? text.returnPending
                      : item.returnStatus === 'returned'
                        ? text.returned
                        : text.partiallyReturned}
                  </span>
                )}
              </div>
              <strong className="receipt-item-total" dir="ltr">{formatReceiptMoney(item.lineTotalPaisa)}</strong>
            </div>
          ))}
        </section>

        <section className="receipt-totals" aria-label={text.totalsLabel}>
          {receipt.discountPaisa > 0 && (
            <div className="receipt-total-row">
              <span>{text.discount}</span>
              <span dir="ltr">{formatReceiptMoney(receipt.discountPaisa)}</span>
            </div>
          )}
          <div className="receipt-total-row receipt-total-grand">
            <strong>{text.total}</strong>
            <strong dir="ltr">{formatReceiptMoney(receipt.totalPaisa)}</strong>
          </div>
          {receipt.paymentMethods.map(({ method, amountPaisa }) => (
            <div className="receipt-total-row" key={method}>
              <span>
                {method === 'CREDIT'
                  ? formatPaymentMethod(method)
                  : `${text.payment} (${formatPaymentMethod(method)})`}
              </span>
              <span dir="ltr">{formatReceiptMoney(method === 'CREDIT' ? 0 : amountPaisa)}</span>
            </div>
          ))}
          {receipt.creditDuePaisa !== null && receipt.creditDuePaisa > 0 && (
            <div className="receipt-total-row receipt-total-due">
              <strong>{text.dueThisBill}</strong>
              <strong dir="ltr">{formatReceiptMoney(receipt.creditDuePaisa)}</strong>
            </div>
          )}
          {receipt.changePaisa > 0 && (
            <div className="receipt-total-row">
              <span>{text.change}</span>
              <span dir="ltr">{formatReceiptMoney(receipt.changePaisa)}</span>
            </div>
          )}
        </section>

        <section className="receipt-actions" aria-label={text.actionsLabel}>
          <button className="receipt-button receipt-button-primary" onClick={() => window.print()}>
            <ReceiptIcon name="download" />
            {text.download}
          </button>
          {phoneLink && (
            <a className="receipt-button receipt-button-secondary" href={`tel:${phoneLink}`}>
              <ReceiptIcon name="phone" />
              {text.callShop}
            </a>
          )}
        </section>
        <footer className="receipt-footer">
          {whatsappUrl && (
            <a className="receipt-support-link" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              {text.somethingWrong}
            </a>
          )}
          <p>{text.thankYou}</p>
          <small>{text.privateLink}</small>
        </footer>
      </article>
    </main>
  );
}
