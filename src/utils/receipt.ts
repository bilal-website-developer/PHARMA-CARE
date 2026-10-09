import { CompletedSale, PaymentMethod } from '../types/pharmacy';
import { APP_NAME } from '../constants/brand';

export type BillingTemplate = 'simple' | 'classic' | 'professional' | 'modern' | 'pharmacy-memo';
export type ReceiptFormat = 'thermal58' | 'thermal80' | 'a4';
export type MemoKind = 'SALE' | 'RETURN' | 'PAYMENT';
export type MemoRounding = 'none' | '1' | '5' | '10';

export interface PharmacyMemoSettings {
  storeName: string;
  address: string;
  phone: string;
  notes: [string, string, string];
  terminalName: string;
  showBatchExpiry: boolean;
  roundNet: MemoRounding;
  printTax: boolean;
  duplicateLabel: boolean;
  autoPrint: boolean;
  numberDigits: number;
}

export interface MemoData {
  kind: MemoKind;
  memoNo: string;
  originalMemoNo?: string;
  dateTime: string;
  customerName?: string;
  lines: Array<{
    qty: number;
    name: string;
    ratePaisa: number;
    batch?: string;
    expiry?: string;
  }>;
  discountPaisa: number;
  roundingPaisa?: number;
  salesTaxPaisa?: number;
  paidPaisa?: number;
  isCredit?: boolean;
  isDuplicate?: boolean;
  cashier: string;
  role: string;
  terminal: string;
  amountReceivedPaisa?: number;
  balanceAfterPaisa?: number;
}

export interface BillingPreferences {
  template: BillingTemplate;
  format: ReceiptFormat;
}

const BILLING_PREFERENCES_KEY = 'pharma-care.billingPreferences';
const MEMO_DEFAULT_APPLIED_KEY = 'pharma-care.memoDefaultApplied';

function getStorage(): Storage | undefined {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return undefined;
    }
    return storage;
  } catch {
    return undefined;
  }
}

const normalizeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
};

export function readBillingPreferences(): BillingPreferences {
  return readBillingPreferencesWithMigration().preferences;
}

export function readBillingPreferencesWithMigration(): {
  preferences: BillingPreferences;
  migratedClassicDefault: boolean;
} {
  const defaults: BillingPreferences = { template: 'pharmacy-memo', format: 'thermal80' };
  const storage = getStorage();
  if (!storage) return { preferences: defaults, migratedClassicDefault: false };

  try {
    const stored = storage.getItem(BILLING_PREFERENCES_KEY);
    if (!stored) {
      storage.setItem(MEMO_DEFAULT_APPLIED_KEY, 'true');
      return { preferences: defaults, migratedClassicDefault: false };
    }
    const value: unknown = JSON.parse(stored);
    if (typeof value !== 'object' || value === null) {
      storage.setItem(MEMO_DEFAULT_APPLIED_KEY, 'true');
      return { preferences: defaults, migratedClassicDefault: false };
    }
    const record = value as Record<string, unknown>;
    const wasDefaultApplied = storage.getItem(MEMO_DEFAULT_APPLIED_KEY) === 'true';
    const isClassicDefault = !wasDefaultApplied && record.template === 'classic';
    const template = isClassicDefault
      ? 'pharmacy-memo'
      : ['simple', 'classic', 'professional', 'modern', 'pharmacy-memo'].includes(normalizeString(record.template))
      ? (record.template as BillingTemplate)
      : defaults.template;
    const format = ['thermal58', 'thermal80', 'a4'].includes(normalizeString(record.format))
      ? (record.format as ReceiptFormat)
      : defaults.format;
    if (isClassicDefault) storage.setItem(BILLING_PREFERENCES_KEY, JSON.stringify({ template, format }));
    storage.setItem(MEMO_DEFAULT_APPLIED_KEY, 'true');
    return { preferences: { template, format }, migratedClassicDefault: isClassicDefault };
  } catch {
    return { preferences: defaults, migratedClassicDefault: false };
  }
}

export function saveBillingPreferences(preferences: BillingPreferences): boolean {
  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.setItem(BILLING_PREFERENCES_KEY, JSON.stringify(preferences));
    storage.setItem(MEMO_DEFAULT_APPLIED_KEY, 'true');
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_PHARMACY_MEMO_SETTINGS: PharmacyMemoSettings = {
  storeName: APP_NAME,
  address: '',
  phone: '',
  notes: [
    'Items will be return with cash memo within 15 days.',
    'Inhaler / loose tablets / lotion / fridge items/cosmetics items will not be returned.',
    'Without sign and stamp bill will not be valid',
  ],
  terminalName: 'SERVER-PC',
  showBatchExpiry: true,
  roundNet: 'none',
  printTax: false,
  duplicateLabel: true,
  autoPrint: false,
  numberDigits: 6,
};

export const PHARMACY_MEMO_TEST_FIXTURE: MemoData = {
  kind: 'SALE',
  memoNo: '335001',
  dateTime: '2026-10-06T21:18:58',
  customerName: '',
  lines: [
    { qty: 14, name: 'Glucophage Tab 250mg', ratePaisa: 244, batch: 'B2411', expiry: '08/2027' },
    { qty: 7, name: 'MyoCure Tablet', ratePaisa: 5000, batch: 'M1022', expiry: '03/2028' },
    { qty: 7, name: 'Folic 600mg Tab', ratePaisa: 2100, batch: 'F7731', expiry: '11/2027' },
  ],
  discountPaisa: 3116,
  paidPaisa: 50000,
  cashier: 'Sample Cashier',
  role: 'CASHIER',
  terminal: 'SERVER-PC',
};

export interface ReceiptData {
  storeName: string;
  address?: string;
  phone?: string;
  ntn?: string;
  invoiceNo: string;
  dateTime: string;
  cashierName: string;
  customerName: string;
  customerPhone?: string;
  paymentMode: string;
  status: 'PAID' | 'CREDIT' | 'PARTIAL';
  items: Array<{
    name: string;
    company?: string;
    batchNo: string;
    expiry: string;
    qty: number;
    unit: string;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  change: number;
  balanceDue: number;
  footerEnglish: string;
  footerUrdu: string;
}

export function buildMemoData(
  sale: CompletedSale,
  identity: { role?: string; terminal?: string } = {}
): MemoData {
  return {
    kind: 'SALE',
    memoNo: sale.invoiceNumber,
    dateTime: sale.timestamp,
    customerName: sale.customerName,
    lines: sale.items.map((item) => ({
      qty: item.quantityInUnit,
      name: item.productName,
      ratePaisa: item.mrpPaisaPerUnit,
      batch: item.batchNumber,
      expiry: item.expiryDate,
    })),
    discountPaisa: sale.discountPaisa,
    paidPaisa: sale.paymentMethod === PaymentMethod.CREDIT ? 0 : sale.amountTenderedPaisa,
    roundingPaisa: sale.roundingPaisa,
    isCredit: sale.paymentMethod === PaymentMethod.CREDIT
      || sale.amountTenderedPaisa < sale.totalPaisa,
    cashier: sale.cashierName,
    role: identity.role ?? '',
    terminal: identity.terminal ?? DEFAULT_PHARMACY_MEMO_SETTINGS.terminalName,
  };
}

export function buildPaymentMemoData(payment: {
  referenceNo?: string;
  dateTime: string;
  customerName: string;
  amountReceivedPaisa: number;
  balanceAfterPaisa: number;
  cashier: string;
  role?: string;
  terminal?: string;
}): MemoData {
  return {
    kind: 'PAYMENT',
    memoNo: payment.referenceNo ?? '',
    dateTime: payment.dateTime,
    customerName: payment.customerName,
    lines: [],
    discountPaisa: 0,
    cashier: payment.cashier,
    role: payment.role ?? '',
    terminal: payment.terminal ?? DEFAULT_PHARMACY_MEMO_SETTINGS.terminalName,
    amountReceivedPaisa: payment.amountReceivedPaisa,
    balanceAfterPaisa: payment.balanceAfterPaisa,
  };
}

const escapeHtml = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
};

const money = (paisa: number): string => {
  const normalized = Number.isFinite(paisa) ? paisa : 0;
  return `Rs ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(normalized / 100))}`;
};

export function receiptDataFromSale(
  sale: CompletedSale,
  store: Partial<Pick<ReceiptData, 'storeName' | 'address' | 'phone' | 'ntn' | 'footerEnglish' | 'footerUrdu'>> = {}
): ReceiptData {
  const isCredit = sale.paymentMethod === PaymentMethod.CREDIT;
  const paid = isCredit ? 0 : sale.amountTenderedPaisa;
  const balanceDue = Math.max(0, sale.totalPaisa - paid);
  return {
    storeName: store.storeName || APP_NAME,
    address: store.address,
    phone: store.phone,
    ntn: store.ntn,
    invoiceNo: sale.invoiceNumber,
    dateTime: sale.timestamp,
    cashierName: sale.cashierName,
    customerName: sale.customerName || 'Walk-in Customer',
    customerPhone: sale.customerPhone,
    paymentMode: sale.paymentMethod,
    status: isCredit ? 'CREDIT' : balanceDue > 0 ? (paid > 0 ? 'PARTIAL' : 'CREDIT') : 'PAID',
    items: sale.items.map((item) => ({
      name: item.productName,
      batchNo: item.batchNumber,
      expiry: item.expiryDate,
      qty: item.quantityInUnit,
      unit: item.unitName,
      unitPrice: item.mrpPaisaPerUnit,
      lineTotal: item.lineTotalPaisa,
    })),
    subtotal: sale.subtotalPaisa,
    discount: sale.discountPaisa,
    total: sale.totalPaisa,
    paid,
    change: sale.changePaisa,
    balanceDue,
    footerEnglish: store.footerEnglish || 'Thank you for your business.',
    footerUrdu: store.footerUrdu || 'شکریہ! دوبارہ تشریف لائیں',
  };
}

function thermalMarkup(template: BillingTemplate, data: ReceiptData): string {
  const header = `<header class="center"><img class="brand-logo" src="/pharma-care-512.png" alt="${escapeHtml(APP_NAME)}"><h1>${escapeHtml(data.storeName)}</h1>${data.address ? `<div>${escapeHtml(data.address)}</div>` : ''}${data.phone ? `<div>${escapeHtml(data.phone)}</div>` : ''}</header>`;
  const meta = `<section class="meta"><strong>Invoice: ${escapeHtml(data.invoiceNo)}</strong><div>Date: ${escapeHtml(data.dateTime)}</div><div>Customer: ${escapeHtml(data.customerName)}</div><div>Cashier: ${escapeHtml(data.cashierName)}</div><div>Payment: ${escapeHtml(data.paymentMode)}</div></section>`;
  const rows = data.items.map((item) => `<div class="item"><strong>${escapeHtml(item.name)}</strong><div class="muted">Batch ${escapeHtml(item.batchNo)} · Exp ${escapeHtml(item.expiry)}</div><div class="row"><span>${item.qty} ${escapeHtml(item.unit)} × ${money(item.unitPrice)}</span><strong>${money(item.lineTotal)}</strong></div></div>`).join('');
  const items = `<section><h2>ITEMS (${data.items.length} total)</h2>${rows}</section>`;
  const totals = `<section class="totals"><div class="row"><span>Subtotal</span><span>${money(data.subtotal)}</span></div><div class="row discount"><span>Discount</span><span>−${money(data.discount)}</span></div><div class="row total"><strong>NET TOTAL</strong><strong>${money(data.total)}</strong></div><div class="row"><span>Amount Paid</span><span>${money(data.paid)}</span></div>${data.change ? `<div class="row"><span>Change</span><span>${money(data.change)}</span></div>` : ''}${data.balanceDue ? `<div class="row"><span>Balance Due</span><span>${money(data.balanceDue)}</span></div>` : ''}<div class="status">${data.status === 'PAID' ? 'PAID IN FULL' : data.status}</div></section>`;
  const footer = `<footer><div class="urdu" dir="rtl">${escapeHtml(data.footerUrdu)}</div><div>${escapeHtml(data.footerEnglish)}</div></footer>`;
  const receiptTitle = template === 'professional' ? '*** SALES RECEIPT ***' : template === 'modern' ? 'SALES RECEIPT' : 'RECEIPT';
  const outerClass = `${template} thermal`;
  return `<article class="${outerClass}">${template === 'simple' ? `${header}<hr><h2 class="center">${receiptTitle}</h2>${meta}${items}${totals}${footer}` : template === 'professional' ? `<div class="double-rule"></div>${header}<h2 class="center">${receiptTitle}</h2><div class="invoice-box"># ${escapeHtml(data.invoiceNo)}</div>${meta}<hr>${items}${totals}<div class="double-rule"></div>${footer}` : template === 'classic' ? `${header}<hr class="dashed"><h2 class="center">— ${receiptTitle} —</h2>${meta}<hr class="dashed">${items}${totals}<hr class="dashed">${footer}` : `${header}<div class="pill">${receiptTitle}</div>${meta}${items}${totals}${footer}`}</article>`;
}

function a4Markup(template: BillingTemplate, data: ReceiptData): string {
  const taxTitle = data.ntn ? 'TAX INVOICE' : 'INVOICE';
  const title = template === 'professional' ? taxTitle : 'INVOICE';
  const band = template === 'simple' ? '' : 'band';
  const header = `<header class="${band}"><div class="brand-heading"><img class="brand-logo" src="/pharma-care-512.png" alt="${escapeHtml(APP_NAME)}"><div><h1>${escapeHtml(data.storeName)}</h1>${data.address ? `<div>${escapeHtml(data.address)}</div>` : ''}${data.phone ? `<div>${escapeHtml(data.phone)}</div>` : ''}</div></div><div class="invoice"><strong>${title}</strong><h2># ${escapeHtml(data.invoiceNo)}</h2><div>${escapeHtml(data.dateTime)}</div></div></header>`;
  const info = `<section class="info"><div><small>BILL TO</small><strong>${escapeHtml(data.customerName)}</strong>${data.customerPhone ? `<span>${escapeHtml(data.customerPhone)}</span>` : ''}</div><div><small>CASHIER</small><strong>${escapeHtml(data.cashierName)}</strong></div><div><small>PAYMENT</small><strong>${escapeHtml(data.paymentMode)}</strong><span class="status">${data.status}</span></div></section>`;
  const rows = data.items.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(item.name)}</strong>${item.company ? `<small>${escapeHtml(item.company)}</small>` : ''}<em>Batch ${escapeHtml(item.batchNo)} · Exp ${escapeHtml(item.expiry)}</em></td><td>${item.qty} ${escapeHtml(item.unit)}</td><td>${money(item.unitPrice)}</td><td>${money(item.lineTotal)}</td></tr>`).join('');
  const table = `<table><thead><tr><th>#</th><th>DESCRIPTION</th><th>QTY</th><th>UNIT PRICE</th><th>TOTAL</th></tr></thead><tbody>${rows}</tbody></table>`;
  const summary = `<section class="summary"><h3>SUMMARY</h3><div class="row"><span>Subtotal (${data.items.length} items)</span><span>${money(data.subtotal)}</span></div><div class="row discount"><span>Discount</span><span>−${money(data.discount)}</span></div><div class="row"><span>Amount Paid</span><span>${money(data.paid)}</span></div>${data.balanceDue ? `<div class="row"><span>Balance Due</span><span>${money(data.balanceDue)}</span></div>` : ''}<div class="row total"><strong>TOTAL</strong><strong>${money(data.total)}</strong></div></section>`;
  const stamp = data.status === 'PAID' ? '<span class="stamp paid">PAID</span>' : data.status === 'CREDIT' ? '<span class="stamp credit">CREDIT</span>' : '';
  const footer = `<footer><div><div class="urdu" dir="rtl">${escapeHtml(data.footerUrdu)}</div><div>${escapeHtml(data.footerEnglish)}</div></div><div class="signature">Authorized Signature</div></footer>`;
  return `<article class="${template} a4 ${template === 'modern' ? 'modern-card' : ''}">${header}${info}${table}<div class="summary-wrap">${summary}${stamp}</div>${footer}</article>`;
}

export function renderReceipt(
  template: BillingTemplate,
  format: ReceiptFormat,
  data: ReceiptData
): string {
  const article = format === 'a4' ? a4Markup(template, data) : thermalMarkup(template, data);
  const width = format === 'thermal58' ? '58mm' : format === 'thermal80' ? '80mm' : '210mm';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice ${escapeHtml(data.invoiceNo)}</title><style>
    *{box-sizing:border-box}body{margin:0;color:var(--text);font:12px Arial,sans-serif}.thermal{width:${width};padding:4mm;margin:0 auto}.center{text-align:center}.thermal h1{font-size:16px;margin:0 0 3px}.thermal h2{font-size:12px;margin:7px 0}.thermal .meta{margin:7px 0}.thermal .item{padding:5px 0;border-bottom:1px dashed var(--border)}.muted,small,em{color:var(--muted)}.muted{font-size:10px}.row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.totals{margin-top:7px;border-top:1px solid var(--text);padding-top:4px}.discount{color:var(--primary)}.total{border-top:1px solid var(--text);padding-top:5px;font-size:14px}.status{font-weight:bold;color:var(--primary);text-align:right}.pill{width:max-content;margin:5px auto;padding:3px 8px;border-radius:999px;background:var(--surface);color:var(--primary)}hr{border:0;border-top:1px solid var(--text);margin:7px 0}.dashed{border-top-style:dashed}.double-rule{height:5px;border-top:3px double var(--text);border-bottom:1px solid var(--text);margin:4px 0}.invoice-box{border:1px solid var(--border);padding:5px;text-align:center;margin:5px}.urdu{text-align:center;font-family:serif;font-size:14px;margin:5px 0}footer{text-align:center;border-top:1px solid var(--border);padding-top:7px;margin-top:8px;font-size:10px}.brand-logo{width:22mm;height:22mm;object-fit:contain}.thermal .brand-logo{width:12mm;height:12mm}.brand-heading{display:flex;align-items:center;gap:10px}
    .a4{width:210mm;min-height:297mm;margin:0 auto;padding:14mm;font-size:12px}.a4 header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:4px 0 16px}.a4 h1{font-size:24px;margin:0 0 5px}.a4 .invoice{text-align:right}.a4 .invoice h2{font-size:20px;margin:5px 0}.a4 .band{margin:-14mm -14mm 14px;padding:14mm;background:var(--text);color:var(--white)}.info{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin:15px 0}.info div{display:flex;flex-direction:column;gap:4px}.info small{font-weight:bold}.a4 table{width:100%;border-collapse:collapse;margin:18px 0}.a4 th{text-align:left;padding:9px;background:var(--text);color:var(--white)}.a4 td{padding:9px;border-bottom:1px solid var(--border);vertical-align:top}.a4 tbody tr:nth-child(even){background:var(--surface)}.a4 td:first-child,.a4 td:nth-child(3){text-align:center}.a4 td:nth-child(n+4),.a4 th:nth-child(n+4){text-align:right}.a4 td small,.a4 td em{display:block;margin-top:3px;font-size:10px}.summary-wrap{display:flex;justify-content:flex-end;gap:16px;align-items:center}.summary{width:280px;padding:12px;border:1px solid var(--border);border-radius:8px}.summary h3{font-size:11px;margin:0 0 8px}.summary .total{background:var(--text);color:var(--white);padding:9px;margin:8px -12px -12px}.stamp{border:2px solid currentColor;border-radius:6px;padding:6px 10px;font-weight:bold;transform:rotate(-8deg)}.paid{color:var(--primary)}.credit{color:var(--warning)}.a4 footer{display:flex;justify-content:space-between;text-align:left;margin-top:35px;padding:12px;background:var(--surface)}.a4 footer .urdu{text-align:left}.signature{width:180px;border-top:1px solid var(--muted);text-align:center;padding-top:5px;margin-top:25px}.simple header{border-bottom:2px solid var(--text)}.classic .band{background:var(--text)}.professional .band{background:linear-gradient(100deg,var(--text),var(--primary))}.modern{border-top:5px solid var(--primary);border-radius:12px}.modern .band{background:var(--white)}.modern-card{border:1px solid var(--border);box-shadow:0 4px 12px color-mix(in srgb,var(--text) 12%,transparent)}
    @page{size:${format === 'a4' ? 'A4' : `${width} auto`};margin:0}@media print{body{width:100%}.thermal{margin:0}.a4{margin:0;box-shadow:none}}
  </style></head><body>${article}</body></html>`;
}

function memoDateTime(value: string) {
  const legacy = value.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s*(.*)$/);
  const date = legacy
    ? `${legacy[1]}/${legacy[2]}/${legacy[3].slice(-2)}`
    : (() => {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime())
        ? value
        : `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getFullYear()).slice(-2)}`;
    })();
  const timeInput = legacy?.[4] ?? (() => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? ''
      : parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  })();
  const time = timeInput.replace(/(\d{1,2}:\d{2}:\d{2})\s*(am|pm)/i, (_match, clock: string, period: string) =>
    `${clock} ${period.toUpperCase()}`
  );
  return { date, time };
}

function memoMoney(paisa: number, negative = false) {
  const amount = Math.abs(paisa);
  const prefix = negative || paisa < 0 ? '-' : '';
  return `${prefix}${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}

export function renderPharmacyMemo(
  data: MemoData,
  settings: PharmacyMemoSettings,
  format: ReceiptFormat
): string {
  if (!['thermal58', 'thermal80', 'a4'].includes(format)) throw new Error('Unsupported memo paper format.');
  if (!Array.isArray(data.lines) || !Array.isArray(settings.notes)) throw new Error('Memo data or settings are incomplete.');
  const sign = data.kind === 'RETURN' ? -1 : 1;
  const lineAmounts = data.lines.map((line) => {
    if (!Number.isFinite(line.qty) || line.qty < 0 || !Number.isSafeInteger(line.ratePaisa) || line.ratePaisa < 0) {
      throw new Error('Memo quantity and rate must be valid non-negative numbers.');
    }
    return Math.floor(line.qty * line.ratePaisa + 0.5);
  });
  const grossPaisa = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  const discountPaisa = Math.max(0, Math.round(data.discountPaisa));
  const taxPaisa = Math.max(0, Math.round(data.salesTaxPaisa ?? 0));
  const netBeforeRounding = grossPaisa - discountPaisa + taxPaisa;
  const roundingUnit = settings.roundNet === 'none' ? 0 : Number(settings.roundNet) * 100;
  const calculatedRounding = roundingUnit
    ? Math.floor(netBeforeRounding / roundingUnit + 0.5) * roundingUnit - netBeforeRounding
    : 0;
  const roundingPaisa = data.roundingPaisa ?? calculatedRounding;
  const netPaisa = netBeforeRounding + roundingPaisa;
  const printedDiscount = grossPaisa + taxPaisa - netPaisa;
  const { date, time } = memoDateTime(data.dateTime);
  const digitCount = Math.max(1, Math.min(20, Math.floor(settings.numberDigits) || 6));
  const digits = data.memoNo.replace(/\D/g, '');
  const displayedNumber = data.kind === 'PAYMENT'
    ? data.memoNo
    : digits.length > digitCount ? digits.slice(-digitCount) : digits;
  const amount = (paisa: number) => memoMoney(paisa, sign < 0);
  const direction = (value: string | undefined) => /[\u0600-\u06ff]/.test(value ?? '') ? ' dir="rtl" class="urdu-text"' : '';
  const phone = settings.phone.trim();
  const phoneLine = phone
    ? phone.includes(':') ? phone : `CELL: ${phone}`
    : '';
  const header = `<header class="store"><strong>${escapeHtml(settings.storeName)}</strong>${settings.address.trim() ? `<span>${escapeHtml(settings.address)}</span>` : ''}${phoneLine ? `<span>${escapeHtml(phoneLine)}</span>` : ''}</header>`;
  const customerArea = data.customerName !== undefined
    ? `<div class="customer-name"${direction(data.customerName)}>${escapeHtml(data.customerName)}</div>`
    : `<div class="customer-blank"></div>`;
  const duplicate = settings.duplicateLabel && data.isDuplicate ? '<div class="memo-title">DUPLICATE</div>' : '';
  const title = data.kind === 'RETURN' ? '<div class="memo-title">RETURN MEMO</div>' : '';
  const meta = `<section class="meta"><span>Cash Memo# ${escapeHtml(displayedNumber)}</span><span class="date">Date. ${escapeHtml(date)}<br>${escapeHtml(time)}</span></section>${data.kind === 'RETURN' && data.originalMemoNo ? `<div class="original">Original Memo# ${escapeHtml(data.originalMemoNo)}</div>` : ''}`;
  const rows = data.lines.map((line, index) => `<div class="item"><span class="qty">${escapeHtml(line.qty)}</span><span class="description"${direction(line.name)}>${escapeHtml(line.name)}${settings.showBatchExpiry && (line.batch || line.expiry) ? `<small>Batch ${escapeHtml(line.batch ?? '')}${line.expiry ? ` · Exp ${escapeHtml(line.expiry)}` : ''}</small>` : ''}</span><span class="rate">${amount(line.ratePaisa)}</span><strong class="line-total">${amount(lineAmounts[index])}</strong></div>`).join('');
  const table = data.kind === 'PAYMENT'
    ? `<section class="payment"><div class="row"><strong>Amount Received:</strong><strong>${amount(data.amountReceivedPaisa ?? 0)}</strong></div><div class="row"><span>Balance After:</span><span>${amount(data.balanceAfterPaisa ?? 0)}</span></div></section>`
    : `<section class="items"><div class="table-head"><strong>Qty</strong><strong>Description</strong><strong>Rate</strong><strong>Amount</strong></div>${rows}</section>`;
  const isFullyOnCredit = data.isCredit === true && (data.paidPaisa ?? 0) <= 0;
  const isPartialPayment = data.isCredit === true && (data.paidPaisa ?? 0) > 0;
  const balanceRows = isFullyOnCredit
    ? `<div class="row"><strong>Credit / Balance Due:</strong><strong>${amount(netPaisa)}</strong></div>`
    : isPartialPayment
      ? `<div class="row"><span>Paid:</span><span>${amount(data.paidPaisa ?? 0)}</span></div><div class="row"><span>Balance:</span><span>${amount(Math.max(0, netPaisa - (data.paidPaisa ?? 0)))}</span></div>`
      : '';
  const totals = data.kind === 'PAYMENT'
    ? ''
    : `<section class="totals"><div class="total-items">Total Items: ${data.lines.length}</div><div class="total-details"><div class="row"><span>Gross Amount:</span><span>${amount(grossPaisa)}</span></div><div class="row"><span>Discount:</span><span>${amount(printedDiscount)}</span></div>${settings.printTax && data.salesTaxPaisa !== undefined ? `<div class="row"><span>Sales Tax:</span><span>${amount(taxPaisa)}</span></div>` : ''}<div class="net"><strong>${data.kind === 'RETURN' ? 'Refund Amount:' : 'Net Amount:'}</strong><strong>${amount(netPaisa)}</strong></div>${balanceRows}</div></section>`;
  const notes = settings.notes.map((note, index) => `<div>${index + 1}. ${escapeHtml(note)}</div>`).join('');
  const footer = `<footer><span>${escapeHtml(data.cashier)}</span><span>${escapeHtml(data.role)}</span><span>${escapeHtml(data.terminal || settings.terminalName)}</span></footer>`;
  const width = format === 'thermal58' ? '48mm' : '72mm';
  const isA4 = format === 'a4';
  const article = `<main class="memo ${isA4 ? 'a4' : ''}">${customerArea}${duplicate}${title}${header}${meta}${table}${totals}<section class="notes"><strong>Note:</strong>${notes}</section>${footer}</main>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${data.kind === 'PAYMENT' ? 'Payment Memo' : 'Cash Memo'}</title><style>
    @font-face{font-family:'Noto Nastaliq Urdu';src:url('/fonts/noto-nastaliq-urdu-arabic.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}
    *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}.memo{width:${width};padding:0;margin:0 auto;font-size:${format === 'thermal58' ? '10.5px' : '12px'};line-height:1.35;color:#000}.memo.a4{width:80mm;margin:0 auto}.customer-blank{height:9mm;border-bottom:1px solid #000;margin-bottom:2mm}.customer-name{min-height:9mm;border-bottom:1px solid #000;margin-bottom:2mm;padding-top:1mm}.urdu-text{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Urdu Typesetting',serif;direction:rtl;text-align:right}.memo-title{text-align:center;font-weight:bold;margin:1mm 0}.store{text-align:center;font-size:1em;margin:0 0 2mm}.store strong{display:block;text-transform:uppercase;font-size:1.4em}.store span{display:block}.meta{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #000;padding:1mm 0}.date{text-align:right}.original{padding:1mm 0}.table-head,.item{display:grid;grid-template-columns:9% minmax(0,1fr) 20% 22%;gap:1mm;align-items:start}.table-head{border:1px solid #000;padding:1mm 0;text-align:right}.table-head strong:nth-child(2){text-align:left}.item{padding:1.5mm 0;border-bottom:1px dotted #000}.qty{text-align:left}.description{overflow-wrap:anywhere}.description small{display:block;font-size:.85em}.rate,.line-total{text-align:right;overflow-wrap:anywhere}.totals{display:flex;justify-content:space-between;border-top:1px solid #000;margin-top:2mm;padding-top:1mm}.total-details{width:64%}.row{display:flex;justify-content:space-between;gap:2mm}.net{display:flex;flex-wrap:nowrap;white-space:nowrap;justify-content:space-between;gap:1mm;border:1px solid #000;padding:1.5mm;margin-top:1mm;font-size:1.05em;font-weight:bold}.net strong{white-space:nowrap}.payment{border-top:1px solid #000;border-bottom:1px solid #000;padding:3mm 0;margin:2mm 0}.payment .row{padding:1mm 0}.notes{border-top:1px solid #000;margin-top:2mm;padding-top:1mm}.notes div{margin-top:1mm;overflow-wrap:anywhere}.memo footer{display:flex;justify-content:space-between;gap:1mm;border-top:1px solid #000;margin-top:4mm;padding-top:2mm;font-size:.82em}.memo footer span{max-width:33%;overflow-wrap:anywhere}.memo footer span:nth-child(2){text-align:center}.memo footer span:last-child{text-align:right}.memo{padding-bottom:10mm}.memo.a4{padding-top:0}@page{size:${isA4 ? 'A4' : `${format === 'thermal58' ? '58mm' : '80mm'} auto`};margin:0}@media print{html,body{width:100%;margin:0}.memo{margin:0 auto;break-after:auto}.item{break-inside:avoid}.memo.a4{margin:0 auto}}
  </style></head><body>${article}</body></html>`;
}

export function withReceiptTheme(html: string): string {
  const rootStyle = getComputedStyle(document.documentElement);
  const names = ['primary', 'accent', 'surface', 'white', 'text', 'muted', 'warning', 'border'];
  const variables = names
    .map((name) => `--${name}:${rootStyle.getPropertyValue(`--${name}`).trim()}`)
    .join(';');
  return html.replace('</head>', `<style>:root{${variables}}</style></head>`);
}

export function printReceipt(html: string): void {
  const frame = document.createElement('iframe');
  frame.title = 'Print receipt';
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.onload = () => {
    if (!frame.contentWindow) {
      frame.remove();
      throw new Error('Print frame is unavailable.');
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
    window.setTimeout(() => frame.remove(), 1000);
  };
  document.body.appendChild(frame);
  if (!frame.contentDocument) {
    frame.remove();
    throw new Error('Print document is unavailable.');
  }
  frame.contentDocument.open();
  frame.contentDocument.write(withReceiptTheme(html));
  frame.contentDocument.close();
}
