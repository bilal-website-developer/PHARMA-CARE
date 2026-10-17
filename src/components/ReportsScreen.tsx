import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  DollarSign,
  EyeOff,
  Package,
  PieChart,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { CompletedSale, PaymentMethod, UserRole } from '../types/pharmacy';
import { parseSaleDate } from '../utils/salesReport';

interface ReportsScreenProps {
  sales: CompletedSale[];
  currentRole: UserRole;
  storeName?: string;
  address?: string;
  phone?: string;
  generatedBy?: string;
  loading?: boolean;
}

type AnalyticsPeriod = 'today' | '7days' | '30days' | 'all';

export const ReportsScreen: React.FC<ReportsScreenProps> = ({
  sales,
  currentRole,
  loading = false,
}) => {
  const [period, setPeriod] = useState<AnalyticsPeriod>('all');
  const canSeeProfit =
    currentRole === UserRole.ADMIN ||
    currentRole === UserRole.SUPER_ADMIN ||
    currentRole === UserRole.ACCOUNTANT;

  // Filter sales based on period
  const filteredSales = useMemo(() => {
    if (period === 'all') return sales;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === 'today') {
      return sales.filter((s) => {
        const d = parseSaleDate(s.timestamp);
        return d !== null && d >= todayStart && d <= now;
      });
    }

    const cutoff = new Date(todayStart);
    if (period === '7days') cutoff.setDate(cutoff.getDate() - 7);
    if (period === '30days') cutoff.setDate(cutoff.getDate() - 30);

    return sales.filter((s) => {
      const d = parseSaleDate(s.timestamp);
      return d !== null && d >= cutoff && d <= now;
    });
  }, [period, sales]);

  // Aggregate Metrics
  const totalRevenuePaisa = useMemo(
    () => filteredSales.reduce((sum, s) => sum + s.totalPaisa, 0),
    [filteredSales]
  );

  const averageOrderPaisa = useMemo(
    () => (filteredSales.length > 0 ? Math.round(totalRevenuePaisa / filteredSales.length) : 0),
    [filteredSales, totalRevenuePaisa]
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

  // Top Selling Products
  const topProducts = useMemo(() => {
    const productMap = new Map<string, { name: string; quantity: number; revenuePaisa: number }>();
    for (const sale of filteredSales) {
      for (const item of sale.items) {
        const current = productMap.get(item.productName) ?? {
          name: item.productName,
          quantity: 0,
          revenuePaisa: 0,
        };
        current.quantity += item.quantityInUnit;
        current.revenuePaisa += item.lineTotalPaisa;
        productMap.set(item.productName, current);
      }
    }
    return Array.from(productMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [filteredSales]);

  const maxTopQuantity = useMemo(
    () => (topProducts.length > 0 ? Math.max(...topProducts.map((p) => p.quantity)) : 0),
    [topProducts]
  );

  // Payment Method Split
  const paymentSplit = useMemo(() => {
    const counts: Record<string, { count: number; paisa: number }> = {
      CASH: { count: 0, paisa: 0 },
      ONLINE: { count: 0, paisa: 0 },
      CREDIT: { count: 0, paisa: 0 },
      SPLIT: { count: 0, paisa: 0 },
    };
    for (const sale of filteredSales) {
      let method = 'CASH';
      if (sale.paymentMethod === PaymentMethod.CREDIT) method = 'CREDIT';
      else if (sale.paymentMethod === PaymentMethod.SPLIT) method = 'SPLIT';
      else if (
        sale.paymentMethod === PaymentMethod.CARD ||
        sale.paymentMethod === PaymentMethod.EASYPAISA ||
        sale.paymentMethod === PaymentMethod.JAZZCASH
      ) {
        method = 'ONLINE';
      }
      if (!counts[method]) counts[method] = { count: 0, paisa: 0 };
      counts[method].count += 1;
      counts[method].paisa += sale.totalPaisa;
    }
    return counts;
  }, [filteredSales]);

  // Trend Data (Group by date)
  const trendData = useMemo(() => {
    const daysMap = new Map<string, { paisa: number; count: number; fullDate: string }>();
    for (const sale of filteredSales) {
      const d = parseSaleDate(sale.timestamp);
      const shortDate = d
        ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(d)
        : sale.timestamp.split(' ')[0] || 'Today';
      const fullDate = d
        ? new Intl.DateTimeFormat('en-GB', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }).format(d)
        : shortDate;

      const existing = daysMap.get(shortDate) ?? { paisa: 0, count: 0, fullDate };
      existing.paisa += sale.totalPaisa;
      existing.count += 1;
      daysMap.set(shortDate, existing);
    }
    const entries = Array.from(daysMap.entries()).slice(-10);
    const maxVal = Math.max(1, ...entries.map(([, v]) => v.paisa));
    return entries.map(([date, data]) => ({
      date,
      fullDate: data.fullDate,
      paisa: data.paisa,
      count: data.count,
      heightPercent: Math.round((data.paisa / maxVal) * 100),
    }));
  }, [filteredSales]);

  return (
    <div className="space-y-2.5">
      {/* ── 1. Slim Header (Title Left, Period Chips Right) ── */}
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-2xs">
        <div>
          <h2 className="text-sm font-black text-text flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-primary" /> Business Analytics
          </h2>
          <p className="text-[11px] text-muted">Sales trends, velocity, and profit margins.</p>
        </div>

        {/* Period Chips: Today / 7 Days / 30 Days / All Time */}
        <div className="flex rounded-control border border-border bg-surface-muted/40 p-0.5 text-xs font-semibold">
          {[
            { id: 'all', label: 'All Time' },
            { id: 'today', label: 'Today' },
            { id: '7days', label: '7 Days' },
            { id: '30days', label: '30 Days' },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id as AnalyticsPeriod)}
              className={`rounded px-2.5 py-1 text-[11px] transition ${
                period === id
                  ? 'bg-primary text-white font-bold shadow-2xs'
                  : 'text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* ── 2. One Row of 4 Compact KPI Tiles ── */}
      <section aria-label="Analytics KPI strip" className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-surface border border-border animate-pulse" />
          ))
        ) : (
          <>
            <div className="rounded-lg border border-border bg-surface px-3 py-1.5 flex items-center justify-between shadow-2xs">
              <span className="text-muted font-medium text-[11px]">Total Revenue</span>
              <strong className="font-mono font-black text-xs text-text">
                Rs. {(totalRevenuePaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
              </strong>
            </div>

            <div className="rounded-lg border border-border bg-surface px-3 py-1.5 flex items-center justify-between shadow-2xs">
              <span className="text-muted font-medium text-[11px]">Avg Ticket (AOV)</span>
              <strong className="font-mono font-black text-xs text-emerald-700 dark:text-emerald-400">
                Rs. {(averageOrderPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
              </strong>
            </div>

            <div className="rounded-lg border border-border bg-surface px-3 py-1.5 flex items-center justify-between shadow-2xs">
              <span className="text-muted font-medium text-[11px]">Gross Profit</span>
              <strong className="font-mono font-black text-xs text-emerald-800 dark:text-emerald-300">
                {canSeeProfit
                  ? grossProfitPaisa === null
                    ? '—'
                    : `Rs. ${(grossProfitPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`
                  : 'Restricted'}
              </strong>
            </div>

            <div className="rounded-lg border border-border bg-surface px-3 py-1.5 flex items-center justify-between shadow-2xs">
              <span className="text-muted font-medium text-[11px]">Gross Margin %</span>
              <strong className="font-mono font-black text-xs text-primary">
                {canSeeProfit ? (grossMarginPercent !== null ? `${grossMarginPercent}%` : '—') : 'Restricted'}
              </strong>
            </div>
          </>
        )}
      </section>

      {/* ── 3. Full-Width "Sales Trend" Card ── */}
      <section className="rounded-xl border border-border bg-surface p-3 shadow-2xs space-y-2">
        <div className="flex items-center justify-between pb-1.5 border-b border-border">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <h3 className="font-bold text-xs text-text">Sales Trend (Daily Volume)</h3>
          </div>
          <span className="text-[10px] text-muted font-mono">
            {filteredSales.length} total orders in period
          </span>
        </div>

        {loading ? (
          <div className="h-28 w-full bg-surface-muted/50 rounded-lg animate-pulse" />
        ) : trendData.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted">
            No sales trend data for this period.
          </div>
        ) : (
          <div className="relative pt-2 pb-1">
            {/* Light horizontal grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20 pb-5">
              <div className="border-b border-border border-dashed w-full" />
              <div className="border-b border-border border-dashed w-full" />
              <div className="border-b border-border border-dashed w-full" />
            </div>

            {/* Interactive Bars with Tooltips */}
            <div className="relative flex items-end justify-between gap-2 h-28 px-2 z-10">
              {trendData.map((item, idx) => (
                <div
                  key={idx}
                  className="group relative flex-1 flex flex-col items-center justify-end h-full cursor-pointer"
                >
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full mb-1.5 hidden group-hover:flex flex-col items-center z-30 pointer-events-none animate-fadeIn">
                    <div className="bg-slate-900 text-white text-[10px] rounded-md px-2 py-1 shadow-lg whitespace-nowrap font-mono text-center">
                      <div className="font-bold text-slate-200">{item.fullDate}</div>
                      <div className="text-emerald-400 font-black">
                        Rs. {(item.paisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-slate-300 text-[9px]">{item.count} orders</div>
                    </div>
                    <div className="w-1.5 h-1.5 bg-slate-900 rotate-45 -mt-0.5" />
                  </div>

                  {/* Top amount preview */}
                  <span className="text-[9px] font-mono font-bold text-text opacity-0 group-hover:opacity-100 transition mb-0.5 whitespace-nowrap">
                    Rs.{(item.paisa / 100).toFixed(0)}
                  </span>

                  {/* Bar */}
                  <div
                    className="w-full max-w-[38px] rounded-t-md bg-emerald-600 dark:bg-emerald-500 hover:bg-emerald-500 transition-all duration-200 shadow-2xs"
                    style={{ height: `${Math.max(6, item.heightPercent)}%` }}
                  />

                  {/* Date label */}
                  <span className="text-[9px] font-mono text-muted truncate max-w-[42px] mt-1">
                    {item.date}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 4. One Row of Three Cards (Payment Split, Top-Selling, Margin Analysis) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 items-stretch">
        {/* Card 1: Payment Split */}
        <section className="rounded-xl border border-border bg-surface p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between pb-1.5 border-b border-border">
            <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
              <PieChart className="w-3.5 h-3.5 text-primary" /> Payment Split
            </h3>
            <span className="text-[10px] text-muted font-mono">{filteredSales.length} txns</span>
          </div>

          {loading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-5 bg-surface-muted/50 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-2 my-auto py-1 text-xs">
              {(['CASH', 'ONLINE', 'CREDIT', 'SPLIT'] as const).map((method) => {
                const data = paymentSplit[method] ?? { count: 0, paisa: 0 };
                const percent =
                  totalRevenuePaisa > 0 ? ((data.paisa / totalRevenuePaisa) * 100).toFixed(0) : '0';

                const barColor =
                  method === 'CASH'
                    ? 'bg-emerald-600'
                    : method === 'ONLINE'
                    ? 'bg-blue-600'
                    : method === 'CREDIT'
                    ? 'bg-amber-600'
                    : 'bg-purple-600';

                return (
                  <div key={method} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-text capitalize">
                        {method.toLowerCase()}
                      </span>
                      <span className="font-mono text-muted text-[10px]">
                        Rs. {(data.paisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}{' '}
                        <strong className="text-text">({percent}%)</strong>
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Card 2: Top-Selling Medicines */}
        <section className="rounded-xl border border-border bg-surface p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between pb-1.5 border-b border-border">
            <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-primary" /> Top-Selling Medicines
            </h3>
            <span className="text-[10px] text-muted">By units</span>
          </div>

          {loading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-5 bg-surface-muted/50 rounded animate-pulse" />
              ))}
            </div>
          ) : topProducts.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted">
              No sales recorded for this period.
            </div>
          ) : (
            <div className="divide-y divide-border/60 my-auto">
              {topProducts.map((p, index) => {
                const relativePercent =
                  maxTopQuantity > 0 ? Math.round((p.quantity / maxTopQuantity) * 100) : 0;

                return (
                  <div key={p.name} className="py-1 space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-4 h-4 rounded-full bg-surface-muted text-muted font-bold text-[9px] flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>
                        <span className="font-bold text-text truncate max-w-[130px] text-xs">
                          {p.name}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <strong className="font-mono text-text text-xs mr-1">
                          {p.quantity} units
                        </strong>
                        <span className="text-[10px] text-muted font-mono">
                          (Rs. {(p.revenuePaisa / 100).toFixed(0)})
                        </span>
                      </div>
                    </div>
                    {/* Mini volume bar */}
                    <div className="h-1 w-full rounded-full bg-border/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500"
                        style={{ width: `${Math.max(4, relativePercent)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Card 3: Margin Analysis */}
        <section className="rounded-xl border border-border bg-surface p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between pb-1.5 border-b border-border">
            <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-primary" /> Margin Analysis
            </h3>
            <span className="text-[10px] text-muted">Performance</span>
          </div>

          {loading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-5 bg-surface-muted/50 rounded animate-pulse" />
              ))}
            </div>
          ) : canSeeProfit ? (
            <div className="space-y-1.5 my-auto text-xs py-0.5">
              <div className="flex items-center justify-between p-1.5 rounded-lg bg-surface-muted/50 border border-border/60">
                <span className="text-muted text-[11px]">Total Sales Revenue</span>
                <strong className="font-mono text-text">
                  Rs. {(totalRevenuePaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
                </strong>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded-lg bg-surface-muted/50 border border-border/60">
                <span className="text-muted text-[11px]">Cost of Goods (COGS)</span>
                <strong className="font-mono text-text">
                  {totalCostPaisa === null
                    ? '—'
                    : `Rs. ${(totalCostPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`}
                </strong>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40">
                <span className="font-bold text-emerald-950 dark:text-emerald-200 text-[11px]">
                  Net Gross Profit
                </span>
                <strong className="font-mono text-emerald-800 dark:text-emerald-300 font-black">
                  {grossProfitPaisa === null
                    ? '—'
                    : `Rs. ${(grossProfitPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`}
                </strong>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40">
                <span className="font-bold text-emerald-950 dark:text-emerald-200 text-[11px]">
                  Gross Margin %
                </span>
                <strong className="font-mono text-emerald-800 dark:text-emerald-300 font-black">
                  {grossMarginPercent === null ? '—' : `${grossMarginPercent}%`}
                </strong>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-muted space-y-1 my-auto">
              <EyeOff className="w-4 h-4 mx-auto text-muted" />
              <p className="font-semibold text-text">Restricted Access</p>
              <p className="text-[10px]">Profit details require Manager or Admin permissions.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
