import React, { useState, useMemo } from 'react';
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  CheckCircle2,
  Lock,
  Search,
  X,
} from 'lucide-react';
import { CashTransaction } from '../types/pharmacy';

interface CashBookScreenProps {
  transactions: CashTransaction[];
  onAddTransaction: (tx: CashTransaction) => void;
}

export const CashBookScreen: React.FC<CashBookScreenProps> = ({
  transactions,
  onAddTransaction,
}) => {
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmountPKR, setExpenseAmountPKR] = useState<number>(0);
  const [search, setSearch] = useState('');

  // Shift closing drawer count
  const [actualDrawerCashPKR, setActualDrawerCashPKR] = useState<number>(0);
  const [shiftClosed, setShiftClosed] = useState(false);

  const totalInflowsPaisa = useMemo(() => {
    return transactions
      .filter((t) => !t.isOutflow)
      .reduce((sum, t) => sum + t.amountPaisa, 0);
  }, [transactions]);

  const totalOutflowsPaisa = useMemo(() => {
    return transactions
      .filter((t) => t.isOutflow)
      .reduce((sum, t) => sum + t.amountPaisa, 0);
  }, [transactions]);

  const expectedDrawerPaisa = totalInflowsPaisa - totalOutflowsPaisa;
  const actualDrawerPaisa = actualDrawerCashPKR * 100;
  const discrepancyPaisa = actualDrawerPaisa - expectedDrawerPaisa;

  const filteredTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter(
      (t) =>
        t.description.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q) ||
        t.handledBy.toLowerCase().includes(q)
    );
  }, [transactions, search]);

  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseDesc || expenseAmountPKR <= 0) return;

    const newTx: CashTransaction = {
      id: `tx-${Date.now()}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'EXPENSE',
      description: expenseDesc,
      amountPaisa: expenseAmountPKR * 100,
      isOutflow: true,
      handledBy: 'Active Cashier',
    };

    onAddTransaction(newTx);
    setShowExpenseModal(false);
    setExpenseDesc('');
    setExpenseAmountPKR(0);
  };

  return (
    <div className="space-y-3">
      {/* ── Slim Header ── */}
      <section className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="text-xl font-black text-text flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" /> Cash Book & Expenses
          </h2>
          <p className="text-xs text-muted">Drawer cash inflows, petty cash expenses, and shift closing.</p>
        </div>

        <button
          onClick={() => setShowExpenseModal(true)}
          className="px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-control flex items-center gap-1.5 transition shadow-2xs"
        >
          <Plus size={14} /> Record Cash Expense
        </button>
      </section>

      {/* ── 4 Slim KPI Tiles in Single Row ── */}
      <section aria-label="Cash book KPI strip" className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-1.5 text-muted font-medium">
            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
            <span>Cash Inflows</span>
          </div>
          <strong className="font-mono font-black text-xs text-emerald-700 dark:text-emerald-400">
            Rs {(totalInflowsPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-1.5 text-muted font-medium">
            <ArrowUpRight className="w-3.5 h-3.5 text-red-600" />
            <span>Cash Expenses</span>
          </div>
          <strong className="font-mono font-black text-xs text-red-600 dark:text-red-400">
            Rs {(totalOutflowsPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-1.5 text-muted font-medium">
            <Wallet className="w-3.5 h-3.5 text-primary" />
            <span>Expected in Drawer</span>
          </div>
          <strong className="font-mono font-black text-xs text-text">
            Rs {(expectedDrawerPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2 flex items-center justify-between shadow-2xs">
          <span className="text-muted font-medium">Shift Status</span>
          <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
            shiftClosed
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
          }`}>
            {shiftClosed ? 'Closed & Locked' : 'Active Shift'}
          </span>
        </div>
      </section>

      {/* ── Main Split: Transactions List & Shift Closing ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Left 8 Cols: Transaction Log */}
        <div className="lg:col-span-8 bg-surface rounded-xl border border-border shadow-2xs overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex flex-wrap items-center justify-between gap-2 bg-surface-muted/30">
            <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-primary" /> Cash Book Entries ({filteredTransactions.length})
            </h3>

            <div className="relative min-w-[180px]">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter entries..."
                className="w-full rounded-control border border-border bg-surface pl-8 pr-7 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1.5 text-muted hover:text-text"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[380px]">
            <table className="w-full text-xs text-left">
              <thead className="bg-surface border-b border-border text-muted font-bold text-[10px] uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Description</th>
                  <th className="py-2 px-3">Handled By</th>
                  <th className="py-2 px-3 text-right">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTransactions.map((t) => (
                  <tr key={t.id} className="hover:bg-primary/5 transition">
                    <td className="py-2 px-3 font-mono text-[11px] text-muted whitespace-nowrap">{t.time}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.isOutflow
                            ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}
                      >
                        {t.type}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-text font-medium">{t.description}</td>
                    <td className="py-2 px-3 text-muted text-[11px]">{t.handledBy}</td>
                    <td
                      className={`py-2 px-3 text-right font-mono font-bold whitespace-nowrap ${
                        t.isOutflow ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {t.isOutflow ? '-' : '+'} Rs {(t.amountPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {filteredTransactions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-muted">
                      No cash transactions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 4 Cols: Shift Closing Drawer Count */}
        <div className="lg:col-span-4 bg-surface p-3.5 rounded-xl border border-border shadow-2xs space-y-3 text-xs">
          <div className="pb-2 border-b border-border">
            <h3 className="font-bold text-xs text-text flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-primary" /> Shift Closing Reconciliation
            </h3>
            <p className="text-[11px] text-muted mt-0.5">
              Count cash notes in drawer at end of shift.
            </p>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block font-semibold text-text mb-1 text-[11px]">
                Physical Cash in Drawer (PKR):
              </label>
              <input
                type="number"
                placeholder="Count physical notes"
                value={actualDrawerCashPKR || ''}
                onChange={(e) => setActualDrawerCashPKR(Number(e.target.value))}
                className="w-full px-3 py-1.5 border border-border bg-surface rounded-control text-sm font-mono font-bold text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                disabled={shiftClosed}
              />
            </div>

            <div className="p-2.5 bg-surface-muted/60 rounded-lg border border-border space-y-1.5 text-xs font-mono">
              <div className="flex justify-between text-muted">
                <span>System Expected:</span>
                <span className="font-bold text-text">Rs {(expectedDrawerPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Physical Count:</span>
                <span className="font-bold text-text">Rs {(actualDrawerPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="border-t border-border pt-1.5 flex justify-between font-bold">
                <span className="text-text">Discrepancy:</span>
                <span
                  className={
                    discrepancyPaisa === 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : discrepancyPaisa > 0
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                >
                  {discrepancyPaisa > 0 ? '+' : ''}
                  Rs {(discrepancyPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                  {discrepancyPaisa < 0 && ' (SHORT)'}
                  {discrepancyPaisa > 0 && ' (OVER)'}
                </span>
              </div>
            </div>

            {shiftClosed ? (
              <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 rounded-lg text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                Shift closed and reconciled. Drawer locked.
              </div>
            ) : (
              <button
                onClick={() => setShiftClosed(true)}
                disabled={actualDrawerCashPKR <= 0}
                className="w-full py-2 px-3 bg-primary hover:opacity-90 text-white font-bold rounded-control transition disabled:opacity-50 text-xs shadow-2xs"
              >
                Close Shift & Lock Register
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Record Expense Modal ──────────────────────────────────────────── */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateExpense}
            className="bg-surface rounded-2xl max-w-sm w-full p-5 border border-border shadow-xl space-y-3.5"
          >
            <h3 className="font-bold text-sm text-text flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-red-600" /> Record Cash Expense Voucher
            </h3>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="block font-semibold text-text mb-1">Expense Description *</label>
                <input
                  type="text"
                  placeholder="e.g. Electricity bill, cleaning supplies, tea"
                  value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  className="w-full px-3 py-1.5 border border-border bg-surface rounded-control text-xs text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-semibold text-text mb-1">Amount (PKR) *</label>
                <input
                  type="number"
                  placeholder="0"
                  value={expenseAmountPKR || ''}
                  onChange={(e) => setExpenseAmountPKR(Number(e.target.value))}
                  className="w-full px-3 py-1.5 border border-border bg-surface rounded-control text-xs font-mono font-bold text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="px-3 py-1.5 text-xs font-semibold text-muted hover:text-text rounded-control"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-control shadow-2xs"
              >
                Deduct from Drawer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
