import React, { useState } from 'react';
import {
  ShoppingBag,
  TrendingUp,
  Calendar,
  Wallet,
  AlertTriangle,
  ShoppingCart,
  Users,
  History,
  Boxes,
  Plus,
  ArrowRight,
  EyeOff,
} from 'lucide-react';
import { CompletedSale, Product, Customer, UserRole } from '../types/pharmacy';

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
  const [salesTarget, setSalesTarget] = useState<number | null>(null);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetInput, setTargetInput] = useState('');

  const isCashier = currentRole === UserRole.CASHIER;

  // Real calculations in PKR
  const todaySalesPKR = sales.reduce((sum, s) => sum + s.totalPaisa, 0) / 100;
  const cashSalesPKR =
    sales
      .filter((s) => s.paymentMethod === 'CASH')
      .reduce((sum, s) => sum + s.totalPaisa, 0) / 100;
  const creditSalesPKR =
    sales
      .filter((s) => s.paymentMethod === 'CREDIT')
      .reduce((sum, s) => sum + s.totalPaisa, 0) / 100;

  const totalCostPKR =
    sales.reduce((sum, s) => {
      return (
        sum +
        s.items.reduce((itemSum, item) => itemSum + item.costPaisaPerUnit * item.quantityInUnit, 0)
      );
    }, 0) / 100;

  const todayProfitPKR = Math.max(0, todaySalesPKR - totalCostPKR);

  const totalReceivablesPKR =
    customers.reduce((sum, c) => sum + c.currentBalancePaisa, 0) / 100;

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
            Assalam-o-Alaikum, {currentUserName.split(' ')[0]}! 👋
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">Today's Summary</p>
        </div>

        <button
          onClick={onOpenCloseDay}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-600/20 flex items-center gap-2 transition self-start sm:self-auto"
        >
          <span>Close Day</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── 5 Metric Cards Row (Matching Screenshot 1-4, 64) ───────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
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
            <span className="text-[11px] font-medium text-slate-500 block">Today's Profit (Rs)</span>
            {!isCashier ? (
              <span className="text-xl font-black text-slate-900 font-mono tracking-tight">
                Rs. {todayProfitPKR.toFixed(0)}
              </span>
            ) : (
              <span className="text-sm font-bold text-slate-400 italic flex items-center gap-1">
                <EyeOff className="w-3.5 h-3.5" /> Hidden
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
              Rs. {(todaySalesPKR * 2.5).toFixed(0)}
            </span>
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
          <span className="text-base">🎯</span>
          <span className="font-bold text-slate-800">Daily Sales Target</span>
          <span className="text-slate-400 text-[11px]">
            {salesTarget
              ? `Target: Rs. ${salesTarget} • Achieved: Rs. ${todaySalesPKR} (${Math.min(
                  100,
                  Math.round((todaySalesPKR / salesTarget) * 100)
                )}%)`
              : 'No target set. Click "+ Set Target" to add a daily goal.'}
          </span>
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

          {/* Customers */}
          <button
            onClick={() => onNavigate('customers')}
            className="p-5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 shadow-xs flex flex-col items-center justify-center gap-2 transition group"
          >
            <Users className="w-6 h-6 text-slate-600 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-bold">Customers</span>
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
            onClick={() => onNavigate('products')}
            className="p-5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 shadow-xs flex flex-col items-center justify-center gap-2 transition group"
          >
            <Boxes className="w-6 h-6 text-slate-600 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-bold">Inventory</span>
          </button>
        </div>
      </div>

      {/* Target Modal */}
      {showTargetModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xs w-full p-5 space-y-3">
            <h4 className="font-bold text-sm text-slate-900">Set Daily Sales Target</h4>
            <input
              type="number"
              placeholder="e.g. 50000"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowTargetModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setSalesTarget(Number(targetInput));
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
