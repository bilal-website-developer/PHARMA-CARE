import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CreditCard,
  EyeOff,
  Filter,
  Package,
  Printer,
  Receipt,
  Search,
  ShoppingBag,
  TrendingUp,
  X,
} from 'lucide-react';
import { CompletedSale, PaymentMethod, UserRole } from '../types/pharmacy';
import { printHtmlDocument } from '../utils/receipt';
import {
  parseSaleDate,
  renderSalesReport,
  SalesReportFormat,
  SalesReportPeriod,
  salesForPeriod,
  summarizeSales,
  withSalesReportBranding,
} from '../utils/salesReport';

interface SalesHistoryViewProps {
  sales: CompletedSale[];
  currentRole: UserRole;
  storeName?: string;
  address?: string;
  phone?: string;
  generatedBy?: string;
}

type PeriodFilter = 'all' | 'today' | 'week' | 'month';
type MethodFilter = 'ALL' | 'CASH' | 'CREDIT' | 'ONLINE' | 'SPLIT';

function getDayKeyAndLabel(timestamp: string): { key: string; label: string; date: Date } {
  const d = parseSaleDate(timestamp) ?? new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const key = `${year}-${month}-${day}`;

  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  let label = '';
  if (isToday) {
    label = 'TODAY';
  } else if (isYesterday) {
    label = 'YESTERDAY';
  } else {
    label = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
  }

  return { key, label, date: d };
}

function getTimeString(timestamp: string): string {
  const d = parseSaleDate(timestamp);
  if (d && !Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  const parts = timestamp.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : timestamp;
}

const reportPeriodLabels: Record<SalesReportPeriod, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
};

export const SalesHistoryView: React.FC<SalesHistoryViewProps> = ({
  sales,
  currentRole,
  storeName = '',
  address,
  phone,
  generatedBy = '',
}) => {
  const canSeeProfit =
    currentRole === UserRole.ADMIN ||
    currentRole === UserRole.SUPER_ADMIN ||
    currentRole === UserRole.ACCOUNTANT;

  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('ALL');

  // Print modal state
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<SalesReportPeriod>('today');
  const [reportFormat, setReportFormat] = useState<SalesReportFormat>('a4');

  // Filter sales by Period, Method, and Search Query
  const filteredSales = useMemo(() => {
    let result = sales;

    // Period filter
    if (periodFilter !== 'all') {
      result = salesForPeriod(result, periodFilter);
    }

    // Method filter
    if (methodFilter !== 'ALL') {
      result = result.filter((sale) => {
        if (methodFilter === 'CASH') return sale.paymentMethod === PaymentMethod.CASH;
        if (methodFilter === 'CREDIT') return sale.paymentMethod === PaymentMethod.CREDIT;
        if (methodFilter === 'SPLIT') return sale.paymentMethod === PaymentMethod.SPLIT;
        if (methodFilter === 'ONLINE') {
          return (
            sale.paymentMethod === PaymentMethod.CARD ||
            sale.paymentMethod === PaymentMethod.EASYPAISA ||
            sale.paymentMethod === PaymentMethod.JAZZCASH
          );
        }
        return true;
      });
    }

    // Search query
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (sale) =>
          sale.invoiceNumber.toLowerCase().includes(q) ||
          (sale.customerName ? sale.customerName.toLowerCase().includes(q) : false) ||
          sale.cashierName.toLowerCase().includes(q) ||
          sale.items.some((item) => item.productName.toLowerCase().includes(q))
      );
    }

    return result;
  }, [sales, periodFilter, methodFilter, search]);

  // Group filtered sales by day
  const groupedSales = useMemo(() => {
    // Sort sales descending by timestamp/date
    const sorted = [...filteredSales].sort((a, b) => {
      const da = parseSaleDate(a.timestamp)?.getTime() ?? 0;
      const db = parseSaleDate(b.timestamp)?.getTime() ?? 0;
      return db - da;
    });

    const groups: Array<{
      key: string;
      label: string;
      date: Date;
      sales: CompletedSale[];
      orderCount: number;
      dayTotalPaisa: number;
    }> = [];

    const map = new Map<string, typeof groups[0]>();

    for (const sale of sorted) {
      const { key, label, date } = getDayKeyAndLabel(sale.timestamp);
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          label,
          date,
          sales: [],
          orderCount: 0,
          dayTotalPaisa: 0,
        };
        map.set(key, group);
        groups.push(group);
      }
      group.sales.push(sale);
      group.orderCount += 1;
      group.dayTotalPaisa += sale.totalPaisa;
    }

    return groups;
  }, [filteredSales]);

  // Aggregate Metrics across filtered sales
  const totalRevenuePaisa = useMemo(
    () => filteredSales.reduce((sum, s) => sum + s.totalPaisa, 0),
    [filteredSales]
  );

  const hasCompleteSaleCosts = useMemo(
    () => filteredSales.every((sale) => sale.items.every((item) => item.costPaisaPerUnit !== null)),
    [filteredSales]
  );

  const totalCostPaisa = useMemo(
    () =>
      canSeeProfit && hasCompleteSaleCosts
        ? filteredSales.reduce(
            (sum, sale) =>
              sum +
              sale.items.reduce(
                (itemSum, item) => itemSum + (item.costPaisaPerUnit ?? 0) * item.quantityInUnit,
                0
              ),
            0
          )
        : null,
    [canSeeProfit, hasCompleteSaleCosts, filteredSales]
  );

  const grossProfitPaisa = totalCostPaisa === null ? null : totalRevenuePaisa - totalCostPaisa;
  const grossMarginPercent =
    grossProfitPaisa === null
      ? null
      : totalRevenuePaisa > 0
      ? ((grossProfitPaisa / totalRevenuePaisa) * 100).toFixed(1)
      : '0.0';

  const cashSalesPaisa = useMemo(
    () =>
      filteredSales
        .filter((s) => s.paymentMethod === PaymentMethod.CASH)
        .reduce((sum, s) => sum + s.totalPaisa, 0),
    [filteredSales]
  );

  const creditSalesPaisa = useMemo(
    () =>
      filteredSales
        .filter((s) => s.paymentMethod === PaymentMethod.CREDIT)
        .reduce((sum, s) => sum + s.totalPaisa, 0),
    [filteredSales]
  );

  // Print Report Handler
  const printPeriodSales = useMemo(() => salesForPeriod(sales, reportPeriod), [sales, reportPeriod]);
  const printSummary = useMemo(() => summarizeSales(printPeriodSales), [printPeriodSales]);

  const handlePrint = () => {
    const html = renderSalesReport(printSummary, {
      storeName,
      address,
      phone,
      periodLabel: reportPeriodLabels[reportPeriod],
      generatedBy,
      generatedAt: new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date()),
      format: reportFormat,
    });
    const brandedHtml = withSalesReportBranding(html);
    void printHtmlDocument(brandedHtml)
      .then(() => setShowPrintModal(false))
      .catch((error: unknown) => {
        window.alert(
          `Sales report printing failed. ${
            error instanceof Error ? error.message : 'The print document could not be opened.'
          }`
        );
      });
  };

  return (
    <div className="space-y-2.5">
      {/* ── 1. Top Toolbar (One Slim Row) ── */}
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-2xs">
        {/* Left: Title + Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <ShoppingBag className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-black text-text">Sales History</h2>
          </div>
          <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold px-2 py-0.5 text-[10px]">
            {sales.length} orders
          </span>
        </div>

        {/* Center: Search Field */}
        <div className="relative flex-1 min-w-[190px] max-w-xs">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice, customer, medicine..."
            className="w-full rounded-control border border-border bg-surface pl-8 pr-7 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1.5 text-muted hover:text-text"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Right: Period Tabs + Method Chips + Print Button */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period Tabs */}
          <div className="flex rounded-control border border-border bg-surface-muted/40 p-0.5 text-xs font-semibold">
            {[
              { id: 'all', label: 'All Time' },
              { id: 'today', label: 'Today' },
              { id: 'week', label: 'This Week' },
              { id: 'month', label: 'This Month' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setPeriodFilter(id as PeriodFilter)}
                className={`rounded px-2 py-1 text-[11px] transition ${
                  periodFilter === id
                    ? 'bg-primary text-white font-bold shadow-2xs'
                    : 'text-muted hover:text-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Payment Method Chips */}
          <div className="flex rounded-control border border-border bg-surface-muted/40 p-0.5 text-xs font-semibold">
            {(['ALL', 'CASH', 'CREDIT'] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setMethodFilter(method)}
                className={`rounded px-2 py-1 text-[11px] transition ${
                  methodFilter === method
                    ? 'bg-surface text-text font-bold shadow-2xs border border-border'
                    : 'text-muted hover:text-text'
                }`}
              >
                {method}
              </button>
            ))}
          </div>

          {/* Print Report Button */}
          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="inline-flex items-center gap-1.5 rounded-control bg-primary hover:opacity-90 px-2.5 py-1 text-xs font-bold text-white transition shadow-2xs"
            title="Open Print Sales Report"
          >
            <Printer size={13} />
            <span>Print report</span>
          </button>
        </div>
      </section>

      {/* ── 2. One Row of Compact KPI Chips (6 items) ── */}
      <section
        aria-label="Sales KPI strip"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs"
        title={`Calculated across ${filteredSales.length} filtered transactions`}
      >
        <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium text-[11px]">Gross Revenue</span>
          <strong className="font-mono font-black text-xs text-text">
            Rs. {(totalRevenuePaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium text-[11px]">Invoices</span>
          <strong className="font-mono font-black text-xs text-text">{filteredSales.length}</strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium text-[11px]">Cash Sales</span>
          <strong className="font-mono font-black text-xs text-emerald-700 dark:text-emerald-400">
            Rs. {(cashSalesPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium text-[11px]">Credit Sales</span>
          <strong className="font-mono font-black text-xs text-amber-700 dark:text-amber-400">
            Rs. {(creditSalesPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium text-[11px]">Gross Profit</span>
          <strong className="font-mono font-black text-xs text-emerald-800 dark:text-emerald-300">
            {canSeeProfit
              ? grossProfitPaisa === null
                ? '—'
                : `Rs. ${(grossProfitPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`
              : 'Restricted'}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium text-[11px]">Gross Margin</span>
          <strong className="font-mono font-black text-xs text-primary">
            {canSeeProfit ? (grossMarginPercent !== null ? `${grossMarginPercent}%` : '—') : 'Restricted'}
          </strong>
        </div>
      </section>

      {/* Caption note */}
      <div className="flex items-center justify-between px-1 text-[11px] text-muted">
        <span>
          Showing <strong>{filteredSales.length}</strong> of <strong>{sales.length}</strong> orders
        </span>
        <span className="hidden sm:inline">Calculated across {filteredSales.length} transactions</span>
      </div>

      {/* ── 3 & 4. Transactions List Grouped By Day ── */}
      <div className="bg-surface rounded-xl border border-border shadow-2xs overflow-hidden">
        {/* Table Header */}
        <div className="overflow-x-auto max-h-[calc(100vh-250px)] min-h-[380px]">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-surface border-b border-border text-muted font-bold text-[10px] uppercase tracking-wider sticky top-0 z-20 shadow-2xs">
              <tr>
                <th className="py-2 px-3 w-32">Invoice #</th>
                <th className="py-2 px-3 w-24">Time</th>
                <th className="py-2 px-3">Customer</th>
                <th className="py-2 px-3 w-28">Cashier</th>
                <th className="py-2 px-3">Medicines / Items</th>
                <th className="py-2 px-3 w-20">Method</th>
                <th className="py-2 px-3 text-right w-28">Total (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {groupedSales.map((group) => (
                <React.Fragment key={group.key}>
                  {/* Day Header Bar with light tinted background */}
                  <tr className="bg-primary/5 dark:bg-emerald-950/40 border-y border-border/80 sticky top-[33px] z-10 backdrop-blur-xs">
                    <td colSpan={7} className="py-1.5 px-3">
                      <div className="flex items-center justify-between text-[11px] font-bold text-text">
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-primary" />
                          <span className="uppercase tracking-wider text-primary font-black">
                            {group.label}
                          </span>
                          <span className="text-muted font-normal">•</span>
                          <span className="text-muted font-medium">
                            {group.orderCount} {group.orderCount === 1 ? 'order' : 'orders'}
                          </span>
                        </div>
                        <div className="font-mono text-text">
                          Day Total:{' '}
                          <strong className="text-primary font-black">
                            Rs. {(group.dayTotalPaisa / 100).toLocaleString('en-PK', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </strong>
                        </div>
                      </div>
                    </td>
                  </tr>

                  {/* Day Compact Rows */}
                  {group.sales.map((sale) => {
                    const methodBadgeColor =
                      sale.paymentMethod === PaymentMethod.CASH
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : sale.paymentMethod === PaymentMethod.CREDIT
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        : sale.paymentMethod === PaymentMethod.SPLIT
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300';

                    const itemsTooltip = sale.items
                      .map((i) => `${i.productName} (x${i.quantityInUnit})`)
                      .join(', ');

                    return (
                      <tr
                        key={sale.id}
                        className="hover:bg-primary/5 transition border-b border-border/50 cursor-default"
                      >
                        <td className="py-1.5 px-3 font-mono font-bold text-primary whitespace-nowrap">
                          {sale.invoiceNumber}
                        </td>
                        <td className="py-1.5 px-3 text-muted text-[11px] font-mono whitespace-nowrap">
                          {getTimeString(sale.timestamp)}
                        </td>
                        <td className="py-1.5 px-3 font-medium text-text text-xs truncate max-w-[140px]">
                          {sale.customerName || 'Walk-in Customer'}
                        </td>
                        <td className="py-1.5 px-3 text-muted text-[11px] truncate max-w-[100px]">
                          {sale.cashierName}
                        </td>
                        <td
                          className="py-1.5 px-3 text-text text-xs truncate max-w-xs"
                          title={itemsTooltip}
                        >
                          <span className="text-muted text-[11px] mr-1.5">
                            ({sale.items.length})
                          </span>
                          {itemsTooltip}
                        </td>
                        <td className="py-1.5 px-3 whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold text-[10px] tracking-wide ${methodBadgeColor}`}
                          >
                            {sale.paymentMethod}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono font-bold text-text whitespace-nowrap">
                          Rs.{' '}
                          {(sale.totalPaisa / 100).toLocaleString('en-PK', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}

              {/* 7. Empty State */}
              {groupedSales.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-xs text-muted">
                    <Receipt className="w-8 h-8 mx-auto text-muted/60 mb-2" />
                    <p className="font-medium text-text">
                      {search || periodFilter !== 'all' || methodFilter !== 'ALL'
                        ? 'No sales match the applied filter or search criteria.'
                        : 'No sales recorded yet. Process an order on the POS counter to populate this report.'}
                    </p>
                    {(search || periodFilter !== 'all' || methodFilter !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('');
                          setPeriodFilter('all');
                          setMethodFilter('ALL');
                        }}
                        className="mt-2 text-xs text-primary font-semibold hover:underline"
                      >
                        Clear all filters
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 6. Print Sales Report Modal ── */}
      {showPrintModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-labelledby="print-modal-title"
        >
          <div className="bg-surface rounded-2xl max-w-md w-full p-5 border border-border shadow-xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Printer className="w-4 h-4 text-primary" />
                <h3 id="print-modal-title" className="font-bold text-sm text-text">
                  Print Sales Report
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="p-1 rounded text-muted hover:text-text hover:bg-border/40 transition"
                aria-label="Close dialog"
              >
                <X size={14} />
              </button>
            </div>

            {/* Description */}
            <p className="text-xs text-muted">
              Generate and print a sales summary with cashier and payment breakdown.
            </p>

            {/* Period Selector */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text block">Report Period</label>
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-control border border-border bg-surface-muted/40 text-xs">
                {(['today', 'week', 'month'] as const).map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setReportPeriod(period)}
                    className={`rounded py-1.5 font-semibold text-xs transition ${
                      reportPeriod === period
                        ? 'bg-primary text-white font-bold shadow-2xs'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    {reportPeriodLabels[period]}
                  </button>
                ))}
              </div>
            </div>

            {/* Paper Size Selector */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text block">Paper Format</label>
              <select
                value={reportFormat}
                onChange={(e) => setReportFormat(e.target.value as SalesReportFormat)}
                className="w-full rounded-control border border-border bg-surface px-3 py-1.5 text-xs text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <option value="a4">A4 (Standard Sheet)</option>
                <option value="thermal80">Thermal 80mm Roll</option>
              </select>
            </div>

            {/* Period Stats Summary or Empty Notice */}
            {printPeriodSales.length === 0 ? (
              <div className="p-3 rounded-lg border border-border bg-surface-muted/40 text-center text-xs text-muted">
                No sales were recorded{' '}
                {reportPeriod === 'today'
                  ? 'today'
                  : reportPeriod === 'week'
                  ? 'this week'
                  : 'this month'}
                .
              </div>
            ) : (
              <div className="p-3 rounded-lg border border-border bg-primary/5 text-xs space-y-1">
                <div className="flex justify-between text-text font-medium">
                  <span>Completed Invoices:</span>
                  <strong className="font-mono">{printSummary.invoiceCount}</strong>
                </div>
                <div className="flex justify-between text-text font-medium">
                  <span>Gross Sales:</span>
                  <strong className="font-mono text-primary font-bold">
                    Rs. {(printSummary.grossSalesPaisa / 100).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })}
                  </strong>
                </div>
                <div className="flex justify-between text-muted text-[11px]">
                  <span>Medicines dispensed:</span>
                  <span>{printSummary.topMedicines.length} unique</span>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="px-3 py-1.5 text-xs font-semibold text-muted hover:text-text rounded-control"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={printPeriodSales.length === 0}
                className="px-4 py-1.5 text-xs font-bold text-white bg-primary hover:opacity-90 rounded-control transition shadow-2xs disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <Printer size={13} />
                <span>Print Report</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
