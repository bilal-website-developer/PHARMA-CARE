import React, { useMemo, useState } from 'react';
import { EyeOff, Filter, Printer, Receipt, Search, ShoppingBag, TrendingUp, X } from 'lucide-react';
import { CompletedSale, UserRole } from '../types/pharmacy';
import { PrintSalesReport } from './PrintSalesReport';

interface SalesHistoryViewProps {
  sales: CompletedSale[];
  currentRole: UserRole;
  storeName?: string;
  address?: string;
  phone?: string;
  generatedBy?: string;
}

export const SalesHistoryView: React.FC<SalesHistoryViewProps> = ({
  sales,
  currentRole,
  storeName = '',
  address,
  phone,
  generatedBy = '',
}) => {
  const canSeeProfit = currentRole === UserRole.ADMIN || currentRole === UserRole.SUPER_ADMIN || currentRole === UserRole.ACCOUNTANT;
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<'ALL' | 'CASH' | 'CREDIT'>('ALL');

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((sale) => {
      if (methodFilter !== 'ALL' && sale.paymentMethod !== methodFilter) {
        return false;
      }
      if (!q) return true;
      return (
        sale.invoiceNumber.toLowerCase().includes(q) ||
        (sale.customerName ? sale.customerName.toLowerCase().includes(q) : false) ||
        sale.cashierName.toLowerCase().includes(q) ||
        sale.items.some((item) => item.productName.toLowerCase().includes(q))
      );
    });
  }, [sales, search, methodFilter]);

  const totalRevenuePaisa = useMemo(() => sales.reduce((sum, s) => sum + s.totalPaisa, 0), [sales]);
  const hasCompleteSaleCosts = useMemo(
    () => sales.every((sale) => sale.items.every((item) => item.costPaisaPerUnit !== null)),
    [sales]
  );
  const totalCostPaisa = useMemo(
    () =>
      canSeeProfit && hasCompleteSaleCosts
        ? sales.reduce(
            (sum, sale) =>
              sum +
              sale.items.reduce(
                (itemSum, item) => itemSum + (item.costPaisaPerUnit ?? 0) * item.quantityInUnit,
                0
              ),
            0
          )
        : null,
    [canSeeProfit, hasCompleteSaleCosts, sales]
  );

  const grossProfitPaisa = totalCostPaisa === null ? null : totalRevenuePaisa - totalCostPaisa;
  const grossMarginPercent =
    grossProfitPaisa === null
      ? null
      : totalRevenuePaisa > 0
      ? ((grossProfitPaisa / totalRevenuePaisa) * 100).toFixed(1)
      : '0.0';

  const cashSalesPaisa = useMemo(
    () => sales.filter((s) => s.paymentMethod === 'CASH').reduce((sum, s) => sum + s.totalPaisa, 0),
    [sales]
  );
  const creditSalesPaisa = useMemo(
    () => sales.filter((s) => s.paymentMethod === 'CREDIT').reduce((sum, s) => sum + s.totalPaisa, 0),
    [sales]
  );

  return (
    <div className="space-y-3">
      {/* ── Compact Header & Filter Row ── */}
      <section className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-black text-text">Sales History</h2>
          <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold px-2.5 py-0.5 text-[11px]">
            {sales.length} total orders
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative min-w-[200px] sm:min-w-[260px]">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice, customer, medicine..."
              className="w-full rounded-control border border-border bg-surface pl-8 pr-7 py-1.5 text-xs text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-2 text-muted hover:text-text"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex rounded-control border border-border bg-surface p-0.5 text-xs font-semibold">
            {(['ALL', 'CASH', 'CREDIT'] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setMethodFilter(method)}
                className={`rounded px-2.5 py-1 text-[11px] transition ${
                  methodFilter === method
                    ? 'bg-primary text-white font-bold shadow-2xs'
                    : 'text-muted hover:text-text'
                }`}
              >
                {method}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5 Small Slim KPI Tiles in Single Row ── */}
      <section aria-label="Sales KPI strip" className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 text-xs">
        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium">Gross Revenue</span>
          <strong className="font-mono font-black text-xs text-text">
            Rs. {(totalRevenuePaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium">Total Invoices</span>
          <strong className="font-mono font-black text-xs text-text">{sales.length}</strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium">Cash Sales</span>
          <strong className="font-mono font-black text-xs text-emerald-700 dark:text-emerald-400">
            Rs. {(cashSalesPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium">Credit Sales</span>
          <strong className="font-mono font-black text-xs text-amber-700 dark:text-amber-400">
            Rs. {(creditSalesPaisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs col-span-2 sm:col-span-1">
          <span className="text-muted font-medium">Gross Margin</span>
          <strong className="font-mono font-black text-xs text-primary">
            {canSeeProfit && grossMarginPercent !== null ? `${grossMarginPercent}%` : '—'}
          </strong>
        </div>
      </section>

      {/* ── Recent Sales History Table ── */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden shadow-2xs">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between bg-surface-muted/30">
          <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
            <ShoppingBag className="w-3.5 h-3.5 text-primary" /> Sales Transactions
          </h3>
          <span className="text-[11px] text-muted font-medium">
            Showing {filteredSales.length} of {sales.length}
          </span>
        </div>

        <div className="overflow-x-auto max-h-[380px]">
          <table className="w-full text-xs text-left">
            <thead className="bg-surface border-b border-border text-muted font-bold text-[10px] uppercase tracking-wider sticky top-0 z-10">
              <tr>
                <th className="py-2 px-3">Invoice #</th>
                <th className="py-2 px-3">Date & Time</th>
                <th className="py-2 px-3">Customer</th>
                <th className="py-2 px-3">Cashier</th>
                <th className="py-2 px-3">Medicines / Items</th>
                <th className="py-2 px-3">Method</th>
                <th className="py-2 px-3 text-right">Total (PKR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredSales.map((sale) => (
                <tr key={sale.id} className="hover:bg-primary/5 transition">
                  <td className="py-2 px-3 font-mono font-bold text-primary whitespace-nowrap">
                    {sale.invoiceNumber}
                  </td>
                  <td className="py-2 px-3 text-muted text-[11px] font-mono whitespace-nowrap">{sale.timestamp}</td>
                  <td className="py-2 px-3 font-medium text-text">{sale.customerName}</td>
                  <td className="py-2 px-3 text-muted text-[11px]">{sale.cashierName}</td>
                  <td className="py-2 px-3 text-text max-w-xs truncate" title={sale.items.map((i) => `${i.productName} (x${i.quantityInUnit})`).join(', ')}>
                    {sale.items.map((i) => `${i.productName} (x${i.quantityInUnit})`).join(', ')}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                      sale.paymentMethod === 'CASH'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    }`}>
                      {sale.paymentMethod}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-text whitespace-nowrap">
                    Rs. {(sale.totalPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-muted">
                    {search || methodFilter !== 'ALL'
                      ? 'No sales match the applied search filter.'
                      : 'No sales recorded yet. Process an order on the POS counter to populate this report.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Print Sales Report & Profitability Summary Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        <div className="lg:col-span-8">
          <PrintSalesReport
            sales={sales}
            storeName={storeName}
            address={address}
            phone={phone}
            generatedBy={generatedBy}
          />
        </div>

        {/* Side Panel: Gross Profit & Gross Margin % */}
        <aside className="lg:col-span-4 rounded-xl border border-border bg-surface p-3.5 shadow-2xs flex flex-col justify-between text-xs">
          <div>
            <div className="flex items-center gap-1.5 pb-2 border-b border-border">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
              <h4 className="font-bold text-xs text-text">Profitability Summary</h4>
            </div>

            {canSeeProfit ? (
              <div className="mt-2.5 space-y-2">
                <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50">
                  <span className="text-[10px] font-semibold text-emerald-900 dark:text-emerald-300 block">Gross Profit</span>
                  <strong className="text-base font-mono font-black text-emerald-800 dark:text-emerald-200 block">
                    {grossProfitPaisa === null ? 'Unavailable' : `Rs. ${(grossProfitPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`}
                  </strong>
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400">Revenue minus cost of goods sold</span>
                </div>

                <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50">
                  <span className="text-[10px] font-semibold text-emerald-900 dark:text-emerald-300 block">Gross Margin %</span>
                  <strong className="text-base font-mono font-black text-emerald-800 dark:text-emerald-200 block">
                    {grossMarginPercent === null ? 'Unavailable' : `${grossMarginPercent}%`}
                  </strong>
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400">Profit percentage of total sales</span>
                </div>
              </div>
            ) : (
              <div className="mt-3 p-3 rounded-lg bg-surface-muted/50 border border-border text-center text-xs text-muted space-y-1">
                <EyeOff className="w-4 h-4 mx-auto text-muted" />
                <p className="font-semibold text-text">Restricted Access</p>
                <p className="text-[10px]">Profit & margin data restricted for current role.</p>
              </div>
            )}
          </div>

          <p className="text-[10px] text-muted mt-2 pt-2 border-t border-border">
            Calculated across {sales.length} transactions.
          </p>
        </aside>
      </div>
    </div>
  );
};
