import React, { useState } from 'react';
import {
  Activity,
  ShoppingBag,
  TrendingUp,
  Calendar,
  Wallet,
  AlertTriangle,
  BadgeAlert,
  ShoppingCart,
  History,
  Boxes,
  Plus,
  ArrowRight,
  RefreshCw,
  PackagePlus,
} from 'lucide-react';
import { BatchStatus, CompletedSale, Product, Customer, UserRole } from '../types/pharmacy';
import { salesForPeriod } from '../utils/salesReport';

interface DashboardViewProps {
  sales: CompletedSale[];
  products: Product[];
  customers: Customer[];
  currentRole: UserRole;
  currentUserName: string;
  onNavigate: (tab: any) => void;
  onOpenCloseDay: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  sales,
  products,
  customers,
  currentRole,
  currentUserName,
  onNavigate,
  onOpenCloseDay,
}) => {
  const currentDate = new Date();
  const targetDateKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
  const targetStorageKey = `pharmacare.salesTarget.${currentUserName}.${targetDateKey}`;
  const [salesTarget, setSalesTarget] = useState<number | null>(() => {
    try {
      const target = Number(localStorage.getItem(targetStorageKey));
      return Number.isFinite(target) && target > 0 ? target : null;
    } catch {
      return null;
    }
  });
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [targetError, setTargetError] = useState('');
  const [, setRefreshCount] = useState(0);

  const canCloseDay = currentRole === UserRole.ADMIN || currentRole === UserRole.MANAGER;
  const canViewProfit = currentRole === UserRole.ADMIN || currentRole === UserRole.ACCOUNTANT;
  const todaySales = salesForPeriod(sales, 'today');
  const monthlySales = salesForPeriod(sales, 'month');

  const todaySalesPKR = todaySales.reduce((sum, s) => sum + s.totalPaisa, 0) / 100;
  const cashSalesPKR =
    todaySales
      .filter((s) => s.paymentMethod === 'CASH')
      .reduce((sum, s) => sum + s.totalPaisa, 0) / 100;
  const creditSalesPKR =
    todaySales
      .filter((s) => s.paymentMethod === 'CREDIT')
      .reduce((sum, s) => sum + s.totalPaisa, 0) / 100;

  const todayProfitPKR = canViewProfit
    ? todaySales.reduce(
        (sum, sale) =>
          sum +
          sale.totalPaisa -
          sale.items.reduce(
            (itemSum, item) => itemSum + item.costPaisaPerUnit * item.quantityInUnit,
            0
          ),
        0
      ) / 100
    : null;

  const totalReceivablesPKR =
    customers.reduce((sum, c) => sum + c.currentBalancePaisa, 0) / 100;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nearExpiryCount = products.reduce(
    (sum, product) =>
      sum +
      product.batches.filter((batch) => {
        const expiry = new Date(batch.expiryDate);
        expiry.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
        return batch.quantitySmallestUnit > 0 &&
          batch.status !== BatchStatus.EXPIRED &&
          daysLeft >= 0 &&
          daysLeft <= 30;
      }).length,
    0
  );
  const expiredCount = products.reduce(
    (sum, product) =>
      sum +
      product.batches.filter((batch) => {
        const expiry = new Date(batch.expiryDate);
        expiry.setHours(0, 0, 0, 0);
        return batch.quantitySmallestUnit > 0 &&
          (batch.status === BatchStatus.EXPIRED || expiry < today);
      }).length,
    0
  );

  const lowStockCount = products.filter((p) => {
    const totalQty = p.batches.reduce((sum, b) => sum + b.quantitySmallestUnit, 0);
    return totalQty <= p.minStockAlert;
  }).length;

  return (
    <div className="space-y-6">
      {/* ── Greeting Banner ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            Assalam-o-Alaikum, {currentUserName.split(' ')[0]}!
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">Today's Summary</p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setRefreshCount((count) => count + 1)}
            aria-label="Refresh dashboard summary"
            title="Refresh dashboard summary"
            className="rounded-control border border-border bg-white p-2 text-muted hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {canCloseDay && (
            <button
              onClick={onOpenCloseDay}
              className="px-4 py-2 bg-primary hover:opacity-90 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition"
            >
              <span>Close Day</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── 5 Metric Cards Row (Matching Screenshot 1-4, 64) ───────────────── */}
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4 xl:grid-cols-7">
        {/* 1. Today's Sales */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              Today
            </span>
          </div>
          <div className="mt-3">
            <span className="text-[11px] font-medium text-slate-500 block">Today's Sales (Rs)</span>
            <span className="text-xl font-black text-slate-900 font-mono tracking-tight">
              Rs. {todaySalesPKR.toFixed(0)}
            </span>
          </div>
        </div>

        {/* 2. Today's Profit (Gross) */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-teal-500/10 text-teal-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
              Gross
            </span>
          </div>
          <div className="mt-3">
            <span className="text-[11px] font-medium text-slate-500 block">
              {canViewProfit ? "Today's Profit (Rs)" : "Today's Invoices"}
            </span>
            {canViewProfit ? (
              <span className="text-xl font-black text-slate-900 font-mono tracking-tight">
                Rs. {todayProfitPKR?.toFixed(0)}
              </span>
            ) : (
              <span className="text-sm font-bold text-slate-700 flex items-center gap-1">
                <Activity className="w-3.5 h-3.5" /> {todaySales.length} invoices
              </span>
            )}
          </div>
        </div>

        {/* 3. Monthly Sales */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
              This Month
            </span>
          </div>
          <div className="mt-3">
            <span className="text-[11px] font-medium text-slate-500 block">Monthly Sales (Rs)</span>
            <span className="text-xl font-black text-slate-900 font-mono tracking-tight">
              Rs. {monthlySales.reduce((sum, sale) => sum + sale.totalPaisa, 0) / 100}
            </span>
          </div>
        </div>

        {/* Near-expiry and expired stock alerts */}
        <div className="bg-white p-4 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-warning/10 text-warning flex items-center justify-center">
              <BadgeAlert className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-warning/10 text-text border border-warning/30">
              Watch
            </span>
          </div>
          <div className="mt-3">
            <span className="text-[11px] font-medium text-muted block">Near-Expiry Batches</span>
            <span className="text-xl font-black text-text font-mono">{nearExpiryCount}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-danger/10 text-danger flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-danger/10 text-danger border border-danger/20">
              Alert
            </span>
          </div>
          <div className="mt-3">
            <span className="text-[11px] font-medium text-muted block">Expired Batches</span>
            <span className="text-xl font-black text-danger font-mono">{expiredCount}</span>
          </div>
        </div>

        {/* 4. Total Receivables */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-orange-500/10 text-orange-600 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
              Pending
            </span>
          </div>
          <div className="mt-3">
            <span className="text-[11px] font-medium text-slate-500 block">
              Total Receivables (Rs)
            </span>
            <span className="text-xl font-black text-slate-900 font-mono tracking-tight">
              Rs. {totalReceivablesPKR.toFixed(0)}
            </span>
          </div>
        </div>

        {/* 5. Low Stock Products */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-red-500/10 text-red-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
              Alert
            </span>
          </div>
          <div className="mt-3">
            <span className="text-[11px] font-medium text-slate-500 block">Low Stock Products</span>
            <span
              className={`text-xl font-black font-mono tracking-tight ${
                lowStockCount > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {lowStockCount}
            </span>
          </div>
        </div>
      </div>

      {/* ── Cash Sales vs Credit Split Bar (Matching Screenshot 1) ─────────── */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-xs bg-emerald-500" />
          <span className="font-semibold text-slate-600">Cash Sales</span>
          <span className="font-mono font-bold text-slate-900">Rs. {cashSalesPKR.toFixed(0)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-xs bg-amber-500" />
          <span className="font-semibold text-slate-600">Credit</span>
          <span className="font-mono font-bold text-slate-900">
            Rs. {creditSalesPKR.toFixed(0)}
          </span>
        </div>
      </div>

      {/* ── Daily Sales Target Widget (Matching Screenshot 1) ───────────────── */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <Activity className="h-4 w-4 text-primary" />
          <span className="font-bold text-slate-800">Daily Sales Target</span>
          <span className="text-slate-400 text-[11px]">
            {salesTarget
              ? `Target: Rs ${salesTarget.toLocaleString('en-PK')} · Achieved: Rs ${todaySalesPKR.toLocaleString('en-PK')} (${Math.min(
                  100,
                  Math.round((todaySalesPKR / salesTarget) * 100)
                )}%)`
              : 'No target set. Click + Set Target to add a daily goal.'}
          </span>
          {salesTarget && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, (todaySalesPKR / salesTarget) * 100)}%` }}
              />
            </div>
          )}
        </div>

        <button
          onClick={() => setShowTargetModal(true)}
          className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Set Target
        </button>
      </div>

      {/* ── Quick Actions Grid (Matching Screenshot 2) ─────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-xs font-black text-slate-500 tracking-wider uppercase">
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          {/* New Sale Button (Vibrant Blue) */}
          <button
            onClick={() => onNavigate('pos')}
            className="p-5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/25 flex flex-col items-center justify-center gap-2 transition group"
          >
            <ShoppingCart className="w-6 h-6 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-bold">New Sale</span>
          </button>

          {/* Add Medicine */}
          <button
            onClick={() => onNavigate('products')}
            className="p-5 rounded-2xl bg-white hover:bg-surface border border-border text-text shadow-xs flex flex-col items-center justify-center gap-2 transition group"
          >
            <PackagePlus className="w-6 h-6 text-primary group-hover:scale-110 transition-transform" />
            <span className="text-sm font-bold">Add Medicine</span>
          </button>

          {/* Sales History */}
          <button
            onClick={() => onNavigate('sales-history')}
            className="p-5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 shadow-xs flex flex-col items-center justify-center gap-2 transition group"
          >
            <History className="w-6 h-6 text-slate-600 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-bold">Sales History</span>
          </button>

          {/* Inventory */}
          <button
            onClick={() => onNavigate('stock-inventory')}
            className="p-5 rounded-2xl bg-white hover:bg-surface border border-border text-text shadow-xs flex flex-col items-center justify-center gap-2 transition group"
          >
            <Boxes className="w-6 h-6 text-primary group-hover:scale-110 transition-transform" />
            <span className="text-sm font-bold">Inventory</span>
          </button>
        </div>
      </div>

      {/* Target Modal */}
      {showTargetModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="visual-modal-panel bg-white rounded-2xl max-w-xs w-full p-5 space-y-3">
            <h4 className="font-bold text-sm text-slate-900">Set Daily Sales Target</h4>
            <input
              type="number"
              placeholder="e.g. 50000"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              autoFocus
              aria-invalid={Boolean(targetError)}
            />
            {targetError && <p role="alert" className="text-xs text-danger">{targetError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowTargetModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const target = Number(targetInput);
                  if (!Number.isFinite(target) || target <= 0) {
                    setTargetError('Enter a sales target greater than zero.');
                    return;
                  }
                  try {
                    localStorage.setItem(targetStorageKey, String(target));
                    setSalesTarget(target);
                    setTargetError('');
                  } catch {
                    setTargetError('Could not save the target in this browser.');
                    return;
                  }
                  setShowTargetModal(false);
                }}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-lg"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
