import { CompletedSale, PaymentMethod } from '../types/pharmacy';

export type SalesReportPeriod = 'today' | 'week' | 'month';
export type SalesReportFormat = 'a4' | 'thermal80';

export interface SalesReportSummary {
  invoiceCount: number;
  grossSalesPaisa: number;
  discountsPaisa: number;
  netSalesPaisa: number;
  paymentBreakdown: Array<{ label: string; amountPaisa: number }>;
  topMedicines: Array<{ name: string; quantity: number; valuePaisa: number }>;
  cashierTotals: Array<{ name: string; invoices: number; amountPaisa: number }>;
}

export function parseSaleDate(timestamp: string): Date | null {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(timestamp);
  if (isoDate) {
    const parsed = new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const localDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(timestamp);
  if (localDate) {
    const parsed = new Date(Number(localDate[3]), Number(localDate[2]) - 1, Number(localDate[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function salesForPeriod(
  sales: CompletedSale[],
  period: SalesReportPeriod,
  now = new Date()
): CompletedSale[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (period === 'month') {
    start.setDate(1);
  }

  return sales.filter((sale) => {
    const date = parseSaleDate(sale.timestamp);
    return date !== null && date >= start && date <= now;
  });
}

export function summarizeSales(sales: CompletedSale[]): SalesReportSummary {
  const payments = new Map<string, number>([
    ['Cash', 0],
    ['Online', 0],
    ['Credit', 0],
  ]);
  const medicines = new Map<string, { quantity: number; valuePaisa: number }>();
  const cashiers = new Map<string, { invoices: number; amountPaisa: number }>();

  for (const sale of sales) {
    const paymentLabel =
      sale.paymentMethod === PaymentMethod.CASH
        ? 'Cash'
        : sale.paymentMethod === PaymentMethod.CREDIT
          ? 'Credit'
          : 'Online';
    payments.set(paymentLabel, (payments.get(paymentLabel) ?? 0) + sale.totalPaisa);

    const cashier = cashiers.get(sale.cashierName) ?? { invoices: 0, amountPaisa: 0 };
    cashier.invoices += 1;
    cashier.amountPaisa += sale.totalPaisa;
    cashiers.set(sale.cashierName, cashier);

    for (const item of sale.items) {
      const medicine = medicines.get(item.productName) ?? { quantity: 0, valuePaisa: 0 };
      medicine.quantity += item.quantityInUnit;
      medicine.valuePaisa += item.lineTotalPaisa;
      medicines.set(item.productName, medicine);
    }
  }

  const grossSalesPaisa = sales.reduce((sum, sale) => sum + sale.subtotalPaisa, 0);
  const discountsPaisa = sales.reduce((sum, sale) => sum + sale.discountPaisa, 0);
  const netSalesPaisa = sales.reduce((sum, sale) => sum + sale.totalPaisa, 0);

  return {
    invoiceCount: sales.length,
    grossSalesPaisa,
    discountsPaisa,
    netSalesPaisa,
    paymentBreakdown: [...payments].map(([label, amountPaisa]) => ({ label, amountPaisa })),
    topMedicines: [...medicines]
      .map(([name, amounts]) => ({ name, ...amounts }))
      .sort((left, right) => right.quantity - left.quantity || right.valuePaisa - left.valuePaisa)
      .slice(0, 10),
    cashierTotals: [...cashiers]
      .map(([name, amounts]) => ({ name, ...amounts }))
      .sort((left, right) => right.amountPaisa - left.amountPaisa),
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

export function renderSalesReport(
  summary: SalesReportSummary,
  options: {
    storeName: string;
    address?: string;
    phone?: string;
    periodLabel: string;
    generatedBy: string;
    generatedAt: string;
    format: SalesReportFormat;
  }
): string {
  const paymentRows = summary.paymentBreakdown
    .map(({ label, amountPaisa }) => `<tr><td>${escapeHtml(label)}</td><td>${money(amountPaisa)}</td></tr>`)
    .join('');
  const medicineRows = summary.topMedicines.length
    ? summary.topMedicines
        .map(
          (item, index) =>
            `<tr><td>${index + 1}</td><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${money(item.valuePaisa)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No medicine sales in this period.</td></tr>';
  const cashierRows = summary.cashierTotals.length
    ? summary.cashierTotals
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.name)}</td><td>${item.invoices}</td><td>${money(item.amountPaisa)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="empty">No cashier sales in this period.</td></tr>';
  const paperWidth = options.format === 'a4' ? '210mm' : '80mm';
  const isThermal = options.format === 'thermal80';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sales report</title><style>
    *{box-sizing:border-box}body{margin:0;color:var(--text);font:12px Arial,sans-serif}.report{width:${paperWidth};margin:0 auto;padding:${isThermal ? '5mm' : '14mm'}}h1{margin:0;font-size:${isThermal ? '17px' : '25px'}}h2{margin:18px 0 8px;font-size:14px}.muted{color:var(--muted)}.header{border-bottom:2px solid var(--text);padding-bottom:12px}.meta{display:flex;justify-content:space-between;gap:16px;margin-top:8px}.summary{display:grid;grid-template-columns:repeat(${isThermal ? '1' : '3'},1fr);gap:8px;margin:14px 0}.metric{border:1px solid var(--border);border-radius:8px;padding:9px}.metric strong{display:block;margin-top:4px;font-size:16px}.totals{margin-top:14px}.total{background:var(--text);color:var(--white);padding:8px;font-weight:bold}table{width:100%;border-collapse:collapse;margin:8px 0 16px}th,td{text-align:left;padding:7px 5px;border-bottom:1px solid var(--border)}th{background:var(--surface);font-size:10px;text-transform:uppercase}.empty{text-align:center;color:var(--muted);padding:16px}.footer{margin-top:20px;border-top:1px solid var(--border);padding-top:8px;color:var(--muted)}@page{size:${isThermal ? '80mm auto' : 'A4'};margin:0}@media print{.report{margin:0}.metric{break-inside:avoid}table{break-inside:auto}tr{break-inside:avoid}}
  </style></head><body><main class="report"><header class="header"><h1>${escapeHtml(options.storeName)}</h1>${options.address ? `<div>${escapeHtml(options.address)}</div>` : ''}${options.phone ? `<div>${escapeHtml(options.phone)}</div>` : ''}<div class="meta"><strong>${escapeHtml(options.periodLabel)} Sales Report</strong><span class="muted">Generated by ${escapeHtml(options.generatedBy)} · ${escapeHtml(options.generatedAt)}</span></div></header><section class="summary"><div class="metric">Invoices<strong>${summary.invoiceCount}</strong></div><div class="metric">Gross sales<strong>${money(summary.grossSalesPaisa)}</strong></div><div class="metric">Discounts<strong>${money(summary.discountsPaisa)}</strong></div>${!isThermal ? `<div class="metric">Returns<strong>Unavailable</strong><span class="muted">No return records are connected.</span></div>` : ''}<div class="metric total">Net sales (before untracked returns)<strong>${money(summary.netSalesPaisa)}</strong></div></section><section><h2>Payment method</h2><table><thead><tr><th>Method</th><th>Sales</th></tr></thead><tbody>${paymentRows}</tbody></table></section><section><h2>Top medicines by quantity and value</h2><table><thead><tr><th>#</th><th>Medicine</th><th>Qty</th><th>Value</th></tr></thead><tbody>${medicineRows}</tbody></table></section><section><h2>Cashier totals</h2><table><thead><tr><th>Cashier</th><th>Invoices</th><th>Sales</th></tr></thead><tbody>${cashierRows}</tbody></table></section><footer class="footer">Returns and other server-backed adjustments are not represented by this frontend report.</footer></main></body></html>`;
}
