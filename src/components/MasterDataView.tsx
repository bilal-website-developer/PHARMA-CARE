import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ArrowDownWideNarrow, Check, Edit2, Layers, Merge, Plus, RefreshCw, Search,
  Tag, Trash2, X,
} from 'lucide-react';
import { usePermissions } from '../permissions';
import { fetchAllSupabaseRows } from '../utils/fetchAllSupabaseRows';
import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';
import { findSimilarNames, type SimilarNamePair } from './masterDataSimilarity';

type MasterTab = 'categories' | 'brands' | 'units';
type MasterKind = 'category' | 'brand';
type SortMode = 'name' | 'products' | 'stock';

interface MasterValue {
  id: string;
  name: string;
  is_active: boolean;
  product_count: number;
  low_count: number;
  out_count: number;
  expiring_count: number;
  stock_value_paisa: number | null;
}

interface UnitRow {
  id: string;
  medicine_id: string;
  name: string;
  conversion_factor: number;
  is_default_sale_unit: boolean;
  price_paisa: number;
  barcode: string | null;
  medicine_name: string;
}

interface MasterOverview {
  categories: MasterValue[];
  manufacturers: MasterValue[];
  summary: {
    category_count: number;
    active_category_count: number;
    manufacturer_count: number;
    active_manufacturer_count: number;
    product_count: number;
    unit_count: number;
  };
}

const FIELD = 'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const PANEL = 'rounded-xl border border-border bg-surface shadow-xs';
const BUTTON = 'inline-flex items-center justify-center gap-2 rounded-control bg-primary px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50';
const SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm font-semibold text-text hover:bg-surface/80 disabled:opacity-50';
const DOT_COLORS = ['bg-primary', 'bg-accent', 'bg-warning', 'bg-danger', 'bg-sky-500', 'bg-violet-500'];

function colorForId(id: string) {
  const hash = Array.from(id).reduce((total, character) => total + character.charCodeAt(0), 0);
  return DOT_COLORS[hash % DOT_COLORS.length];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMasterValue(value: unknown): value is MasterValue {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.is_active === 'boolean'
    && typeof value.product_count === 'number'
    && typeof value.low_count === 'number'
    && typeof value.out_count === 'number'
    && typeof value.expiring_count === 'number'
    && (value.stock_value_paisa === null || typeof value.stock_value_paisa === 'number');
}

function isOverview(value: unknown): value is MasterOverview {
  const summary = isRecord(value) ? value.summary : null;
  return isRecord(value)
    && Array.isArray(value.categories) && value.categories.every(isMasterValue)
    && Array.isArray(value.manufacturers) && value.manufacturers.every(isMasterValue)
    && isRecord(summary)
    && ['category_count', 'active_category_count', 'manufacturer_count', 'active_manufacturer_count', 'product_count', 'unit_count']
      .every((key) => typeof summary[key] === 'number');
}

function errorText(error: unknown) {
  return getSupabaseErrorMessage(error, 'Could not complete the request.');
}

function formatMoney(paisa: number) {
  return `Rs ${(paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sortItems(items: readonly MasterValue[], sort: SortMode) {
  return [...items].sort((left, right) => {
    if (sort === 'products') return right.product_count - left.product_count || left.name.localeCompare(right.name);
    if (sort === 'stock') return (right.stock_value_paisa ?? -1) - (left.stock_value_paisa ?? -1) || left.name.localeCompare(right.name);
    return left.name.localeCompare(right.name);
  });
}

function StatChip({ children, tone }: { children: React.ReactNode; tone: 'ok' | 'warning' | 'danger' | 'muted' }) {
  const styles = {
    ok: 'border-primary/25 bg-primary/10 text-primary',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-danger/25 bg-danger/10 text-danger',
    muted: 'border-border bg-surface text-muted',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}

export function MasterDataView({ onViewProducts }: {
  onViewProducts: (filter: { field: 'category' | 'company'; value: string }) => void;
}) {
  const { can } = usePermissions();
  const canManage = can('categories');
  const canViewProducts = can('products');
  const [tab, setTab] = useState<MasterTab>('categories');
  const [overview, setOverview] = useState<MasterOverview | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('name');
  const [loading, setLoading] = useState(true);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [error, setError] = useState('');
  const [unitsError, setUnitsError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<{ kind: MasterKind; item: MasterValue | null } | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [merge, setMerge] = useState<{ kind: MasterKind; source: MasterValue; targetId: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: MasterKind; item: MasterValue } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadOverview = useCallback(async () => {
    const client = supabase;
    if (!client) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await client.rpc('master_data_overview');
      if (rpcError) throw rpcError;
      if (!isOverview(data)) throw new Error('The master-data overview returned an invalid response.');
      setOverview(data);
    } catch (caught) {
      setError(errorText(caught));
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUnits = useCallback(async () => {
    const client = supabase;
    if (!client) {
      setUnitsError('Supabase is not configured.');
      return;
    }
    setUnitsLoading(true);
    setUnitsError('');
    try {
      const [unitRows, medicineRows] = await Promise.all([
        fetchAllSupabaseRows((from, to) => client.from('medicine_units')
          .select('id,medicine_id,name,conversion_factor,is_default_sale_unit,price_paisa,barcode')
          .order('name').order('id').range(from, to)),
        fetchAllSupabaseRows((from, to) => client.from('medicines')
          .select('id,brand_name,generic_name,code').order('id').range(from, to)),
      ]);
      const medicineNames = new Map(medicineRows.map((medicine) => [
        medicine.id,
        `${medicine.brand_name} · ${medicine.generic_name} (${medicine.code})`,
      ]));
      setUnits(unitRows.map((unit) => ({
        ...unit,
        medicine_name: medicineNames.get(unit.medicine_id) ?? 'Unknown medicine',
      })));
    } catch (caught) {
      setUnitsError(errorText(caught));
      setUnits([]);
    } finally {
      setUnitsLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { if (tab === 'units') void loadUnits(); }, [loadUnits, tab]);
  useEffect(() => {
    if (!editing && !merge && !pendingDelete) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      setEditing(null);
      setMerge(null);
      setPendingDelete(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [editing, merge, pendingDelete, saving]);

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
    if (!cleanName) {
      setNotice('Name is required.');
      return;
    }
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
      await loadOverview();
    } catch (caught) {
      setNotice(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!supabase || !pendingDelete) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { kind, item } = pendingDelete;
      const { error: rpcError } = await supabase.rpc(
        kind === 'category' ? 'delete_category' : 'delete_brand',
        kind === 'category' ? { p_category_id: item.id } : { p_brand_id: item.id },
      );
      if (rpcError) throw rpcError;
      setPendingDelete(null);
      setNotice(`${kind === 'category' ? 'Category' : 'Manufacturer'} deleted.`);
      await loadOverview();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  const mergeValues = tab === 'categories' ? overview?.categories ?? [] : overview?.manufacturers ?? [];
  const kind: MasterKind = tab === 'categories' ? 'category' : 'brand';
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => sortItems(
    mergeValues.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery)),
    sort,
  ), [mergeValues, normalizedQuery, sort]);
  const similarPairs = useMemo(
    () => findSimilarNames(mergeValues.filter((item) => !normalizedQuery || item.name.toLocaleLowerCase().includes(normalizedQuery))),
    [mergeValues, normalizedQuery],
  );

  const beginMerge = (mergeKind: MasterKind, source: MasterValue, target?: MasterValue) => {
    const targets = mergeKind === 'category' ? overview?.categories ?? [] : overview?.manufacturers ?? [];
    const defaultTarget = target ?? targets.find((item) => item.id !== source.id);
    if (!defaultTarget) {
      setNotice('Add another value before merging.');
      return;
    }
    setMerge({ kind: mergeKind, source, targetId: defaultTarget.id });
    setNotice('');
  };

  const performMerge = async () => {
    if (!supabase || !merge) return;
    const target = (merge.kind === 'category' ? overview?.categories : overview?.manufacturers)
      ?.find((item) => item.id === merge.targetId);
    if (!target) {
      setError('Choose a valid name to keep.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc(
        merge.kind === 'category' ? 'merge_categories' : 'merge_brands',
        merge.kind === 'category'
          ? { p_source_category_id: merge.source.id, p_target_category_id: target.id }
          : { p_source_brand_id: merge.source.id, p_target_brand_id: target.id },
      );
      if (rpcError) throw rpcError;
      if (typeof data !== 'number') throw new Error('The merge service returned an invalid response.');
      setMerge(null);
      setNotice(`Merged “${merge.source.name}” into “${target.name}”; ${data} product${data === 1 ? '' : 's'} updated.`);
      await loadOverview();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  const openPairForReview = (pair: SimilarNamePair<MasterValue>) => beginMerge(kind, pair.first, pair.second);
  const isUnitsTab = tab === 'units';
  const unitCount = overview?.summary.unit_count ?? 0;

  return <div className="space-y-4">
    <section className={`${PANEL} flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5`}>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-black text-text"><Layers size={20} aria-hidden="true" /> Categories &amp; master data</h1>
        <p className="mt-1 text-sm text-muted">Manage product categories, manufacturers, and real medicine units.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canManage && !isUnitsTab && <button type="button" className={BUTTON} onClick={() => openEditor(kind, null)}><Plus size={16} /> Add {kind === 'category' ? 'category' : 'manufacturer'}</button>}
        <button type="button" aria-label="Refresh master data" className={SECONDARY} onClick={() => void loadOverview()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>
    </section>

    <nav aria-label="Master data sections" className={`${PANEL} flex flex-wrap gap-2 p-2`}>
      {([
        ['categories', `Categories${overview ? ` (${overview.summary.category_count})` : ''}`],
        ['brands', `Manufacturers${overview ? ` (${overview.summary.manufacturer_count})` : ''}`],
        ...(unitCount > 0 ? [['units', `Units (${unitCount})`] as const] : []),
      ] as const).map(([value, label]) => (
        <button type="button" key={value} aria-pressed={tab === value} className={tab === value ? BUTTON : SECONDARY} onClick={() => setTab(value)}>
          {value === 'categories' ? <Layers size={15} /> : value === 'brands' ? <Tag size={15} /> : <ArrowDownWideNarrow size={15} />}
          {label}
        </button>
      ))}
    </nav>

    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"><span>{error}</span><button type="button" className={SECONDARY} onClick={() => void loadOverview()} disabled={loading}>Retry</button></div>}
    {notice && <div role="status" className="rounded-control border border-border bg-surface px-4 py-3 text-sm text-text">{notice}</div>}
    {!canManage && <p className="rounded-control border border-border bg-surface px-4 py-3 text-sm text-muted">You have read-only access to master data.</p>}

    {!isUnitsTab && (
      <>
        <section aria-label="Master data overview" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <OverviewCard label="Categories" value={overview?.summary.category_count} />
          <OverviewCard label="Active categories" value={overview?.summary.active_category_count} />
          <OverviewCard label="Manufacturers" value={overview?.summary.manufacturer_count} />
          <OverviewCard label="Active manufacturers" value={overview?.summary.active_manufacturer_count} />
          <OverviewCard label="Products" value={overview?.summary.product_count} />
          <OverviewCard label="Units" value={unitCount} />
        </section>
        <section aria-label="Search and sort master data" className={`${PANEL} flex flex-col gap-3 p-3 sm:flex-row sm:items-center`}>
          <label className="relative block flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden="true" />
            <input className={`${FIELD} pl-9`} aria-label={`Search ${kind === 'category' ? 'categories' : 'manufacturers'}`} placeholder={`Search ${kind === 'category' ? 'categories' : 'manufacturers'}`} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-text">
            Sort
            <select aria-label="Sort master data" className={`${FIELD} w-auto min-w-44`} value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
              <option value="name">A-Z</option><option value="products">Most products</option><option value="stock">Highest stock value</option>
            </select>
          </label>
        </section>
        {similarPairs.length > 0 && (
          <section aria-label="Similar names" className={`${PANEL} space-y-3 border-warning/40 bg-warning/5 p-4`}>
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 text-warning" size={18} /><div><h2 className="font-bold text-text">Similar names to review</h2><p className="text-sm text-muted">These names normalize to the same value or differ by at most two edits.</p></div></div>
            <ul className="space-y-2">
              {similarPairs.map((pair) => <li key={`${pair.first.id}:${pair.second.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm">
                <span className="text-text"><strong>{pair.first.name}</strong><span className="px-2 text-muted">↔</span><strong>{pair.second.name}</strong></span>
                {canManage && <button type="button" className={SECONDARY} onClick={() => openPairForReview(pair)}><Merge size={15} /> Review &amp; merge</button>}
              </li>)}
            </ul>
          </section>
        )}

        {loading ? <MasterGridSkeleton />
          : error ? null
            : visibleItems.length === 0 ? <section className={`${PANEL} flex min-h-52 flex-col items-center justify-center gap-2 p-8 text-center`}>
              <Layers className="text-muted" size={28} />
              <h2 className="font-bold text-text">{query ? 'No matching names' : `No ${kind === 'category' ? 'categories' : 'manufacturers'} yet`}</h2>
              <p className="max-w-md text-sm text-muted">{query ? 'Try a different search term.' : 'Add a real record to populate this view.'}</p>
              {!query && canManage && <button type="button" className={BUTTON} onClick={() => openEditor(kind, null)}><Plus size={16} /> Add {kind}</button>}
            </section>
            : <section aria-label={kind === 'category' ? 'Category cards' : 'Manufacturer cards'} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleItems.map((item) => <MasterDataCard
                key={item.id}
                item={item}
                colorClass={colorForId(item.id)}
                canManage={canManage}
                canViewProducts={canViewProducts}
                kind={kind}
                onViewProducts={() => onViewProducts({ field: kind === 'category' ? 'category' : 'company', value: item.name })}
                onRename={() => openEditor(kind, item)}
                onMerge={() => beginMerge(kind, item)}
                onDelete={() => setPendingDelete({ kind, item })}
              />)}
            </section>}
      </>
    )}

    {isUnitsTab && (
      <section className={`${PANEL} overflow-hidden`}>
        {unitsLoading ? <MasterGridSkeleton />
          : unitsError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-danger"><span>{unitsError}</span><button type="button" className={SECONDARY} onClick={() => void loadUnits()} disabled={unitsLoading}>Retry units</button></div>
            : units.length === 0 ? <div className="p-8 text-center"><h2 className="font-bold text-text">No medicine units stored</h2><p className="mt-1 text-sm text-muted">Units will appear here when products have real unit records.</p></div>
              : <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                {units.map((unit) => <article key={unit.id} className={`${PANEL} space-y-3 p-4`}>
                  <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-text">{unit.name}</h2><p className="mt-1 text-xs text-muted">{unit.medicine_name}</p></div>{unit.is_default_sale_unit && <StatChip tone="ok">Default sale unit</StatChip>}</div>
                  <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted">Base units</dt><dd className="font-semibold text-text">{unit.conversion_factor}</dd></div><div><dt className="text-xs text-muted">Sale price</dt><dd className="font-semibold text-text">{formatMoney(unit.price_paisa)}</dd></div></dl>
                  {unit.barcode && <p className="text-xs text-muted">Barcode: {unit.barcode}</p>}
                </article>)}
              </div>}
      </section>
    )}

    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form role="dialog" aria-modal="true" aria-labelledby="master-edit-title" onSubmit={(event) => void save(event)} className={`${PANEL} w-full max-w-md space-y-4 p-5 shadow-xl`}>
        <div className="flex items-start justify-between"><div><h2 id="master-edit-title" className="text-lg font-black text-text">{editing.item ? 'Rename' : 'Add'} {editing.kind === 'category' ? 'category' : 'manufacturer'}</h2><p className="text-sm text-muted">Names are unique regardless of letter case.</p></div><button type="button" aria-label="Close editor" className={SECONDARY} onClick={() => setEditing(null)}><X size={16} /></button></div>
        <label className="block text-sm text-text">Name *<input className={`${FIELD} mt-1`} required maxLength={120} autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active for new products</label>
        {editing.item && editing.item.product_count > 0 && <p className="rounded-control border border-warning/40 bg-warning/10 p-3 text-sm text-text">This value is used by {editing.item.product_count} products. Renaming requires Products permission because it updates those product records.</p>}
        {notice && <p role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{notice}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className={BUTTON} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
      </form>
    </div>}

    {merge && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="merge-title" className={`${PANEL} w-full max-w-lg space-y-4 p-5 shadow-xl`}>
        <div className="flex items-start justify-between gap-3"><div><h2 id="merge-title" className="text-lg font-black text-text">Merge {merge.kind === 'category' ? 'categories' : 'manufacturers'}</h2><p className="text-sm text-muted">Choose the name that will remain. Products assigned to the other name will be updated.</p></div><button type="button" className={SECONDARY} aria-label="Close merge dialog" onClick={() => setMerge(null)}><X size={16} /></button></div>
        <p className="rounded-control border border-warning/40 bg-warning/10 p-3 text-sm text-text"><strong>{merge.source.product_count}</strong> product{merge.source.product_count === 1 ? '' : 's'} will move from <strong>{merge.source.name}</strong> to the selected name.</p>
        <label className="block text-sm font-semibold text-text">Name to keep
          <select className={`${FIELD} mt-1`} autoFocus value={merge.targetId} onChange={(event) => setMerge({ ...merge, targetId: event.target.value })}>
            {(merge.kind === 'category' ? overview?.categories : overview?.manufacturers)?.filter((item) => item.id !== merge.source.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setMerge(null)}>Cancel</button><button type="button" className={BUTTON} disabled={saving || !merge.targetId} onClick={() => void performMerge()}><Merge size={15} />{saving ? 'Merging…' : 'Confirm merge'}</button></div>
      </section>
    </div>}

    {pendingDelete && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <section role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" className={`${PANEL} w-full max-w-md space-y-4 p-5 shadow-xl`}>
        <div><h2 id="delete-title" className="text-lg font-black text-text">Delete {pendingDelete.kind === 'category' ? 'category' : 'manufacturer'}?</h2><p id="delete-description" className="mt-2 text-sm text-muted">Delete “{pendingDelete.item.name}”? This action cannot be undone.</p></div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={SECONDARY} autoFocus onClick={() => setPendingDelete(null)}>Cancel</button><button type="button" className="inline-flex items-center gap-2 rounded-control border border-danger/30 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50" disabled={saving} onClick={() => void remove()}><Trash2 size={15} />{saving ? 'Deleting…' : 'Delete'}</button></div>
      </section>
    </div>}
  </div>;
}

function OverviewCard({ label, value }: { label: string; value?: number }) {
  return <article className={`${PANEL} p-3 sm:p-4`}><p className="text-xs font-semibold text-muted">{label}</p><p className="mt-1 text-xl font-black text-text">{value?.toLocaleString() ?? '—'}</p></article>;
}

function MasterGridSkeleton() {
  return <div aria-label="Loading master data" role="status" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
    {Array.from({ length: 6 }, (_, index) => <div key={index} className={`${PANEL} h-56 animate-pulse bg-surface p-4`}><div className="h-4 w-2/3 rounded bg-border" /><div className="mt-5 h-3 w-1/2 rounded bg-border" /><div className="mt-7 h-8 w-full rounded bg-border" /><span className="sr-only">Loading master data</span></div>)}
  </div>;
}

function MasterDataCard({
  item,
  colorClass,
  canManage,
  canViewProducts,
  kind,
  onViewProducts,
  onRename,
  onMerge,
  onDelete,
}: {
  item: MasterValue;
  colorClass: string;
  canManage: boolean;
  canViewProducts: boolean;
  kind: MasterKind;
  onViewProducts: () => void;
  onRename: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  const hasWarnings = item.low_count > 0 || item.expiring_count > 0 || item.out_count > 0;
  return <article className={`${PANEL} flex min-h-56 flex-col gap-4 p-4 transition-shadow hover:shadow-md sm:p-5`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${colorClass}`} aria-hidden="true" />
        <div className="min-w-0"><h2 className="truncate text-lg font-bold text-text" title={item.name}>{item.name}</h2><p className="mt-0.5 text-xs text-muted">{item.is_active ? 'Active' : 'Inactive'}</p></div>
      </div>
      {item.product_count === 0 && <StatChip tone="muted">Unused</StatChip>}
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div><p className="text-xs text-muted">Products</p><p className="mt-1 text-xl font-black text-text">{item.product_count.toLocaleString()}</p></div>
      {item.stock_value_paisa !== null && <div><p className="text-xs text-muted">Stock value</p><p className="mt-1 text-base font-bold text-text">{formatMoney(item.stock_value_paisa)}</p></div>}
    </div>
    <div className="flex min-h-7 flex-wrap gap-2" aria-label={`${item.name} stock indicators`}>
      {item.low_count > 0 && <StatChip tone="warning">Low {item.low_count}</StatChip>}
      {item.expiring_count > 0 && <StatChip tone="warning">Expiring {item.expiring_count}</StatChip>}
      {item.out_count > 0 && <StatChip tone="danger">Out {item.out_count}</StatChip>}
      {!hasWarnings && <StatChip tone="ok"><Check size={13} /> OK</StatChip>}
    </div>
    <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
      {canViewProducts && <button type="button" className={SECONDARY} onClick={onViewProducts}><Tag size={14} /> View products</button>}
      {canManage && <>
        <button type="button" className={SECONDARY} onClick={onRename}><Edit2 size={14} /> Rename</button>
        <button type="button" className={SECONDARY} onClick={onMerge}><Merge size={14} /> Merge</button>
        {item.product_count === 0
          ? <button type="button" className="inline-flex items-center gap-2 rounded-control border border-danger/30 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10" onClick={onDelete}><Trash2 size={14} /> Delete</button>
          : <span className="inline-flex items-center" title={`Cannot delete while ${item.product_count} product(s) use this ${kind === 'category' ? 'category' : 'manufacturer'}.`}>
            <button type="button" className="inline-flex cursor-not-allowed items-center gap-2 rounded-control border border-border px-3 py-2 text-sm font-semibold text-muted opacity-60" disabled aria-describedby={`${kind}-delete-${item.id}`}><Trash2 size={14} /> Delete</button>
            <span id={`${kind}-delete-${item.id}`} className="sr-only">Delete is unavailable because {item.product_count} products use this value.</span>
          </span>}
      </>}
    </div>
    {canManage && item.product_count > 0 && <p className="text-xs text-muted">Delete unavailable while {item.product_count} products use this {kind === 'category' ? 'category' : 'manufacturer'}.</p>}
  </article>;
}
