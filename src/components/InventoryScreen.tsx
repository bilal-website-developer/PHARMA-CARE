import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Barcode, ChevronLeft, ChevronRight, Clock3, Edit2, Plus,
  RefreshCw, Search, ShieldAlert, SlidersHorizontal, X,
} from 'lucide-react';
import { usePermissions } from '../permissions';
import { fetchAllSupabaseRows } from '../utils/fetchAllSupabaseRows';
import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';

const PAGE_SIZE = 25;
const NEAR_EXPIRY_DAYS = 90;
const FIELD = 'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const PANEL = 'rounded-xl border border-border bg-surface shadow-xs';
const BUTTON = 'inline-flex items-center justify-center gap-2 rounded-control bg-primary px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm font-semibold text-text hover:bg-surface/80 disabled:opacity-50';

type ViewMode = 'products' | 'stock';
export type ProductFilter = { field: 'category' | 'company'; value: string } | null;
type DrugClass = 'OTC' | 'RX' | 'CONTROLLED' | 'NARCOTIC';
type StorageCondition = 'ROOM_TEMPERATURE' | 'COOL' | 'COLD_REFRIGERATED';

interface MedicineUnit {
  id: string;
  name: string;
  conversion_factor: number;
  is_default_sale_unit: boolean;
  price_paisa: number;
  barcode: string | null;
}

interface Medicine {
  id: string;
  code: string;
  barcode: string | null;
  brand_name: string;
  generic_name: string;
  category: string;
  company: string;
  drug_class: DrugClass;
  storage_condition: StorageCondition;
  rack_location: string;
  min_stock_alert: number;
  requires_prescription: boolean;
  is_active: boolean;
  units: MedicineUnit[];
  stock: number;
  nearest_expiry: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface ProductFormValues {
  code: string;
  barcode: string;
  brand_name: string;
  generic_name: string;
  category: string;
  company: string;
  drug_class: DrugClass;
  storage_condition: StorageCondition;
  rack_location: string;
  min_stock_alert: string;
  requires_prescription: boolean;
  units: Array<{
    id?: string;
    name: string;
    conversion_factor: string;
    is_default_sale_unit: boolean;
    price_paisa: string;
    barcode: string;
  }>;
}

interface BatchRow {
  id: string;
  medicine_id: string;
  batch_number: string;
  expiry_date: string;
  received_date: string;
  cost_paisa_per_base_unit: number;
  mrp_paisa_per_base_unit: number;
  quantity_remaining: number;
  status: string;
  medicine?: Pick<Medicine, 'brand_name' | 'generic_name' | 'code' | 'min_stock_alert'>;
  supplier?: { name: string } | null;
}

const today = () => new Date().toISOString().slice(0, 10);

function messageFor(error: unknown, fallback: string) {
  return getSupabaseErrorMessage(error, fallback);
}

function money(paisa: number) {
  return `Rs ${(paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function initialProductForm(medicine?: Medicine): ProductFormValues {
  return medicine ? {
    code: medicine.code,
    barcode: medicine.barcode ?? '',
    brand_name: medicine.brand_name,
    generic_name: medicine.generic_name,
    category: medicine.category,
    company: medicine.company,
    drug_class: medicine.drug_class,
    storage_condition: medicine.storage_condition,
    rack_location: medicine.rack_location,
    min_stock_alert: String(medicine.min_stock_alert),
    requires_prescription: medicine.requires_prescription,
    units: medicine.units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      conversion_factor: String(unit.conversion_factor),
      is_default_sale_unit: unit.is_default_sale_unit,
      price_paisa: String(unit.price_paisa),
      barcode: unit.barcode ?? '',
    })),
  } : {
    code: '',
    barcode: '',
    brand_name: '',
    generic_name: '',
    category: '',
    company: '',
    drug_class: 'OTC',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: '',
    min_stock_alert: '0',
    requires_prescription: false,
    units: [{ name: '', conversion_factor: '1', is_default_sale_unit: true, price_paisa: '0', barcode: '' }],
  };
}

export function InventoryScreen({
  mode,
  currentRole: _currentRole,
  initialFilter = null,
  onFilterApplied,
}: {
  mode: ViewMode;
  currentRole: string;
  initialFilter?: ProductFilter;
  onFilterApplied?: () => void;
}) {
  return mode === 'products'
    ? <ProductsCatalog initialFilter={initialFilter} onFilterApplied={onFilterApplied} />
    : <StockInventory />;
}

function ProductsCatalog({
  initialFilter,
  onFilterApplied,
}: {
  initialFilter: ProductFilter;
  onFilterApplied?: () => void;
}) {
  const { can } = usePermissions();
  const canEditProducts = can('products');
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [brands, setBrands] = useState<CategoryOption[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [optionsError, setOptionsError] = useState('');
  const [editing, setEditing] = useState<Medicine | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<ProductFormValues>(() => initialProductForm());

  useEffect(() => {
    if (!initialFilter) return;
    if (initialFilter.field === 'category') setCategoryFilter(initialFilter.value);
    else setBrandFilter(initialFilter.value);
    setPage(1);
    onFilterApplied?.();
  }, [initialFilter, onFilterApplied]);

  const loadOptions = useCallback(async () => {
    const client = supabase;
    if (!client) throw new Error('Supabase is not configured.');
    const [categoryRows, brandRows] = await Promise.all([
      fetchAllSupabaseRows((from, to) => client.from('categories').select('id,name').eq('is_active', true).order('name').range(from, to)),
      fetchAllSupabaseRows((from, to) => client.from('brands').select('id,name').eq('is_active', true).order('name').range(from, to)),
    ]);
    setCategories(categoryRows ?? []);
    setBrands(brandRows ?? []);
    setOptionsError('');
  }, []);

  const loadProducts = useCallback(async () => {
    const client = supabase;
    if (!client) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = client.from('medicines')
        .select('id,code,barcode,brand_name,generic_name,category,company,drug_class,storage_condition,rack_location,min_stock_alert,requires_prescription,is_active', { count: 'exact' })
        .order('brand_name')
        .range(from, to);
      const cleanSearch = search.trim().replace(/[(),]/g, ' ');
      if (cleanSearch) {
        const pattern = `*${cleanSearch}*`;
        query = query.or([
          `code.ilike.${pattern}`,
          `barcode.ilike.${pattern}`,
          `brand_name.ilike.${pattern}`,
          `generic_name.ilike.${pattern}`,
          `category.ilike.${pattern}`,
          `company.ilike.${pattern}`,
        ].join(','));
      }
      if (categoryFilter) query = query.eq('category', categoryFilter);
      if (brandFilter) query = query.eq('company', brandFilter);
      if (classFilter) query = query.eq('drug_class', classFilter);
      if (activeFilter !== 'all') query = query.eq('is_active', activeFilter === 'active');

      const { data: rows, count, error: medicineError } = await query;
      if (medicineError) throw medicineError;
      const medicinesPage = rows ?? [];
      setTotalCount(count ?? 0);
      if (!medicinesPage.length) {
        setMedicines([]);
        return;
      }
      const ids = medicinesPage.map((medicine) => medicine.id);
      const [units, batches] = await Promise.all([
        fetchAllSupabaseRows((from, to) => client.from('medicine_units')
          .select('id,medicine_id,name,conversion_factor,is_default_sale_unit,price_paisa,barcode')
          .in('medicine_id', ids)
          .order('is_default_sale_unit', { ascending: false })
          .order('id')
          .range(from, to)),
        fetchAllSupabaseRows((from, to) => client.from('stock_batches')
          .select('id,medicine_id,expiry_date,quantity_remaining')
          .in('medicine_id', ids)
          .gte('expiry_date', today())
          .range(from, to)),
      ]);

      const unitsByMedicine = new Map<string, MedicineUnit[]>();
      for (const unit of units ?? []) {
        const current = unitsByMedicine.get(unit.medicine_id) ?? [];
        current.push(unit);
        unitsByMedicine.set(unit.medicine_id, current);
      }
      const batchesByMedicine = new Map<string, typeof batches>();
      for (const batch of batches ?? []) {
        const current = batchesByMedicine.get(batch.medicine_id) ?? [];
        current.push(batch);
        batchesByMedicine.set(batch.medicine_id, current);
      }
      setMedicines(medicinesPage.map((medicine) => {
        const medicineBatches = batchesByMedicine.get(medicine.id) ?? [];
        return {
          ...medicine,
          units: unitsByMedicine.get(medicine.id) ?? [],
          stock: medicineBatches.reduce((sum, batch) => sum + batch.quantity_remaining, 0),
          nearest_expiry: medicineBatches
            .map((batch) => batch.expiry_date)
            .sort()[0] ?? null,
        };
      }));
    } catch (caught) {
      setError(messageFor(caught, 'Could not load products.'));
      setMedicines([]);
    } finally {
      setLoading(false);
    }
  }, [activeFilter, brandFilter, categoryFilter, classFilter, page, search]);

  useEffect(() => {
    void loadOptions().catch((caught) => setOptionsError(messageFor(caught, 'Could not load categories and manufacturers.')));
  }, [loadOptions]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const refresh = useCallback(async () => {
    setError('');
    const optionsLoad = loadOptions().catch((caught) => {
      setOptionsError(messageFor(caught, 'Could not load categories and manufacturers.'));
    });
    await Promise.all([optionsLoad, loadProducts()]);
  }, [loadOptions, loadProducts]);

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const openCreate = () => {
    setEditing(null);
    setForm(initialProductForm());
    setShowForm(true);
    setNotice('');
  };

  const openEdit = (medicine: Medicine) => {
    setEditing(medicine);
    setForm(initialProductForm(medicine));
    setShowForm(true);
    setNotice('');
  };

  const changeUnit = (index: number, patch: Partial<ProductFormValues['units'][number]>) => {
    setForm((current) => ({
      ...current,
      units: current.units.map((unit, unitIndex) => {
        if (unitIndex === index) return { ...unit, ...patch };
        return patch.is_default_sale_unit ? { ...unit, is_default_sale_unit: false } : unit;
      }),
    }));
  };

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return setNotice('Supabase is not configured.');
    const minStock = Number(form.min_stock_alert);
    const units = form.units.map((unit) => ({
      ...(unit.id ? { id: unit.id } : {}),
      name: unit.name.trim(),
      conversion_factor: Number(unit.conversion_factor),
      is_default_sale_unit: unit.is_default_sale_unit,
      price_paisa: Number(unit.price_paisa),
      barcode: unit.barcode.trim() || null,
    }));
    if (!form.code.trim() || !form.brand_name.trim() || !form.generic_name.trim() || !form.category || !form.company) {
      return setNotice('Code, brand name, generic name, category, and manufacturer are required.');
    }
    if (!Number.isSafeInteger(minStock) || minStock < 0 || minStock > 2147483647) {
      return setNotice('Minimum stock must be a non-negative whole number.');
    }
    if (units.some((unit) => !unit.name || !Number.isSafeInteger(unit.conversion_factor) || unit.conversion_factor <= 0 || unit.conversion_factor > 2147483647 || !Number.isSafeInteger(unit.price_paisa) || unit.price_paisa < 0 || unit.price_paisa > 2147483647)) {
      return setNotice('Every unit needs a name, positive whole-number conversion factor, and valid non-negative paisa price.');
    }
    if (units.filter((unit) => unit.is_default_sale_unit).length !== 1) {
      return setNotice('Choose exactly one default sale unit.');
    }
    setSaving(true);
    setNotice('');
    try {
      const { error: saveError } = await supabase.rpc('save_medicine', {
        p_medicine_id: editing?.id ?? null,
        p_values: {
          code: form.code.trim(),
          barcode: form.barcode.trim() || null,
          brand_name: form.brand_name.trim(),
          generic_name: form.generic_name.trim(),
          category: form.category,
          company: form.company,
          drug_class: form.drug_class,
          storage_condition: form.storage_condition,
          rack_location: form.rack_location.trim(),
          min_stock_alert: minStock,
          requires_prescription: form.requires_prescription,
          is_active: editing?.is_active ?? true,
        },
        p_units: units,
      });
      if (saveError) throw saveError;
      setShowForm(false);
      setNotice(editing ? 'Product updated.' : 'Product added.');
      await loadProducts();
    } catch (caught) {
      setNotice(messageFor(caught, 'Could not save product.'));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (medicine: Medicine) => {
    if (!supabase) return setError('Supabase is not configured.');
    if (!window.confirm(`Deactivate ${medicine.brand_name}? It will remain in historical records and become unavailable for new purchases.`)) return;
    setError('');
    try {
      const { error: updateError } = await supabase.from('medicines')
        .update({ is_active: false })
        .eq('id', medicine.id);
      if (updateError) throw updateError;
      setNotice(`${medicine.brand_name} deactivated.`);
      await loadProducts();
    } catch (caught) {
      setError(messageFor(caught, 'Could not deactivate product.'));
    }
  };

  return (
    <div className="space-y-4">
      <section className={`${PANEL} flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between`}>
        <div>
          <h2 className="text-lg font-black text-text">Products</h2>
          <p className="text-sm text-muted">Database medicines, live non-expired stock, and nearest batch expiry.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input className={`${FIELD} pl-9`} aria-label="Search products" placeholder="Search code, barcode or name" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} />
          </label>
          <select aria-label="Filter category" className={FIELD} value={categoryFilter} onChange={(event) => { setPage(1); setCategoryFilter(event.target.value); }}>
            <option value="">All categories</option>
            {categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </select>
          <select aria-label="Filter manufacturer" className={FIELD} value={brandFilter} onChange={(event) => { setPage(1); setBrandFilter(event.target.value); }}>
            <option value="">All manufacturers</option>
            {brands.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </select>
          <select aria-label="Filter medicine class" className={FIELD} value={classFilter} onChange={(event) => { setPage(1); setClassFilter(event.target.value); }}>
            <option value="">All classes</option>
            <option value="OTC">OTC</option><option value="RX">RX</option><option value="CONTROLLED">Controlled</option><option value="NARCOTIC">Narcotic</option>
          </select>
          <select aria-label="Filter active status" className={FIELD} value={activeFilter} onChange={(event) => { setPage(1); setActiveFilter(event.target.value as typeof activeFilter); }}>
            <option value="active">Active products</option><option value="inactive">Inactive products</option><option value="all">All products</option>
          </select>
          <button type="button" className={SECONDARY} aria-label="Refresh products" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} /></button>
          {canEditProducts && <button type="button" className={BUTTON} onClick={openCreate}><Plus size={16} /> Add product</button>}
        </div>
      </section>

      {error && <div role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
      {optionsError && <div role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{optionsError}</div>}
      {notice && <div role="status" className="rounded-control border border-border bg-surface px-4 py-3 text-sm text-text">{notice}</div>}

      <section className={`${PANEL} overflow-hidden`}>
        {loading ? <p className="p-8 text-center text-sm text-muted">Loading products…</p>
          : error ? <p className="p-8 text-center text-sm text-muted">Product data is unavailable. Retry after resolving the error.</p>
            : medicines.length === 0 ? <p className="p-8 text-center text-sm text-muted">No products match these filters.</p>
              : <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-surface text-xs font-bold uppercase text-muted">
                    <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Category / Manufacturer</th><th className="px-4 py-3">Class</th><th className="px-4 py-3">Units / MRP</th><th className="px-4 py-3">Current stock</th><th className="px-4 py-3">Nearest expiry</th><th className="px-4 py-3">State</th>{canEditProducts && <th className="px-4 py-3 text-right">Actions</th>}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {medicines.map((medicine) => {
                      const defaultUnit = medicine.units.find((unit) => unit.is_default_sale_unit);
                      return <tr key={medicine.id} className="hover:bg-surface/70">
                        <td className="px-4 py-3">
                          <strong className="block text-text">{medicine.brand_name}</strong>
                          <span className="text-xs text-muted">{medicine.generic_name} · {medicine.code}</span>
                          {medicine.barcode && <span className="mt-1 flex items-center gap-1 text-xs text-muted"><Barcode size={13} />{medicine.barcode}</span>}
                        </td>
                        <td className="px-4 py-3 text-text">{medicine.category}<span className="block text-xs text-muted">{medicine.company}</span></td>
                        <td className="px-4 py-3">{medicine.drug_class}</td>
                        <td className="px-4 py-3">{defaultUnit ? <>{defaultUnit.name}<span className="block text-xs text-muted">{money(defaultUnit.price_paisa)}</span></> : <span className="text-warning">No unit configured</span>}</td>
                        <td className="px-4 py-3"><strong className={medicine.stock <= medicine.min_stock_alert ? 'text-warning' : 'text-text'}>{medicine.stock.toLocaleString()}</strong><span className="block text-xs text-muted">reorder at {medicine.min_stock_alert}</span></td>
                        <td className="px-4 py-3">{medicine.nearest_expiry ?? '—'}</td>
                        <td className="px-4 py-3">{medicine.is_active ? 'Active' : 'Inactive'}</td>
                        {canEditProducts && <td className="px-4 py-3 text-right"><div className="flex justify-end gap-2">
                          <button type="button" className={SECONDARY} onClick={() => void openEdit(medicine)}><Edit2 size={14} /> Edit</button>
                          {medicine.is_active && <button type="button" className="rounded-control border border-danger/30 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10" onClick={() => void deactivate(medicine)}>Deactivate</button>}
                        </div></td>}
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>}
        {!loading && totalCount > PAGE_SIZE && <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted">
          <span>{totalCount} products · Page {page} of {pageCount}</span>
          <div className="flex gap-2"><button type="button" className={SECONDARY} aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><button type="button" className={SECONDARY} aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div>
        </div>}
      </section>

      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
        <form onSubmit={(event) => void saveProduct(event)} className={`${PANEL} my-auto max-h-[95vh] w-full max-w-4xl space-y-4 overflow-y-auto p-5`}>
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black text-text">{editing ? 'Edit product' : 'Add product'}</h3><p className="text-sm text-muted">Initial stock is recorded through Purchases, not entered here.</p></div><button type="button" aria-label="Close product form" className={SECONDARY} onClick={() => setShowForm(false)}><X size={16} /></button></div>
          {notice && <p role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{notice}</p>}
          {(categories.length === 0 || brands.length === 0) && <p role="alert" className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text">Add at least one active category and manufacturer in Categories before saving a product.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm text-text">Product code *<input className={`${FIELD} mt-1`} required maxLength={80} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>
            <label className="text-sm text-text">Brand / medicine name *<input className={`${FIELD} mt-1`} required maxLength={160} value={form.brand_name} onChange={(event) => setForm({ ...form, brand_name: event.target.value })} /></label>
            <label className="text-sm text-text">Generic name *<input className={`${FIELD} mt-1`} required maxLength={160} value={form.generic_name} onChange={(event) => setForm({ ...form, generic_name: event.target.value })} /></label>
            <label className="text-sm text-text">Category *<select className={`${FIELD} mt-1`} required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="">Select category</option>{categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
            <label className="text-sm text-text">Manufacturer / brand *<select className={`${FIELD} mt-1`} required value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })}><option value="">Select manufacturer</option>{brands.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
            <label className="text-sm text-text">Barcode<input className={`${FIELD} mt-1`} maxLength={100} value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} /></label>
            <label className="text-sm text-text">Classification<select className={`${FIELD} mt-1`} value={form.drug_class} onChange={(event) => setForm({ ...form, drug_class: event.target.value as DrugClass })}><option value="OTC">OTC</option><option value="RX">Prescription (Rx)</option><option value="CONTROLLED">Controlled</option><option value="NARCOTIC">Narcotic</option></select></label>
            <label className="text-sm text-text">Storage<select className={`${FIELD} mt-1`} value={form.storage_condition} onChange={(event) => setForm({ ...form, storage_condition: event.target.value as StorageCondition })}><option value="ROOM_TEMPERATURE">Room temperature</option><option value="COOL">Cool</option><option value="COLD_REFRIGERATED">Cold / refrigerated</option></select></label>
            <label className="text-sm text-text">Rack / shelf<input className={`${FIELD} mt-1`} maxLength={100} value={form.rack_location} onChange={(event) => setForm({ ...form, rack_location: event.target.value })} /></label>
            <label className="text-sm text-text">Low-stock threshold<input className={`${FIELD} mt-1`} type="number" min="0" step="1" required value={form.min_stock_alert} onChange={(event) => setForm({ ...form, min_stock_alert: event.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={form.requires_prescription} onChange={(event) => setForm({ ...form, requires_prescription: event.target.checked })} /> Prescription required</label>
          </div>

          <div className="space-y-3 rounded-control border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-bold text-text">Units and sale prices</h4><p className="text-xs text-muted">Prices are integer paisa. Existing units are retained; add another unit if needed.</p></div><button type="button" className={SECONDARY} onClick={() => setForm((current) => ({ ...current, units: [...current.units, { name: '', conversion_factor: '1', is_default_sale_unit: current.units.length === 0, price_paisa: '0', barcode: '' }] }))}><Plus size={14} /> Add unit</button></div>
            {form.units.map((unit, index) => <div key={unit.id ?? `unit-${index}`} className="grid gap-2 rounded-control bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-xs text-text">Unit name *<input className={`${FIELD} mt-1`} required maxLength={100} value={unit.name} onChange={(event) => changeUnit(index, { name: event.target.value })} /></label>
              <label className="text-xs text-text">Base units per unit *<input className={`${FIELD} mt-1`} required type="number" min="1" step="1" value={unit.conversion_factor} onChange={(event) => changeUnit(index, { conversion_factor: event.target.value })} /></label>
              <label className="text-xs text-text">Sale price (paisa) *<input className={`${FIELD} mt-1`} required type="number" min="0" step="1" value={unit.price_paisa} onChange={(event) => changeUnit(index, { price_paisa: event.target.value })} /></label>
              <label className="text-xs text-text">Unit barcode<input className={`${FIELD} mt-1`} maxLength={100} value={unit.barcode} onChange={(event) => changeUnit(index, { barcode: event.target.value })} /></label>
              <label className="flex items-center gap-2 self-center text-sm text-text"><input type="radio" name="default-sale-unit" checked={unit.is_default_sale_unit} onChange={() => changeUnit(index, { is_default_sale_unit: true })} /> Default sale unit</label>
            </div>)}
          </div>
          <div className="flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setShowForm(false)}>Cancel</button><button type="submit" disabled={saving || categories.length === 0 || brands.length === 0} className={BUTTON}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}</button></div>
        </form>
      </div>}
    </div>
  );
}

function StockInventory() {
  const { can } = usePermissions();
  const canAdjust = can('stock_inventory');
  const canSeeCost = can('products');
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [products, setProducts] = useState<Array<Pick<Medicine, 'id' | 'min_stock_alert'>>>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'near-expiry' | 'low-stock'>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adjusting, setAdjusting] = useState<BatchRow | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('damage');
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
      const [batchRows, productRows] = await Promise.all([
        fetchAllSupabaseRows((from, to) => client.from('stock_batches')
          .select('id,medicine_id,batch_number,expiry_date,received_date,cost_paisa_per_base_unit,mrp_paisa_per_base_unit,quantity_remaining,status,supplier_id')
          .order('expiry_date').order('batch_number').order('id')
          .range(from, to)),
        fetchAllSupabaseRows((from, to) => client.from('medicines')
          .select('id,brand_name,generic_name,code,min_stock_alert,is_active')
          .order('id')
          .range(from, to)),
      ]);
      const medicineRows = productRows;
      const supplierIds = Array.from(new Set(batchRows.map((batch) => batch.supplier_id).filter((id): id is string => Boolean(id))));
      const supplierLookup = new Map<string, { name: string }>();
      if (supplierIds.length) {
        for (let index = 0; index < supplierIds.length; index += 500) {
          const { data: supplierRows, error: supplierError } = await client.from('suppliers').select('id,name').in('id', supplierIds.slice(index, index + 500));
          if (supplierError) throw supplierError;
          for (const supplier of supplierRows ?? []) supplierLookup.set(supplier.id, { name: supplier.name });
        }
      }
      const medicineLookup = new Map(medicineRows.map((medicine) => [medicine.id, medicine]));
      setProducts(medicineRows);
      setBatches(batchRows.map((batch) => ({
        ...batch,
        medicine: medicineLookup.get(batch.medicine_id),
        supplier: batch.supplier_id ? supplierLookup.get(batch.supplier_id) ?? null : null,
      })).filter((batch) => batch.medicine));
    } catch (caught) {
      setError(messageFor(caught, 'Could not load stock inventory.'));
      setBatches([]);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const lowStockIds = useMemo(() => {
    const totals = new Map<string, number>();
    for (const batch of batches) {
      if (batch.expiry_date >= today()) {
        totals.set(batch.medicine_id, (totals.get(batch.medicine_id) ?? 0) + batch.quantity_remaining);
      }
    }
    return new Set(products.filter((product) => (totals.get(product.id) ?? 0) <= product.min_stock_alert).map((product) => product.id));
  }, [batches, products]);

  const filteredBatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    const nearCutoff = new Date();
    nearCutoff.setDate(nearCutoff.getDate() + NEAR_EXPIRY_DAYS);
    const cutoff = nearCutoff.toISOString().slice(0, 10);
    return batches.filter((batch) => {
      const nearExpiry = batch.expiry_date >= today() && batch.expiry_date <= cutoff;
      const isLow = lowStockIds.has(batch.medicine_id);
      const matchesFilter = filter === 'all' || (filter === 'near-expiry' && nearExpiry) || (filter === 'low-stock' && isLow);
      const matchesSearch = !query || [batch.batch_number, batch.medicine?.brand_name ?? '', batch.medicine?.generic_name ?? '', batch.medicine?.code ?? '', batch.supplier?.name ?? ''].some((value) => value.toLowerCase().includes(query));
      return matchesFilter && matchesSearch;
    });
  }, [batches, filter, lowStockIds, search]);

  const pageCount = Math.max(1, Math.ceil(filteredBatches.length / PAGE_SIZE));
  const pagedBatches = filteredBatches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const saveAdjustment = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !adjusting) return;
    const quantityDelta = Number(delta);
    if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0 || Math.abs(quantityDelta) > 2147483647) {
      setError('Enter a non-zero whole-number quantity adjustment.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc('adjust_stock', {
        p_batch_id: adjusting.id,
        p_quantity_delta: quantityDelta,
        p_reason: reason,
      });
      if (rpcError) throw rpcError;
      setAdjusting(null);
      setDelta('');
      setNotice('Stock adjustment recorded.');
      await load();
    } catch (caught) {
      setError(messageFor(caught, 'Could not adjust stock.'));
    } finally {
      setSaving(false);
    }
  };

  const statusFor = (batch: BatchRow) => {
    if (batch.expiry_date < today()) return { label: 'Expired', classes: 'bg-danger/10 text-danger' };
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + NEAR_EXPIRY_DAYS);
    if (batch.expiry_date <= threshold.toISOString().slice(0, 10)) return { label: 'Near-expiry', classes: 'bg-warning/15 text-warning' };
    return { label: 'Active', classes: 'bg-primary/10 text-primary' };
  };

  return <div className="space-y-4">
    <section className={`${PANEL} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
      <div><h2 className="text-lg font-black text-text">Stock Inventory</h2><p className="text-sm text-muted">Live batch balances from purchases and stock movements.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><input className={`${FIELD} pl-9`} aria-label="Search batch inventory" placeholder="Search medicine or batch" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} /></label>
        <select aria-label="Stock filter" className={FIELD} value={filter} onChange={(event) => { setPage(1); setFilter(event.target.value as typeof filter); }}><option value="all">All batches</option><option value="near-expiry">Near expiry (90 days)</option><option value="low-stock">Low-stock medicines</option></select>
        <button type="button" aria-label="Refresh stock" className={SECONDARY} onClick={() => void load()} disabled={loading}><RefreshCw size={16} /></button>
      </div>
    </section>
    {error && <div role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
    {notice && <div role="status" className="rounded-control border border-border bg-surface px-4 py-3 text-sm text-text">{notice}</div>}
    <section className={`${PANEL} overflow-hidden`}>
      {loading ? <p className="p-8 text-center text-sm text-muted">Loading stock batches…</p>
        : error ? <p className="p-8 text-center text-sm text-muted">Stock data is unavailable. Retry after resolving the error.</p>
          : pagedBatches.length === 0 ? <p className="p-8 text-center text-sm text-muted">No stock batches match this filter.</p>
            : <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left text-sm">
              <thead className="bg-surface text-xs font-bold uppercase text-muted"><tr><th className="px-4 py-3">Medicine</th><th className="px-4 py-3">Batch</th><th className="px-4 py-3">Expiry</th><th className="px-4 py-3">Qty remaining</th>{canSeeCost && <th className="px-4 py-3">Cost / base unit</th>}<th className="px-4 py-3">MRP / base unit</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Supplier</th>{canAdjust && <th className="px-4 py-3 text-right">Action</th>}</tr></thead>
              <tbody className="divide-y divide-border">{pagedBatches.map((batch) => {
                const status = statusFor(batch);
                return <tr key={batch.id} className="hover:bg-surface/70">
                  <td className="px-4 py-3"><strong className="block text-text">{batch.medicine?.brand_name}</strong><span className="text-xs text-muted">{batch.medicine?.generic_name} · {batch.medicine?.code}</span></td>
                  <td className="px-4 py-3 font-mono">{batch.batch_number}</td><td className="px-4 py-3"><span className="inline-flex items-center gap-1"><Clock3 size={14} />{batch.expiry_date}</span></td>
                  <td className="px-4 py-3 font-bold">{batch.quantity_remaining.toLocaleString()}{lowStockIds.has(batch.medicine_id) && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-warning"><AlertTriangle size={13} />Low</span>}</td>
                  {canSeeCost && <td className="px-4 py-3">{money(batch.cost_paisa_per_base_unit)}</td>}<td className="px-4 py-3">{money(batch.mrp_paisa_per_base_unit)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${status.classes}`}>{status.label}</span></td><td className="px-4 py-3">{batch.supplier?.name ?? '—'}</td>
                  {canAdjust && <td className="px-4 py-3 text-right"><button type="button" className={SECONDARY} onClick={() => { setAdjusting(batch); setDelta(''); setReason('damage'); setError(''); }}><SlidersHorizontal size={14} /> Adjust</button></td>}
                </tr>;
              })}</tbody>
            </table></div>}
      {!loading && filteredBatches.length > PAGE_SIZE && <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted"><span>{filteredBatches.length} batches · Page {page} of {pageCount}</span><div className="flex gap-2"><button type="button" className={SECONDARY} aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><button type="button" className={SECONDARY} aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div></div>}
    </section>

    {adjusting && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={(event) => void saveAdjustment(event)} className={`${PANEL} w-full max-w-md space-y-4 p-5`}>
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black text-text">Adjust batch stock</h3><p className="text-sm text-muted">{adjusting.medicine?.brand_name} · {adjusting.batch_number} · current {adjusting.quantity_remaining}</p></div><button type="button" aria-label="Close stock adjustment" className={SECONDARY} onClick={() => setAdjusting(null)}><X size={16} /></button></div>
      <label className="block text-sm text-text">Quantity change *<span className="mt-1 block text-xs text-muted">Use a negative number to remove stock and a positive number to add stock.</span><input className={`${FIELD} mt-2`} type="number" step="1" required value={delta} onChange={(event) => setDelta(event.target.value)} /></label>
      <label className="block text-sm text-text">Reason *<select className={`${FIELD} mt-1`} required value={reason} onChange={(event) => setReason(event.target.value)}><option value="damage">Damage</option><option value="expired">Expired</option><option value="counting error">Counting error</option><option value="theft">Theft</option><option value="other">Other</option></select></label>
      {error && <p role="alert" className="flex items-center gap-2 text-sm text-danger"><ShieldAlert size={16} />{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setAdjusting(null)}>Cancel</button><button type="submit" className={BUTTON} disabled={saving}>{saving ? 'Saving…' : 'Record adjustment'}</button></div>
    </form></div>}
  </div>;
}
