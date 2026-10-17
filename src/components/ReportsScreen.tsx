import React, { useMemo, useState } from 'react';
import { BarChart3, DollarSign, EyeOff, Package, PieChart, TrendingUp } from 'lucide-react';
import { CompletedSale, UserRole } from '../types/pharmacy';

interface ReportsScreenProps {
  sales: CompletedSale[];
  currentRole: UserRole;
  storeName?: string;
  address?: string;
  phone?: string;
  generatedBy?: string;
}

type AnalyticsPeriod = 'today' | '7days' | '30days' | 'all';

export const ReportsScreen: React.FC<ReportsScreenProps> = ({
  sales,
  currentRole,
}) => {
  const [period, setPeriod] = useState<AnalyticsPeriod>('all');
  const canSeeProfit = currentRole === UserRole.ADMIN || currentRole === UserRole.SUPER_ADMIN || currentRole === UserRole.ACCOUNTANT;

  // Filter sales based on period
  const filteredSales = useMemo(() => {
    if (period === 'all') return sales;
    const now = new Date();
    const todayStr = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);

    if (period === 'today') {
      return sales.filter((s) => s.timestamp.startsWith(todayStr) || s.timestamp.includes(todayStr));
    }

    const cutoff = new Date();
    if (period === '7days') cutoff.setDate(now.getDate() - 7);
    if (period === '30days') cutoff.setDate(now.getDate() - 30);

    return sales.filter((s) => {
      const parts = s.timestamp.split(' ')[0]?.split('/');
      if (parts && parts.length === 3) {
        const saleDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        return saleDate >= cutoff;
      }
      return true;
    });
  }, [period, sales]);

  // Aggregate Metrics
  const totalRevenuePaisa = useMemo(() => filteredSales.reduce((sum, s) => sum + s.totalPaisa, 0), [filteredSales]);
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
        const current = productMap.get(item.productName) ?? { name: item.productName, quantity: 0, revenuePaisa: 0 };
        current.quantity += item.quantityInUnit;
        current.revenuePaisa += item.lineTotalPaisa;
        productMap.set(item.productName, current);
      }
    }
    return Array.from(productMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [filteredSales]);

  // Payment Method Split
  const paymentSplit = useMemo(() => {
    const counts: Record<string, { count: number; paisa: number }> = {
      CASH: { count: 0, paisa: 0 },
      ONLINE: { count: 0, paisa: 0 },
      CREDIT: { count: 0, paisa: 0 },
      SPLIT: { count: 0, paisa: 0 },
    };
    for (const sale of filteredSales) {
      const method = sale.paymentMethod || 'CASH';
      if (!counts[method]) counts[method] = { count: 0, paisa: 0 };
      counts[method].count += 1;
      counts[method].paisa += sale.totalPaisa;
    }
    return counts;
  }, [filteredSales]);

  // Trend Data (Group by date or recent sales)
  const trendData = useMemo(() => {
    const daysMap = new Map<string, number>();
    for (const sale of filteredSales) {
      const dateKey = sale.timestamp.split(' ')[0] || 'Today';
      daysMap.set(dateKey, (daysMap.get(dateKey) ?? 0) + sale.totalPaisa);
    }
    const entries = Array.from(daysMap.entries()).slice(-7);
    const maxVal = Math.max(1, ...entries.map(([, v]) => v));
    return entries.map(([date, paisa]) => ({
      date,
      paisa,
      heightPercent: Math.round((paisa / maxVal) * 100),
    }));
  }, [filteredSales]);

  return (
    <div className="space-y-3">
      {/* ── Slim Header with Date Range Filter ── */}
      <section className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="text-xl font-black text-text flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Business Analytics
          </h2>
          <p className="text-xs text-muted">Sales trends, velocity, and profit margins.</p>
        </div>

        {/* Date Range Filter Pills */}
        <div className="flex rounded-control border border-border bg-surface p-0.5 text-xs">
          {[
            { id: 'today', label: 'Today' },
            { id: '7days', label: '7 Days' },
            { id: '30days', label: '30 Days' },
            { id: 'all', label: 'All Time' },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id as AnalyticsPeriod)}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${
                period === id ? 'bg-primary text-white shadow-2xs font-bold' : 'text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* ── 4 Slim KPI Tiles in Single Row ── */}
      <section aria-label="Analytics overview" className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium">Total Revenue</span>
          <strong className="font-mono font-black text-xs text-text">
            Rs. {(totalRevenuePaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium">Avg Ticket (AOV)</span>
          <strong className="font-mono font-black text-xs text-emerald-700 dark:text-emerald-400">
            Rs. {(averageOrderPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium">Gross Profit</span>
          <strong className="font-mono font-black text-xs text-emerald-800 dark:text-emerald-300">
            {canSeeProfit
              ? grossProfitPaisa === null
                ? '—'
                : `Rs. ${(grossProfitPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`
              : 'Restricted'}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium">Gross Margin %</span>
          <strong className="font-mono font-black text-xs text-primary">
            {canSeeProfit
              ? grossMarginPercent === null
                ? '—'
                : `${grossMarginPercent}%`
              : 'Restricted'}
          </strong>
        </div>
      </section>

      {/* ── Visual Trend & Payment Method Split ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Sales Trend Visual Chart (8 cols) */}
        <section className="lg:col-span-8 rounded-xl border border-border bg-surface p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-primary" /> Sales Trend
            </h3>
            <span className="text-[10px] text-muted">Daily volume</span>
          </div>

          <div className="mt-2.5 flex items-end justify-between gap-2.5 h-28 px-1">
            {trendData.map((item, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                <span className="text-[9px] font-mono font-bold text-text opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                  Rs.{(item.paisa / 100).toFixed(0)}
                </span>
                <div
                  className="w-full max-w-[42px] rounded-t-md bg-emerald-600 dark:bg-emerald-500 hover:bg-emerald-500 transition-all duration-300"
                  style={{ height: `${Math.max(8, item.heightPercent)}%` }}
                />
                <span className="text-[9px] font-mono text-muted truncate max-w-[46px]">{item.date}</span>
              </div>
            ))}
            {trendData.length === 0 && (
              <div className="w-full text-center text-xs text-muted py-6">No sales trend data for this period.</div>
            )}
          </div>
        </section>

        {/* Payment Method Split (4 cols) */}
        <section className="lg:col-span-4 rounded-xl border border-border bg-surface p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
              <PieChart className="w-3.5 h-3.5 text-primary" /> Payment Split
            </h3>
            <span className="text-[10px] text-muted">{filteredSales.length} total</span>
          </div>

          <div className="space-y-2 mt-2 text-xs">
            {(['CASH', 'ONLINE', 'CREDIT', 'SPLIT'] as const).map((method) => {
              const data = paymentSplit[method] ?? { count: 0, paisa: 0 };
              const percent = totalRevenuePaisa > 0 ? ((data.paisa / totalRevenuePaisa) * 100).toFixed(0) : '0';

              return (
                <div key={method} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-text capitalize">{method.toLowerCase()}</span>
                    <span className="font-mono text-muted text-[10px]">
                      Rs. {(data.paisa / 100).toFixed(0)} ({percent}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        method === 'CASH'
                          ? 'bg-emerald-600'
                          : method === 'ONLINE'
                          ? 'bg-blue-600'
                          : method === 'CREDIT'
                          ? 'bg-amber-600'
                          : 'bg-purple-600'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ── Top-Selling Products & Profit Breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Top-Selling Products (7 cols) */}
        <section className="lg:col-span-7 rounded-xl border border-border bg-surface p-3.5 shadow-2xs">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-primary" /> Top-Selling Medicines
            </h3>
            <span className="text-[10px] text-muted">By units sold</span>
          </div>

          <div className="divide-y divide-border mt-1">
            {topProducts.map((p, index) => (
              <div key={p.name} className="py-1.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-4 h-4 rounded-full bg-surface-muted text-muted font-bold text-[9px] flex items-center justify-center shrink-0">
                    {index + 1}
                  </span>
                  <span className="font-bold text-text truncate max-w-xs">{p.name}</span>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-mono font-black text-text mr-2">{p.quantity} units</span>
                  <span className="text-muted text-[10px] font-mono">
                    (Rs. {(p.revenuePaisa / 100).toFixed(0)})
                  </span>
                </div>
              </div>
            ))}
            {topProducts.length === 0 && (
              <div className="py-6 text-center text-xs text-muted">No sales items recorded for this period.</div>
            )}
          </div>
        </section>

        {/* Profit Breakdown (5 cols) */}
        <section className="lg:col-span-5 rounded-xl border border-border bg-surface p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-primary" /> Margin Analysis
            </h3>
            <span className="text-[10px] text-muted">Performance</span>
          </div>

          {canSeeProfit ? (
            <div className="space-y-1.5 mt-2 text-xs">
              <div className="flex items-center justify-between p-1.5 rounded-lg bg-surface-muted/60">
                <span className="text-muted text-[11px]">Total Sales Revenue</span>
                <strong className="font-mono text-text">Rs. {(totalRevenuePaisa / 100).toFixed(0)}</strong>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded-lg bg-surface-muted/60">
                <span className="text-muted text-[11px]">Cost of Goods (COGS)</span>
                <strong className="font-mono text-text">
                  {totalCostPaisa === null ? '—' : `Rs. ${(totalCostPaisa / 100).toFixed(0)}`}
                </strong>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40">
                <span className="font-bold text-emerald-950 dark:text-emerald-200 text-[11px]">Net Gross Profit</span>
                <strong className="font-mono text-emerald-800 dark:text-emerald-300 font-black">
                  {grossProfitPaisa === null ? '—' : `Rs. ${(grossProfitPaisa / 100).toFixed(0)}`}
                </strong>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40">
                <span className="font-bold text-emerald-950 dark:text-emerald-200 text-[11px]">Gross Margin %</span>
                <strong className="font-mono text-emerald-800 dark:text-emerald-300 font-black">
                  {grossMarginPercent === null ? '—' : `${grossMarginPercent}%`}
                </strong>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-muted space-y-1">
              <EyeOff className="w-4 h-4 mx-auto text-muted" />
              <p className="font-semibold text-text">Restricted Financial Access</p>
              <p className="text-[10px]">Profit and margin details require Manager or Admin permissions.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
