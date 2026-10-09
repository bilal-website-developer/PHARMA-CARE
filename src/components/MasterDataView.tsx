import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { Edit2, Layers, Plus, RefreshCw, Tag, Trash2, X } from 'lucide-react';
import { usePermissions } from '../permissions';
import { fetchAllSupabaseRows } from '../utils/fetchAllSupabaseRows';
import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';

type MasterTab = 'categories' | 'brands' | 'units';
type MasterKind = 'category' | 'brand';

interface MasterValue {
  id: string;
  name: string;
  is_active: boolean;
  productCount: number;
}

interface UnitRow {
  id: string;
  medicine_id: string;
  name: string;
  conversion_factor: number;
  is_default_sale_unit: boolean;
  price_paisa: number;
  barcode: string | null;
  medicine_name?: string;
}

const FIELD = 'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const PANEL = 'rounded-xl border border-border bg-surface shadow-xs';
const BUTTON = 'inline-flex items-center justify-center gap-2 rounded-control bg-primary px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50';
const SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm font-semibold text-text hover:bg-surface/80 disabled:opacity-50';

function errorText(error: unknown) {
  return getSupabaseErrorMessage(error, 'Could not complete the request.');
}

function formatMoney(paisa: number) {
  return `Rs ${(paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MasterDataView({ onViewProducts }: {
  onViewProducts: (filter: { field: 'category' | 'company'; value: string }) => void;
}) {
  const { can } = usePermissions();
  const canManage = can('categories');
  const canViewProducts = can('products');
  const [tab, setTab] = useState<MasterTab>('categories');
  const [categories, setCategories] = useState<MasterValue[]>([]);
  const [brands, setBrands] = useState<MasterValue[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<{ kind: MasterKind; item: MasterValue | null } | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const client = supabase;
    if (!client) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [
        categoryRows,
        brandRows,
        medicineRows,
        unitRows,
      ] = await Promise.all([
        fetchAllSupabaseRows((from, to) => client.from('categories').select('id,name,is_active').order('name').range(from, to)),
        fetchAllSupabaseRows((from, to) => client.from('brands').select('id,name,is_active').order('name').range(from, to)),
        fetchAllSupabaseRows((from, to) => client.from('medicines').select('id,brand_name,generic_name,code,category,company').order('id').range(from, to)),
        fetchAllSupabaseRows((from, to) => client.from('medicine_units').select('id,medicine_id,name,conversion_factor,is_default_sale_unit,price_paisa,barcode').order('name').order('id').range(from, to)),
      ]);

      const medicineValues = medicineRows;
      const categoryCounts = new Map<string, number>();
      const brandCounts = new Map<string, number>();
      for (const medicine of medicineValues) {
        categoryCounts.set(medicine.category, (categoryCounts.get(medicine.category) ?? 0) + 1);
        brandCounts.set(medicine.company, (brandCounts.get(medicine.company) ?? 0) + 1);
      }
      setCategories(categoryRows.map((item) => ({ ...item, productCount: categoryCounts.get(item.name) ?? 0 })));
      setBrands(brandRows.map((item) => ({ ...item, productCount: brandCounts.get(item.name) ?? 0 })));
      const medicineNames = new Map(medicineValues.map((medicine) => [medicine.id, `${medicine.brand_name} · ${medicine.generic_name} (${medicine.code})`]));
      setUnits(unitRows.map((unit) => ({ ...unit, medicine_name: medicineNames.get(unit.medicine_id) ?? 'Unknown medicine' })));
    } catch (caught) {
      setError(errorText(caught));
      setCategories([]);
      setBrands([]);
      setUnits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openEditor = (kind: MasterKind, item: MasterValue | null) => {
    setEditing({ kind, item });
    setName(item?.name ?? '');
    setActive(item?.is_active ?? true);
    setNotice('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !editing) return;
    const cleanName = name.trim();
    if (!cleanName) return setNotice('Name is required.');
    setSaving(true);
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc(
        editing.kind === 'category' ? 'save_category' : 'save_brand',
        editing.kind === 'category'
          ? { p_category_id: editing.item?.id ?? null, p_name: cleanName, p_is_active: active }
          : { p_brand_id: editing.item?.id ?? null, p_name: cleanName, p_is_active: active },
      );
      if (rpcError) throw rpcError;
      setEditing(null);
      setNotice(`${editing.kind === 'category' ? 'Category' : 'Manufacturer'} saved.`);
      await load();
    } catch (caught) {
      setNotice(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (kind: MasterKind, item: MasterValue) => {
    if (!supabase) return setError('Supabase is not configured.');
    if (!window.confirm(`Delete "${item.name}"? Deletion is blocked if any medicine uses it.`)) return;
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc(
        kind === 'category' ? 'delete_category' : 'delete_brand',
        kind === 'category' ? { p_category_id: item.id } : { p_brand_id: item.id },
      );
      if (rpcError) throw rpcError;
      setNotice(`${kind === 'category' ? 'Category' : 'Manufacturer'} deleted.`);
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const activeItems = tab === 'categories' ? categories : brands;
  const kind = tab === 'categories' ? 'category' : 'brand';

  return <div className="space-y-4">
    <section className={`${PANEL} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
      <div><h2 className="flex items-center gap-2 text-lg font-black text-text"><Layers size={18} /> Categories & master data</h2><p className="text-sm text-muted">Live category, manufacturer, and medicine-unit records.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {(['categories', 'brands', 'units'] as const).map((value) => <button type="button" key={value} aria-pressed={tab === value} className={tab === value ? BUTTON : SECONDARY} onClick={() => setTab(value)}>{value === 'categories' ? 'Categories' : value === 'brands' ? 'Manufacturers' : 'Units'}</button>)}
        <button type="button" aria-label="Refresh master data" className={SECONDARY} onClick={() => void load()} disabled={loading}><RefreshCw size={16} /></button>
        {canManage && tab !== 'units' && <button type="button" className={BUTTON} onClick={() => openEditor(kind, null)}><Plus size={16} /> Add {kind === 'category' ? 'category' : 'manufacturer'}</button>}
      </div>
    </section>

    {error && <div role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
    {notice && <div role="status" className="rounded-control border border-border bg-surface px-4 py-3 text-sm text-text">{notice}</div>}
    {!canManage && <p className="rounded-control border border-border bg-surface px-4 py-3 text-sm text-muted">You have read-only access to master data.</p>}

    <section className={`${PANEL} overflow-hidden`}>
      {loading ? <p className="p-8 text-center text-sm text-muted">Loading database records…</p>
        : error ? <p className="p-8 text-center text-sm text-muted">Master data is unavailable. Retry after resolving the error.</p>
          : tab === 'units' ? units.length === 0 ? <p className="p-8 text-center text-sm text-muted">No medicine units are stored yet.</p>
            : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-surface text-xs font-bold uppercase text-muted"><tr><th className="px-4 py-3">Medicine</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3">Base units per unit</th><th className="px-4 py-3">Sale price</th><th className="px-4 py-3">Default</th><th className="px-4 py-3">Barcode</th></tr></thead><tbody className="divide-y divide-border">{units.map((unit) => <tr key={unit.id}><td className="px-4 py-3">{unit.medicine_name}</td><td className="px-4 py-3 font-semibold">{unit.name}</td><td className="px-4 py-3">{unit.conversion_factor}</td><td className="px-4 py-3">{formatMoney(unit.price_paisa)}</td><td className="px-4 py-3">{unit.is_default_sale_unit ? 'Yes' : 'No'}</td><td className="px-4 py-3">{unit.barcode ?? '—'}</td></tr>)}</tbody></table></div>
            : activeItems.length === 0 ? <p className="p-8 text-center text-sm text-muted">No {tab === 'categories' ? 'categories' : 'manufacturers'} found. Add a real database record to get started.</p>
              : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-surface text-xs font-bold uppercase text-muted"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Products using this value</th><th className="px-4 py-3">State</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-border">{activeItems.map((item) => <tr key={item.id} className="hover:bg-surface/70"><td className="px-4 py-3 font-semibold text-text">{item.name}</td><td className="px-4 py-3">{item.productCount}</td><td className="px-4 py-3">{item.is_active ? 'Active' : 'Inactive'}</td><td className="px-4 py-3"><div className="flex justify-end gap-2">
                {canViewProducts && <button type="button" className={SECONDARY} onClick={() => onViewProducts({ field: kind === 'category' ? 'category' : 'company', value: item.name })}><Tag size={14} /> View products</button>}
                {canManage && <><button type="button" className={SECONDARY} onClick={() => openEditor(kind, item)}><Edit2 size={14} /> Edit</button><button type="button" aria-label={`Delete ${item.name}`} className="rounded-control border border-danger/30 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10" onClick={() => void remove(kind, item)}><Trash2 size={14} /> Delete</button></>}
              </div></td></tr>)}</tbody></table></div>}
    </section>

    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={(event) => void save(event)} className={`${PANEL} w-full max-w-md space-y-4 p-5`}>
      <div className="flex items-start justify-between"><div><h3 className="text-lg font-black text-text">{editing.item ? 'Edit' : 'Add'} {editing.kind === 'category' ? 'category' : 'manufacturer'}</h3><p className="text-sm text-muted">Names are unique regardless of letter case.</p></div><button type="button" aria-label="Close editor" className={SECONDARY} onClick={() => setEditing(null)}><X size={16} /></button></div>
      {notice && <p role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{notice}</p>}
      <label className="block text-sm text-text">Name *<input className={`${FIELD} mt-1`} required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active for new products</label>
      {editing.item && editing.item.productCount > 0 && <p className="rounded-control border border-warning/40 bg-warning/10 p-3 text-sm text-text">This value is used by {editing.item.productCount} products. Renaming also renames those products and requires products permission. With categories permission only, you may edit its active state, but cannot rename it while in use.</p>}
      <div className="flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className={BUTTON} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
    </form></div>}
  </div>;
}
