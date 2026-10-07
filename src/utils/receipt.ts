import { CompletedSale, PaymentMethod } from '../types/pharmacy';

export type BillingTemplate = 'simple' | 'classic' | 'professional' | 'modern';
export type ReceiptFormat = 'thermal58' | 'thermal80' | 'a4';
export interface BillingPreferences {
  template: BillingTemplate;
  format: ReceiptFormat;
}

const BILLING_PREFERENCES_KEY = 'pharmacare.billingPreferences';

export function readBillingPreferences(): BillingPreferences {
  const defaults: BillingPreferences = { template: 'classic', format: 'thermal80' };
  try {
    const stored = localStorage.getItem(BILLING_PREFERENCES_KEY);
    if (!stored) return defaults;
    const value: unknown = JSON.parse(stored);
    if (typeof value !== 'object' || value === null) return defaults;
    const record = value as Record<string, unknown>;
    const template = ['simple', 'classic', 'professional', 'modern'].includes(String(record.template))
      ? (record.template as BillingTemplate)
      : defaults.template;
    const format = ['thermal58', 'thermal80', 'a4'].includes(String(record.format))
      ? (record.format as ReceiptFormat)
      : defaults.format;
    return { template, format };
  } catch {
    return defaults;
  }
}

export function saveBillingPreferences(preferences: BillingPreferences): boolean {
  try {
    localStorage.setItem(BILLING_PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

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

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });

const money = (paisa: number): string =>
  `Rs ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(paisa / 100))}`;

export function receiptDataFromSale(
  sale: CompletedSale,
  store: Partial<Pick<ReceiptData, 'storeName' | 'address' | 'phone' | 'ntn' | 'footerEnglish' | 'footerUrdu'>> = {}
): ReceiptData {
  const isCredit = sale.paymentMethod === PaymentMethod.CREDIT;
  const paid = isCredit ? 0 : sale.amountTenderedPaisa;
  const balanceDue = Math.max(0, sale.totalPaisa - paid);
  return {
    storeName: store.storeName || 'PharmaCare',
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
  const header = `<header class="center"><h1>${escapeHtml(data.storeName)}</h1>${data.address ? `<div>${escapeHtml(data.address)}</div>` : ''}${data.phone ? `<div>${escapeHtml(data.phone)}</div>` : ''}</header>`;
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
  const header = `<header class="${band}"><div><h1>${escapeHtml(data.storeName)}</h1>${data.address ? `<div>${escapeHtml(data.address)}</div>` : ''}${data.phone ? `<div>${escapeHtml(data.phone)}</div>` : ''}</div><div class="invoice"><strong>${title}</strong><h2># ${escapeHtml(data.invoiceNo)}</h2><div>${escapeHtml(data.dateTime)}</div></div></header>`;
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
    *{box-sizing:border-box}body{margin:0;color:var(--text);font:12px Arial,sans-serif}.thermal{width:${width};padding:4mm;margin:0 auto}.center{text-align:center}.thermal h1{font-size:16px;margin:0 0 3px}.thermal h2{font-size:12px;margin:7px 0}.thermal .meta{margin:7px 0}.thermal .item{padding:5px 0;border-bottom:1px dashed var(--border)}.muted,small,em{color:var(--muted)}.muted{font-size:10px}.row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.totals{margin-top:7px;border-top:1px solid var(--text);padding-top:4px}.discount{color:var(--primary)}.total{border-top:1px solid var(--text);padding-top:5px;font-size:14px}.status{font-weight:bold;color:var(--primary);text-align:right}.pill{width:max-content;margin:5px auto;padding:3px 8px;border-radius:999px;background:var(--surface);color:var(--primary)}hr{border:0;border-top:1px solid var(--text);margin:7px 0}.dashed{border-top-style:dashed}.double-rule{height:5px;border-top:3px double var(--text);border-bottom:1px solid var(--text);margin:4px 0}.invoice-box{border:1px solid var(--border);padding:5px;text-align:center;margin:5px}.urdu{text-align:center;font-family:serif;font-size:14px;margin:5px 0}footer{text-align:center;border-top:1px solid var(--border);padding-top:7px;margin-top:8px;font-size:10px}
    .a4{width:210mm;min-height:297mm;margin:0 auto;padding:14mm;font-size:12px}.a4 header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:4px 0 16px}.a4 h1{font-size:24px;margin:0 0 5px}.a4 .invoice{text-align:right}.a4 .invoice h2{font-size:20px;margin:5px 0}.a4 .band{margin:-14mm -14mm 14px;padding:14mm;background:var(--text);color:var(--white)}.info{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin:15px 0}.info div{display:flex;flex-direction:column;gap:4px}.info small{font-weight:bold}.a4 table{width:100%;border-collapse:collapse;margin:18px 0}.a4 th{text-align:left;padding:9px;background:var(--text);color:var(--white)}.a4 td{padding:9px;border-bottom:1px solid var(--border);vertical-align:top}.a4 tbody tr:nth-child(even){background:var(--surface)}.a4 td:first-child,.a4 td:nth-child(3){text-align:center}.a4 td:nth-child(n+4),.a4 th:nth-child(n+4){text-align:right}.a4 td small,.a4 td em{display:block;margin-top:3px;font-size:10px}.summary-wrap{display:flex;justify-content:flex-end;gap:16px;align-items:center}.summary{width:280px;padding:12px;border:1px solid var(--border);border-radius:8px}.summary h3{font-size:11px;margin:0 0 8px}.summary .total{background:var(--text);color:var(--white);padding:9px;margin:8px -12px -12px}.stamp{border:2px solid currentColor;border-radius:6px;padding:6px 10px;font-weight:bold;transform:rotate(-8deg)}.paid{color:var(--primary)}.credit{color:var(--warning)}.a4 footer{display:flex;justify-content:space-between;text-align:left;margin-top:35px;padding:12px;background:var(--surface)}.a4 footer .urdu{text-align:left}.signature{width:180px;border-top:1px solid var(--muted);text-align:center;padding-top:5px;margin-top:25px}.simple header{border-bottom:2px solid var(--text)}.classic .band{background:var(--text)}.professional .band{background:linear-gradient(100deg,var(--text),var(--primary))}.modern{border-top:5px solid var(--primary);border-radius:12px}.modern .band{background:var(--white)}.modern-card{border:1px solid var(--border);box-shadow:0 4px 12px color-mix(in srgb,var(--text) 12%,transparent)}
    @page{size:${format === 'a4' ? 'A4' : `${width} auto`};margin:0}@media print{body{width:100%}.thermal{margin:0}.a4{margin:0;box-shadow:none}}
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
