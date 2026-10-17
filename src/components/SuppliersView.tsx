import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Plus, RefreshCw, Save, Truck, X } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { DEMO_DATA_CHANGED_EVENT } from '../data/demoDataManager';

interface Supplier {
  id: string;
  name: string;
  contact: string;
  address: string;
  licence_or_tax_number: string;
  payment_terms: string;
  is_active: boolean;
  created_at: string;
}

interface LedgerEntry {
  id: string;
  supplier_id: string;
  date: string;
  description: string;
  debit: number;   // amount owed to supplier (paisa)
  credit: number;  // amount paid to supplier (paisa)
  balance: number; // running balance (paisa) — positive = we owe them
}

type SupplierForm = Pick<
  Supplier,
  'name' | 'contact' | 'address' | 'licence_or_tax_number' | 'payment_terms'
>;

const EMPTY_FORM: SupplierForm = {
  name: '',
  contact: '',
  address: '',
  licence_or_tax_number: '',
  payment_terms: 'CASH',
};

const SUPPLIER_COLUMNS =
  'id, name, contact, address, licence_or_tax_number, payment_terms, is_active, created_at';

function describeError(error: { message: string; code?: string }): string {
  if (error.code === '42501' || error.code === 'PGRST301') {
    return 'Supabase denied this request. Check the suppliers table Row Level Security policies for this app user.';
  }
  return error.message;
}

function describeUnknownError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return describeError({
      message: String(error.message),
      code: 'code' in error ? String(error.code) : undefined,
    });
  }
  return 'The request could not be completed. Check your network connection and try again.';
}

function formatMoney(paisa: number): string {
  return `Rs ${(paisa / 100).toFixed(2)}`;
}

// ── Supplier Ledger panel ──────────────────────────────────────────────────
function SupplierLedger({ supplier }: { supplier: Supplier }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  // Simple manual ledger entry form (local only — stored in browser memory for now)
  const [addOpen, setAddOpen] = useState(false);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newDesc, setNewDesc] = useState('');
  const [newDebit, setNewDebit] = useState('');
  const [newCredit, setNewCredit] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      // Try to load from supplier_ledger table if it exists
      const { data, error: qErr } = await supabase
        .from('supplier_ledger')
        .select('*')
        .eq('supplier_id', supplier.id)
        .order('date', { ascending: true });
      if (qErr) {
        // table may not exist yet — show empty state gracefully
        setEntries([]);
      } else {
        setEntries((data as LedgerEntry[]) ?? []);
      }
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [supplier.id]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleAddEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      supplier_id: supplier.id,
      date: newDate,
      description: newDesc.trim(),
      debit: Math.round(parseFloat(newDebit || '0') * 100),
      credit: Math.round(parseFloat(newCredit || '0') * 100),
      balance: 0,
    };
    setEntries((prev) => {
      let running = prev.length > 0 ? prev[prev.length - 1].balance : 0;
      running += entry.debit - entry.credit;
      entry.balance = running;
      return [...prev, entry];
    });
    setNewDesc('');
    setNewDebit('');
    setNewCredit('');
    setAddOpen(false);
  };

  const runningBalance = entries.reduce((bal, e) => bal + e.debit - e.credit, 0);

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold text-text hover:bg-surface/60 transition"
      >
        <span className="flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 text-primary" />
          Supplier Ledger
          {runningBalance !== 0 && (
            <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${runningBalance > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {runningBalance > 0 ? `Owed: ${formatMoney(runningBalance)}` : `Advance: ${formatMoney(-runningBalance)}`}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-muted" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[500px] text-left text-xs">
              <thead className="bg-surface border-b border-border text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Debit (Owed)</th>
                  <th className="px-3 py-2 text-right">Credit (Paid)</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-muted">Loading…</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-muted">No ledger entries yet. Add one below.</td></tr>
                ) : entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-surface/40">
                    <td className="px-3 py-2 font-medium">{entry.date}</td>
                    <td className="px-3 py-2">{entry.description || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-700">{entry.debit > 0 ? formatMoney(entry.debit) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{entry.credit > 0 ? formatMoney(entry.credit) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${entry.balance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {formatMoney(Math.abs(entry.balance))} {entry.balance > 0 ? 'DR' : 'CR'}
                    </td>
                  </tr>
                ))}
              </tbody>
              {entries.length > 0 && (
                <tfoot className="bg-surface border-t border-border">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold text-text">Closing Balance</td>
                    <td className={`px-3 py-2 text-right font-mono font-black text-sm ${runningBalance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {formatMoney(Math.abs(runningBalance))} {runningBalance > 0 ? 'DR' : 'CR'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Add entry */}
          {!addOpen ? (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-control border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface"
            >
              <Plus className="h-3.5 w-3.5" /> Add Entry
            </button>
          ) : (
            <form onSubmit={handleAddEntry} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-semibold text-text">
                Date
                <input type="date" required value={newDate} onChange={(e) => setNewDate(e.target.value)} className="mt-1 w-full rounded-control border border-border px-2 py-1.5 font-normal text-text" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">
                Description
                <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Invoice, payment, etc." className="mt-1 w-full rounded-control border border-border px-2 py-1.5 font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">
                Debit / Owed (Rs)
                <input type="number" min="0" step="0.01" value={newDebit} onChange={(e) => setNewDebit(e.target.value)} placeholder="0.00" className="mt-1 w-full rounded-control border border-border px-2 py-1.5 font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">
                Credit / Paid (Rs)
                <input type="number" min="0" step="0.01" value={newCredit} onChange={(e) => setNewCredit(e.target.value)} placeholder="0.00" className="mt-1 w-full rounded-control border border-border px-2 py-1.5 font-normal" />
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" className="inline-flex items-center gap-1.5 rounded-control bg-primary px-3 py-1.5 text-xs font-bold text-white">
                  <Save className="h-3.5 w-3.5" /> Save Entry
                </button>
                <button type="button" onClick={() => setAddOpen(false)} className="inline-flex items-center gap-1.5 rounded-control border border-border px-3 py-1.5 text-xs font-semibold text-text">
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main SuppliersView ─────────────────────────────────────────────────────
export const SuppliersView: React.FC = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expandedLedger, setExpandedLedger] = useState<string | null>(null);
  const editingSupplier = suppliers.find((item) => item.id === editingId);

  const loadSuppliers = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the app.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('suppliers')
        .select(SUPPLIER_COLUMNS)
        .order('name', { ascending: true });

      if (queryError) {
        setError(describeError(queryError));
      } else {
        setSuppliers(data as Supplier[]);
      }
    } catch (queryError) {
      setError(describeUnknownError(queryError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSuppliers();
    const handleDemoChange = () => void loadSuppliers();
    window.addEventListener(DEMO_DATA_CHANGED_EVENT, handleDemoChange);
    return () => window.removeEventListener(DEMO_DATA_CHANGED_EVENT, handleDemoChange);
  }, [loadSuppliers]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the app.');
      return;
    }

    const name = form.name.trim();
    if (!name) {
      setError('Supplier name is required.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    const values: SupplierForm = {
      name,
      contact: form.contact.trim(),
      address: form.address.trim(),
      licence_or_tax_number: form.licence_or_tax_number.trim(),
      payment_terms: form.payment_terms.trim(),
    };

    try {
      const { error: saveError } = await supabase.rpc('save_supplier', {
        p_supplier_id: editingId,
        p_name: values.name,
        p_contact: values.contact,
        p_address: values.address,
        p_licence_or_tax_number: values.licence_or_tax_number,
        p_payment_terms: values.payment_terms,
      });
      if (saveError) throw saveError;
      setNotice(editingId ? 'Supplier updated.' : 'Supplier added.');
      resetForm();
      await loadSuppliers();
    } catch (saveError) {
      setError(describeUnknownError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const editSupplier = (supplier: Supplier) => {
    setForm({
      name: supplier.name,
      contact: supplier.contact,
      address: supplier.address,
      licence_or_tax_number: supplier.licence_or_tax_number,
      payment_terms: supplier.payment_terms,
    });
    setEditingId(supplier.id);
    setShowForm(true);
    setError('');
    setNotice('');
  };

  const deactivateSupplier = async (supplier: Supplier) => {
    if (!supabase) {
      setError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the app.');
      return;
    }
    if (!window.confirm(`Deactivate ${supplier.name}? The supplier record will be kept.`)) return;

    setError('');
    setNotice('');
    try {
      const { error: deactivateError } = await supabase.rpc('deactivate_supplier', {
        p_supplier_id: supplier.id,
      });
      if (deactivateError) throw deactivateError;

      setSuppliers((current) =>
        current.map((item) => item.id === supplier.id ? { ...item, is_active: false } : item)
      );
      setNotice('Supplier deactivated.');
    } catch (deactivateError) {
      setError(describeUnknownError(deactivateError));
    }
  };

  const activateSupplier = async (supplier: Supplier) => {
    if (!supabase) {
      setError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the app.');
      return;
    }

    setError('');
    setNotice('');
    try {
      const { error: activateError } = await supabase.rpc('activate_supplier', {
        p_supplier_id: supplier.id,
      });
      if (activateError) {
        // Fallback to direct update if RPC is pending migration
        const { error: directError } = await supabase
          .from('suppliers')
          .update({ is_active: true })
          .eq('id', supplier.id);
        if (directError) throw activateError;
      }

      setSuppliers((current) =>
        current.map((item) => item.id === supplier.id ? { ...item, is_active: true } : item)
      );
      setNotice(`Supplier ${supplier.name} activated.`);
    } catch (activateError) {
      setError(describeUnknownError(activateError));
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-4">
      {/* ── Page Header ────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-text">
            <Truck aria-hidden="true" className="h-5 w-5 text-primary" />
            Suppliers
          </h2>
          <p className="mt-0.5 text-xs text-muted">Manage supplier contacts, payment terms and ledger.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSuppliers()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-control border border-border bg-white px-3 py-2 text-xs font-semibold text-text hover:bg-surface disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Refresh
          </button>
          {supabase && (
            <button
              type="button"
              onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); setError(''); setNotice(''); }}
              className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2 text-xs font-bold text-white hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Add Supplier
            </button>
          )}
        </div>
      </header>

      {/* ── Alerts ─────────────────────────────────────────────────────── */}
      {error && (
        <p role="alert" className="rounded-control border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-control border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </p>
      )}

      {/* ── Add / Edit Form — shown only when showForm is true ─────────── */}
      {showForm && supabase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-border bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-text">{editingId ? 'Edit Supplier' : 'Add New Supplier'}</h3>
              <button type="button" onClick={resetForm} className="rounded-lg p-1 text-muted hover:bg-surface">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-semibold text-text">
                Supplier name *
                <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">
                Contact
                <input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">
                Licence / tax number
                <input value={form.licence_or_tax_number} onChange={(event) => setForm({ ...form, licence_or_tax_number: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">
                Payment terms
                <input value={form.payment_terms} onChange={(event) => setForm({ ...form, payment_terms: event.target.value })} placeholder="CASH, 7 days, 30 days" className="w-full rounded-control border border-border px-3 py-2 font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text sm:col-span-2">
                Address
                <textarea rows={2} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {editingSupplier && !editingSupplier.is_active && (
                  <button
                    type="button"
                    onClick={() => void activateSupplier(editingSupplier)}
                    className="inline-flex items-center gap-1.5 rounded-control border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    Activate supplier
                  </button>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 rounded-control border border-border px-3 py-2 text-xs font-semibold text-text">
                  <X aria-hidden="true" className="h-4 w-4" /> Cancel
                </button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                  {editingId
                    ? <Save aria-hidden="true" className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
                    : <Plus aria-hidden="true" className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />}
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add supplier'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ── Suppliers Table with embedded Ledger ───────────────────────── */}
      <div className="rounded-card border border-border bg-white shadow-xs overflow-hidden">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="bg-surface text-[10px] uppercase tracking-wide text-muted border-b border-border">
            <tr>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Licence / Tax No.</th>
              <th className="px-4 py-3">Payment terms</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Loading suppliers…</td></tr>
            ) : suppliers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  <span className="inline-flex items-center justify-center gap-2">
                    <Truck aria-hidden="true" className="h-5 w-5" />
                    No suppliers found. Click &quot;Add Supplier&quot; to create one.
                  </span>
                </td>
              </tr>
            ) : suppliers.map((supplier) => (
              <React.Fragment key={supplier.id}>
                <tr className={`border-t border-border ${!supplier.is_active ? 'bg-surface/60 text-muted' : 'hover:bg-surface/40 transition'}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-text">{supplier.name}</div>
                    <div className="mt-0.5 max-w-xs truncate text-[11px] text-muted">{supplier.address || 'No address'}</div>
                  </td>
                  <td className="px-4 py-3">{supplier.contact || '—'}</td>
                  <td className="px-4 py-3">{supplier.licence_or_tax_number || '—'}</td>
                  <td className="px-4 py-3">{supplier.payment_terms || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${supplier.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>
                      {supplier.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setExpandedLedger(expandedLedger === supplier.id ? null : supplier.id)}
                        className="rounded-control border border-border px-2 py-1.5 font-semibold text-primary hover:bg-surface flex items-center gap-1"
                        title="Toggle ledger"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => editSupplier(supplier)} className="rounded-control border border-border px-2.5 py-1.5 font-semibold text-text hover:bg-surface">
                        Edit
                      </button>
                      {supplier.is_active ? (
                        <button type="button" onClick={() => void deactivateSupplier(supplier)} className="rounded-control border border-red-200 px-2.5 py-1.5 font-semibold text-red-700 hover:bg-red-50">
                          Deactivate
                        </button>
                      ) : (
                        <button type="button" onClick={() => void activateSupplier(supplier)} className="rounded-control border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-100">
                          Activate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedLedger === supplier.id && (
                  <tr>
                    <td colSpan={6} className="bg-slate-50/50">
                      <SupplierLedger supplier={supplier} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
