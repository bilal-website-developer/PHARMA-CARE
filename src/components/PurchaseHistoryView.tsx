import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer, RefreshCw, X } from 'lucide-react';
import { UserRole } from '../types/pharmacy';
import { isAdminRole } from '../permissions';
import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';
import { dispatchStockChanged } from '../utils/stockAlertsEvents';
import { isDemoDataLoadedLocally, DEMO_DATA_CHANGED_EVENT } from '../data/demoDataManager';

interface HistoryItem {
  medicine_id: string;
  product_name: string;
  generic_name: string;
  unit_name: string;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  bonus_qty: number;
  conversion_factor: number;
  unit_cost_paisa: number;
  mrp_paisa: number;
  line_total_paisa: number;
}

interface PurchaseRow {
  id: string;
  pr_no: string;
  supplier_name: string;
  supplier_contact?: string;
  supplier_address?: string;
  invoice_number: string | null;
  purchase_date: string;
  subtotal_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  paid_paisa: number;
  due_paisa: number;
  payment_type: 'cash' | 'credit';
  status: 'posted' | 'cancelled' | 'void';
  notes: string | null;
  void_reason: string | null;
  created_by: string;
  created_at: string;
  item_count?: number;
  items?: HistoryItem[];
}

interface PurchaseHistoryResult {
  rows: PurchaseRow[];
  total_count: number;
  total_paisa: number;
  cash_paisa: number;
  cash_count: number;
  credit_paisa: number;
  credit_count: number;
  page: number;
  page_size: number | null;
}

interface PurchaseDetail extends PurchaseRow {
  items: HistoryItem[];
}

const PAGE_SIZE = 25;

function money(paisa: number) {
  const rupees = Math.floor(paisa / 100);
  const cents = String(Math.abs(paisa % 100)).padStart(2, '0');
  return `Rs ${rupees.toLocaleString('en-PK')}.${cents}`;
}

function karachiDate(value: string) {
  return new Intl.DateTimeFormat('en-PK', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00+05:00`));
}

function safeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

function karachiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function PurchaseHistoryView({ currentRole }: { currentRole: UserRole }) {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [summary, setSummary] = useState<PurchaseHistoryResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<PurchaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase.rpc('purchase_history', {
        p_search: search || null,
        p_payment_type: paymentType || null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_page: page,
        p_page_size: PAGE_SIZE,
        p_export: false,
      });
      if (queryError) throw queryError;
      const result = data as PurchaseHistoryResult;
      if (result.rows.length === 0 && isDemoDataLoadedLocally()) {
        const demoPurchase: PurchaseRow = {
          id: 'demo-pr-1',
          pr_no: 'PO-2026-0001',
          supplier_name: 'Premier Distributors Ltd',
          supplier_contact: '021-35681234',
          invoice_number: 'INV-PDL-9921',
          purchase_date: '2026-03-01',
          subtotal_paisa: 12500000,
          discount_paisa: 500000,
          total_paisa: 12000000,
          paid_paisa: 12000000,
          due_paisa: 0,
          payment_type: 'cash',
          status: 'posted',
          notes: 'Monthly bulk distributor stock delivery',
          void_reason: null,
          created_by: 'Ahmad',
          created_at: '2026-03-01T10:00:00Z',
          item_count: 2,
          items: [
            {
              medicine_id: 'DEMO-MED-001',
              product_name: 'Panadol 500mg',
              generic_name: 'Paracetamol',
              unit_name: 'Box (200 Tabs)',
              batch_number: 'PAN-2601',
              expiry_date: '2027-12-31',
              quantity: 120,
              bonus_qty: 0,
              conversion_factor: 200,
              unit_cost_paisa: 2800,
              mrp_paisa: 3500,
              line_total_paisa: 336000,
            },
            {
              medicine_id: 'DEMO-MED-002',
              product_name: 'Augmentin 625mg',
              generic_name: 'Amoxicillin + Clavulanic Acid',
              unit_name: 'Pack (14 Tabs)',
              batch_number: 'AUG-2642',
              expiry_date: '2027-08-31',
              quantity: 25,
              bonus_qty: 0,
              conversion_factor: 14,
              unit_cost_paisa: 39000,
              mrp_paisa: 48000,
              line_total_paisa: 975000,
            },
          ],
        };
        setRows([demoPurchase]);
        setSummary({
          rows: [demoPurchase],
          total_count: 1,
          total_paisa: 12000000,
          cash_paisa: 12000000,
          cash_count: 1,
          credit_paisa: 0,
          credit_count: 0,
          page: 1,
          page_size: PAGE_SIZE,
        });
      } else {
        setRows(result.rows);
        setSummary(result);
      }
    } catch (caught) {
      if (isDemoDataLoadedLocally()) {
        const demoPurchase: PurchaseRow = {
          id: 'demo-pr-1',
          pr_no: 'PO-2026-0001',
          supplier_name: 'Premier Distributors Ltd',
          supplier_contact: '021-35681234',
          invoice_number: 'INV-PDL-9921',
          purchase_date: '2026-03-01',
          subtotal_paisa: 12500000,
          discount_paisa: 500000,
          total_paisa: 12000000,
          paid_paisa: 12000000,
          due_paisa: 0,
          payment_type: 'cash',
          status: 'posted',
          notes: 'Monthly bulk distributor stock delivery',
          void_reason: null,
          created_by: 'Ahmad',
          created_at: '2026-03-01T10:00:00Z',
          item_count: 2,
        };
        setRows([demoPurchase]);
        setSummary({
          rows: [demoPurchase],
          total_count: 1,
          total_paisa: 12000000,
          cash_paisa: 12000000,
          cash_count: 1,
          credit_paisa: 0,
          credit_count: 0,
          page: 1,
          page_size: PAGE_SIZE,
        });
      } else {
        setError(getSupabaseErrorMessage(caught, 'Could not load purchase history.'));
      }
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, page, paymentType, search]);

  useEffect(() => {
    void load();
    const handleDemoChange = () => void load();
    window.addEventListener(DEMO_DATA_CHANGED_EVENT, handleDemoChange);
    return () => window.removeEventListener(DEMO_DATA_CHANGED_EVENT, handleDemoChange);
  }, [load]);

  const openDetail = async (purchase: PurchaseRow) => {
    if (!supabase) return setError('Supabase is not configured.');
    setDetailLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase.rpc('purchase_detail', { p_purchase_id: purchase.id });
      if (queryError) throw queryError;
      setSelected(data as PurchaseDetail);
    } catch (caught) {
      setError(getSupabaseErrorMessage(caught, 'Could not load purchase details.'));
    } finally {
      setDetailLoading(false);
    }
  };

  const exportFiltered = async () => {
    if (!supabase) return setError('Supabase is not configured.');
    setExporting(true);
    setError('');
    try {
      const XLSX = await import('@e965/xlsx');
      const { data, error: queryError } = await supabase.rpc('purchase_history', {
        p_search: search || null,
        p_payment_type: paymentType || null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_page: 1,
        p_page_size: PAGE_SIZE,
        p_export: true,
      });
      if (queryError) throw queryError;
      const result = data as PurchaseHistoryResult;
      const purchaseSheet = result.rows.map((purchase) => ({
        'PR-ID': purchase.pr_no,
        Date: karachiDate(purchase.purchase_date),
        Supplier: purchase.supplier_name,
        'Invoice No.': purchase.invoice_number ?? '',
        Items: purchase.item_count ?? purchase.items?.length ?? 0,
        Subtotal: money(purchase.subtotal_paisa),
        Discount: money(purchase.discount_paisa),
        Total: money(purchase.total_paisa),
        Payment: purchase.payment_type,
        Paid: money(purchase.paid_paisa),
        Due: money(purchase.due_paisa),
        'Created By': purchase.created_by,
        Status: purchase.status,
        Notes: purchase.notes ?? '',
      }));
      const itemSheet = result.rows.flatMap((purchase) => (purchase.items ?? []).map((item) => ({
        'PR-ID': purchase.pr_no,
        Product: item.product_name,
        Generic: item.generic_name,
        Unit: item.unit_name,
        Batch: item.batch_number,
        Expiry: item.expiry_date,
        Quantity: item.quantity,
        Bonus: item.bonus_qty,
        'Cost': money(item.unit_cost_paisa),
        'MRP': money(item.mrp_paisa),
        'Line Total': money(item.line_total_paisa),
      })));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(purchaseSheet), 'Purchases');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(itemSheet), 'Items');
      XLSX.writeFile(workbook, `purchase-history-${karachiToday()}.xlsx`);
    } catch (caught) {
      setError(getSupabaseErrorMessage(caught, 'Could not export purchase history.'));
    } finally {
      setExporting(false);
    }
  };

  const printPurchase = (purchase: PurchaseDetail) => {
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      setNotice('Allow pop-ups to print the purchase.');
      return;
    }
    const lineRows = purchase.items.map((item) => `<tr><td>${safeHtml(item.product_name)}<br><small>${safeHtml(item.generic_name)}</small></td><td>${safeHtml(item.batch_number)}</td><td>${safeHtml(item.expiry_date)}</td><td>${item.quantity}</td><td>${item.bonus_qty}</td><td>${money(item.unit_cost_paisa)}</td><td>${money(item.mrp_paisa)}</td><td>${money(item.line_total_paisa)}</td></tr>`).join('');
    printWindow.document.write(`<!doctype html><html><head><title>${safeHtml(purchase.pr_no)}</title><style>body{font:14px Arial,sans-serif;color:#173c2a;margin:32px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #147d43;padding-bottom:14px}header img{width:56px;height:56px;object-fit:contain}header .brand{display:flex;align-items:center;gap:12px}h1{margin:0;color:#147d43}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border:1px solid #c8e0d0;padding:8px;text-align:left}th{background:#e8f7ed}.totals{margin:20px 0 0 auto;width:280px}.totals div{display:flex;justify-content:space-between;padding:4px}small{color:#526e5e}</style></head><body><header><div class="brand"><img src="${safeHtml(window.location.origin)}/pharma-care-192.png" alt="Pharma Care logo"><div><h1>PHARMA CARE</h1><strong>Stock Purchase</strong></div></div><div><strong>${safeHtml(purchase.pr_no)}</strong><br>${safeHtml(karachiDate(purchase.purchase_date))}</div></header><p><strong>Supplier:</strong> ${safeHtml(purchase.supplier_name)}<br><strong>Contact:</strong> ${safeHtml(purchase.supplier_contact)}<br><strong>Invoice:</strong> ${safeHtml(purchase.invoice_number)}</p><table><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Bonus</th><th>Cost</th><th>MRP</th><th>Line total</th></tr></thead><tbody>${lineRows}</tbody></table><div class="totals"><div><span>Subtotal</span><strong>${money(purchase.subtotal_paisa)}</strong></div><div><span>Discount</span><strong>${money(purchase.discount_paisa)}</strong></div><div><span>Total</span><strong>${money(purchase.total_paisa)}</strong></div><div><span>Paid</span><strong>${money(purchase.paid_paisa)}</strong></div><div><span>Due</span><strong>${money(purchase.due_paisa)}</strong></div></div><p><strong>Notes:</strong> ${safeHtml(purchase.notes)}</p><script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  };

  const voidPurchase = async (purchase: PurchaseRow) => {
    const reason = window.prompt(`Enter the reason for voiding ${purchase.pr_no}:`)?.trim();
    if (!reason) return;
    if (!window.confirm(`Void ${purchase.pr_no}? This cannot be undone.`)) return;
    if (!supabase) return setError('Supabase is not configured.');
    setError('');
    try {
      const { error: voidError } = await supabase.rpc('void_purchase', {
        p_purchase_id: purchase.id,
        p_reason: reason,
      });
      if (voidError) throw voidError;
      dispatchStockChanged();
      setNotice(`${purchase.pr_no} was voided.`);
      await load();
      if (selected?.id === purchase.id) setSelected({ ...selected, status: 'void', void_reason: reason });
    } catch (caught) {
      setError(getSupabaseErrorMessage(caught, 'Could not void purchase.'));
    }
  };

  return (
    <section className="space-y-3">
      {/* Slim Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-white px-4 py-2.5 shadow-xs">
        <div>
          <h2 className="text-base font-black text-text">Purchase History</h2>
          <p className="text-xs text-muted">View and manage supplier stock-in orders and invoices</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void exportFiltered()}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-control bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{exporting ? 'Exporting…' : 'Export Excel'}</span>
          </button>
          <button
            type="button"
            aria-label="Refresh purchase history"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text hover:bg-border/30 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Slim KPI Tiles (Single Row) */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="rounded-card border border-border bg-white px-3.5 py-2 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Total Purchases</span>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-sm font-black text-text">{money(summary?.total_paisa ?? 0)}</span>
            <span className="text-[11px] text-muted">{summary?.total_count ?? 0} orders</span>
          </div>
        </div>
        <div className="rounded-card border border-border bg-white px-3.5 py-2 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Cash Purchases</span>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-sm font-black text-emerald-700">{money(summary?.cash_paisa ?? 0)}</span>
            <span className="text-[11px] text-muted">{summary?.cash_count ?? 0} orders</span>
          </div>
        </div>
        <div className="rounded-card border border-border bg-white px-3.5 py-2 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Credit Purchases</span>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-sm font-black text-amber-700">{money(summary?.credit_paisa ?? 0)}</span>
            <span className="text-[11px] text-muted">{summary?.credit_count ?? 0} orders</span>
          </div>
        </div>
      </div>

      {/* Filter and Table Card */}
      <section className="space-y-2.5 rounded-card border border-border bg-white p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
            }}
            className="flex min-w-[200px] flex-1 items-center gap-1.5"
          >
            <input
              aria-label="Search by purchase ID or supplier"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search PR-ID or supplier…"
              className="h-8 min-w-0 flex-1 rounded-control border border-border bg-surface px-2.5 text-xs text-text placeholder:text-muted"
            />
            <button
              type="submit"
              className="h-8 rounded-control border border-border bg-white px-2.5 text-xs font-semibold text-text hover:bg-surface"
            >
              Search
            </button>
          </form>

          <select
            aria-label="Payment filter"
            value={paymentType}
            onChange={(event) => {
              setPaymentType(event.target.value);
              setPage(1);
            }}
            className="h-8 rounded-control border border-border bg-surface px-2.5 text-xs font-medium text-text"
          >
            <option value="">All Payments</option>
            <option value="cash">Cash</option>
            <option value="credit">Credit</option>
          </select>

          <div className="flex items-center gap-1 text-[11px] font-semibold text-muted">
            <span>From:</span>
            <input
              aria-label="Date from"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
              className="h-8 rounded-control border border-border bg-surface px-2 text-xs text-text"
            />
          </div>

          <div className="flex items-center gap-1 text-[11px] font-semibold text-muted">
            <span>To:</span>
            <input
              aria-label="Date to"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
              className="h-8 rounded-control border border-border bg-surface px-2 text-xs text-text"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setPaymentType('');
              setDateFrom('');
              setDateTo('');
              setPage(1);
            }}
            className="h-8 rounded-control border border-border px-2.5 text-xs font-semibold text-muted hover:bg-surface hover:text-text"
          >
            Clear
          </button>
        </div>

        {notice && <p role="status" className="text-xs font-semibold text-primary">{notice}</p>}
        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="font-bold underline">
              Retry
            </button>
          </div>
        )}

        <div className="overflow-x-auto rounded-control border border-border">
          <table className="w-full min-w-[1050px] text-left text-xs">
            <thead className="border-b border-border bg-surface text-[10px] font-bold uppercase tracking-wider text-muted">
              <tr>
                {['PR-ID', 'Date', 'Supplier', 'Items', 'Total', 'Discount', 'Payment', 'Paid', 'Due', 'Created By', 'Status'].map((label) => (
                  <th key={label} className="px-3 py-2">
                    {label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 5 }, (_, index) => (
                  <tr key={index}>
                    <td colSpan={12} className="visual-skeleton h-9 px-3" />
                  </tr>
                ))
              ) : error ? null : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-xs text-muted">
                    No purchases found.
                  </td>
                </tr>
              ) : (
                rows.map((purchase) => (
                  <tr
                    key={purchase.id}
                    className="cursor-pointer transition-colors hover:bg-surface/60"
                    onClick={() => void openDetail(purchase)}
                  >
                    <td className="px-3 py-2 font-mono font-bold text-primary">{purchase.pr_no}</td>
                    <td className="px-3 py-2 text-muted">{karachiDate(purchase.purchase_date)}</td>
                    <td className="px-3 py-2 font-medium text-text">{purchase.supplier_name}</td>
                    <td className="px-3 py-2 text-center text-muted">{purchase.item_count}</td>
                    <td className="px-3 py-2 font-bold text-text">{money(purchase.total_paisa)}</td>
                    <td className="px-3 py-2 text-muted">{money(purchase.discount_paisa)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                          purchase.payment_type === 'cash'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {purchase.payment_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">{money(purchase.paid_paisa)}</td>
                    <td className="px-3 py-2 font-semibold text-amber-700">{money(purchase.due_paisa)}</td>
                    <td className="px-3 py-2 text-muted">{purchase.created_by}</td>
                    <td className="px-3 py-2 capitalize text-muted">{purchase.status}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openDetail(purchase);
                        }}
                        className="rounded-control border border-border px-2 py-0.5 text-[11px] font-semibold text-text hover:bg-surface"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center justify-between text-[11px] text-muted">
          <span>
            {summary?.total_count ?? 0} purchases · Page {page} of{' '}
            {Math.max(1, Math.ceil((summary?.total_count ?? 0) / PAGE_SIZE))}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => current - 1)}
              className="rounded-control border border-border p-1 hover:bg-surface disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              disabled={page >= Math.ceil((summary?.total_count ?? 0) / PAGE_SIZE) || loading}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-control border border-border p-1 hover:bg-surface disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </footer>
      </section>

      {(selected || detailLoading) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="purchase-detail-title" className="max-h-[90vh] w-full max-w-5xl space-y-4 overflow-auto rounded-card border border-border bg-surface p-5 shadow-xl">
          {detailLoading ? <p className="py-12 text-center text-muted">Loading purchase details…</p> : selected && <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 id="purchase-detail-title" className="text-lg font-black text-text">{selected.pr_no}</h3><p className="text-sm text-muted">{selected.supplier_name} · {karachiDate(selected.purchase_date)}</p></div>
              <div className="flex gap-2">
                <button type="button" onClick={() => printPurchase(selected)} className="rounded-control border border-border px-3 py-2 text-sm font-semibold"><Printer className="mr-1 inline h-4 w-4" /> Print</button>
                {isAdminRole(currentRole) && selected.status === 'posted' && <button type="button" onClick={() => void voidPurchase(selected)} className="rounded-control border border-red-200 px-3 py-2 text-sm font-semibold text-danger">Void purchase</button>}
                <button type="button" aria-label="Close purchase details" onClick={() => setSelected(null)} className="rounded-control border border-border p-2"><X size={16} /></button>
              </div>
            </header>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p><strong>Supplier:</strong> {selected.supplier_name}<br />{selected.supplier_contact}<br />{selected.supplier_address}</p>
              <p><strong>Supplier invoice:</strong> {selected.invoice_number || '—'}<br /><strong>Payment:</strong> <span className="capitalize">{selected.payment_type}</span><br /><strong>Created by:</strong> {selected.created_by}</p>
            </div>
            <div className="overflow-x-auto rounded-control border border-border">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="bg-white text-muted"><tr>{['Product', 'Batch', 'Expiry', 'Qty', 'Bonus', 'Cost', 'MRP', 'Line Total'].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">{selected.items.map((item, index) => <tr key={`${item.medicine_id}-${item.batch_number}-${index}`}>
                  <td className="px-3 py-2">{item.product_name}<small className="block text-muted">{item.generic_name} · {item.unit_name}</small></td><td className="px-3 py-2">{item.batch_number}</td><td className="px-3 py-2">{karachiDate(item.expiry_date)}</td><td className="px-3 py-2">{item.quantity}</td><td className="px-3 py-2">{item.bonus_qty}</td><td className="px-3 py-2">{money(item.unit_cost_paisa)}</td><td className="px-3 py-2">{money(item.mrp_paisa)}</td><td className="px-3 py-2">{money(item.line_total_paisa)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="space-y-1 text-right text-sm"><p>Subtotal: {money(selected.subtotal_paisa)}</p><p>Discount: {money(selected.discount_paisa)}</p><p className="text-lg font-black">Total: {money(selected.total_paisa)}</p><p>Paid: {money(selected.paid_paisa)} · Due: {money(selected.due_paisa)}</p></div>
            <p className="text-sm"><strong>Notes:</strong> {selected.notes || '—'}</p>
            {selected.void_reason && <p className="text-sm text-danger"><strong>Void reason:</strong> {selected.void_reason}</p>}
          </>}
        </section>
      </div>}
    </section>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <section className="rounded-card border border-border bg-white p-4 shadow-sm"><p className="text-[10px] font-bold tracking-wide text-muted">{label}</p><p className="mt-1 text-lg font-black text-text">{value}</p>{detail && <p className="mt-1 text-xs text-muted">{detail}</p>}</section>;
}
