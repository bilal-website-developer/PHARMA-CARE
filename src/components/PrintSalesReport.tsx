import React, { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { CompletedSale } from '../types/pharmacy';
import { printReceipt } from '../utils/receipt';
import {
  renderSalesReport,
  SalesReportFormat,
  SalesReportPeriod,
  salesForPeriod,
  summarizeSales,
  withSalesReportBranding,
} from '../utils/salesReport';

interface PrintSalesReportProps {
  sales: CompletedSale[];
  storeName: string;
  address?: string;
  phone?: string;
  generatedBy: string;
}

const periodLabels: Record<SalesReportPeriod, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
};

export const PrintSalesReport: React.FC<PrintSalesReportProps> = ({
  sales,
  storeName,
  address,
  phone,
  generatedBy,
}) => {
  const [period, setPeriod] = useState<SalesReportPeriod>('today');
  const [format, setFormat] = useState<SalesReportFormat>('a4');
  const periodSales = useMemo(() => salesForPeriod(sales, period), [sales, period]);
  const summary = useMemo(() => summarizeSales(periodSales), [periodSales]);

  const handlePrint = () => {
    const html = renderSalesReport(summary, {
      storeName,
      address,
      phone,
      periodLabel: periodLabels[period],
      generatedBy,
      generatedAt: new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date()),
      format,
    });
    const brandedHtml = withSalesReportBranding(html);
    printReceipt(brandedHtml);
  };

  return (
    <section className="space-y-4 rounded-card border border-border bg-white p-5 shadow-xs sm:p-6">
      <div className="border-b border-border pb-4">
        <h3 className="text-sm font-black text-text">Print Sales Report</h3>
        <p className="mt-1 text-xs text-muted">
          Generate and print a daily, weekly, or monthly sales summary with revenue breakdown.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-control border border-border bg-surface p-1" role="group" aria-label="Report period">
          {(Object.keys(periodLabels) as SalesReportPeriod[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={period === option}
              onClick={() => setPeriod(option)}
              className={`rounded-control px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                period === option ? 'bg-primary text-white' : 'text-muted hover:text-text'
              }`}
            >
              {periodLabels[option]}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-muted">
          Paper
          <select
            value={format}
            onChange={(event) =>
              setFormat(event.target.value === 'thermal80' ? 'thermal80' : 'a4')
            }
            className="rounded-control border border-border bg-white px-2.5 py-2 text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="a4">A4</option>
            <option value="thermal80">Thermal 80mm</option>
          </select>
        </label>
        <button
          type="button"
          onClick={handlePrint}
          disabled={periodSales.length === 0}
          className="flex items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-xs font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          Print Report
        </button>
      </div>
      {periodSales.length === 0 ? (
        <p className="rounded-control border border-border bg-surface px-4 py-5 text-center text-xs text-muted" role="status">
          No sales were recorded {period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'}.
          The report will be available when this period has sales.
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted" aria-live="polite">
          <span><strong className="text-text">{summary.invoiceCount}</strong> invoices</span>
          <span><strong className="text-text">{summary.topMedicines.length}</strong> medicines</span>
          <span>Format: <strong className="text-text">{format === 'a4' ? 'A4' : 'Thermal 80mm'}</strong></span>
        </div>
      )}
    </section>
  );
};
