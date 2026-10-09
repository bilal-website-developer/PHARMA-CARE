import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Barcode, ChevronLeft, ChevronRight, Clock3, Download, FileUp, Package, Plus, Printer, RefreshCw,
  Search, ShieldAlert, SlidersHorizontal, X,
} from 'lucide-react';
import { usePermissions } from '../permissions';
import { fetchAllSupabaseRows } from '../utils/fetchAllSupabaseRows';
import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';
import {
  BulkActionBar, ConfirmDialog, DataTable, ExpiryChip, FilterChip, KpiCard, StockBar, StatusChip,
  type DataTableColumn,
} from './inventory/InventoryUi';
import {
  parseProductCsv, previewProductCsv, type ProductImportPreviewRow,
} from './inventory/productImportLogic';

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
  latest_cost_paisa: number | null;
  margin_percent: number | null;
  nearest_expiry: string | null;
  mrp_paisa: number;
  default_unit_conversion: number;
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

type ProductListRpcRow = Omit<Medicine, 'units'>;

interface ProductsListResponse {
  rows: ProductListRpcRow[];
  total_count: number;
  can_view_cost: boolean;
}

interface ProductsOverviewStats {
  total_active: number;
  low_stock: number;
  out_of_stock: number;
  expiring_90: number;
  stock_value_cost_paisa: number | null;
}

const today = () => new Date().toISOString().slice(0, 10);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProductsListResponse(value: unknown): value is ProductsListResponse {
  return isRecord(value)
    && Array.isArray(value.rows)
    && typeof value.total_count === 'number'
    && typeof value.can_view_cost === 'boolean'
    && value.rows.every((row) => isRecord(row)
      && typeof row.id === 'string'
      && typeof row.code === 'string'
      && (typeof row.barcode === 'string' || row.barcode === null)
      && typeof row.brand_name === 'string'
      && typeof row.generic_name === 'string'
      && typeof row.category === 'string'
      && typeof row.company === 'string'
      && ['OTC', 'RX', 'CONTROLLED', 'NARCOTIC'].includes(String(row.drug_class))
      && ['ROOM_TEMPERATURE', 'COOL', 'COLD_REFRIGERATED'].includes(String(row.storage_condition))
      && typeof row.rack_location === 'string'
      && typeof row.stock === 'number'
      && typeof row.min_stock_alert === 'number'
      && typeof row.mrp_paisa === 'number'
      && typeof row.default_unit_conversion === 'number'
      && typeof row.requires_prescription === 'boolean'
      && typeof row.is_active === 'boolean'
      && (typeof row.nearest_expiry === 'string' || row.nearest_expiry === null)
      && (row.latest_cost_paisa === null || typeof row.latest_cost_paisa === 'number')
      && (row.margin_percent === null || typeof row.margin_percent === 'number'));
}

function isProductsOverviewStats(value: unknown): value is ProductsOverviewStats {
  return isRecord(value)
    && typeof value.total_active === 'number'
    && typeof value.low_stock === 'number'
    && typeof value.out_of_stock === 'number'
    && typeof value.expiring_90 === 'number'
    && (value.stock_value_cost_paisa === null || typeof value.stock_value_cost_paisa === 'number');
}

function messageFor(error: unknown, fallback: string) {
  return getSupabaseErrorMessage(error, fallback);
}

function money(paisa: number) {
  return `Rs ${(paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function csvCell(value: string | number | boolean | null | undefined) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function safePrintText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
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
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortColumn, setSortColumn] = useState<'name' | 'stock' | 'expiry' | 'mrp'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [bulkCategory, setBulkCategory] = useState('');
  const [confirmBulkDeactivate, setConfirmBulkDeactivate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ProductImportPreviewRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [overviewStats, setOverviewStats] = useState<ProductsOverviewStats | null>(null);
  const [canViewCost, setCanViewCost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [optionsError, setOptionsError] = useState('');
  const [editing, setEditing] = useState<Medicine | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<ProductFormValues>(() => initialProductForm());
  const importInputRef = useRef<HTMLInputElement>(null);

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
      const [listResult, statsResult] = await Promise.all([
        client.rpc('products_list', {
          p_search: search.trim() || null,
          p_category: categoryFilter || null,
          p_manufacturer: brandFilter || null,
          p_class: classFilter || null,
          p_status: activeFilter,
          p_low_only: lowStockOnly,
          p_sort_col: sortColumn,
          p_sort_dir: sortDirection,
          p_page: page,
          p_page_size: PAGE_SIZE,
        }),
        client.rpc('products_overview_stats'),
      ]);
      if (listResult.error) throw listResult.error;
      if (statsResult.error) throw statsResult.error;
      if (!isProductsListResponse(listResult.data)) {
        throw new Error('The product-list service returned an invalid response.');
      }
      if (!isProductsOverviewStats(statsResult.data)) {
        throw new Error('The product summary service returned an invalid response.');
      }

      setTotalCount(listResult.data.total_count);
      setCanViewCost(listResult.data.can_view_cost);
      setOverviewStats(statsResult.data);
      const productsPage = listResult.data.rows;
      if (!productsPage.length) {
        setMedicines([]);
        return;
      }
      const ids = productsPage.map((medicine) => medicine.id);
      const units = await fetchAllSupabaseRows((from, to) => client.from('medicine_units')
          .select('id,medicine_id,name,conversion_factor,is_default_sale_unit,price_paisa,barcode')
          .in('medicine_id', ids)
          .order('is_default_sale_unit', { ascending: false })
          .order('id')
          .range(from, to));

      const unitsByMedicine = new Map<string, MedicineUnit[]>();
      for (const unit of units ?? []) {
        const current = unitsByMedicine.get(unit.medicine_id) ?? [];
        current.push(unit);
        unitsByMedicine.set(unit.medicine_id, current);
      }
      setMedicines(productsPage.map((medicine) => ({
        ...medicine,
        units: unitsByMedicine.get(medicine.id) ?? [],
      })));
    } catch (caught) {
      setError(messageFor(caught, 'Could not load products.'));
      setMedicines([]);
      setOverviewStats(null);
      setCanViewCost(false);
    } finally {
      setLoading(false);
    }
  }, [activeFilter, brandFilter, categoryFilter, classFilter, lowStockOnly, page, search, sortColumn, sortDirection]);

  useEffect(() => {
    void loadOptions().catch((caught) => setOptionsError(messageFor(caught, 'Could not load categories and manufacturers.')));
  }, [loadOptions]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  useEffect(() => {
    setSelectedIds([]);
  }, [activeFilter, brandFilter, categoryFilter, classFilter, lowStockOnly, page, search, sortColumn, sortDirection]);

  const refresh = useCallback(async () => {
    setError('');
    const optionsLoad = loadOptions().catch((caught) => {
      setOptionsError(messageFor(caught, 'Could not load categories and manufacturers.'));
    });
    await Promise.all([optionsLoad, loadProducts()]);
  }, [loadOptions, loadProducts]);

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const visibleMedicines = medicines;

  const exportProducts = () => {
    const productsToExport = selectedIds.length
      ? medicines.filter((medicine) => selectedIds.includes(medicine.id))
      : visibleMedicines;
    if (!productsToExport.length) {
      setNotice('There are no products on this page to export.');
      return;
    }
    const headers = [
      'code', 'barcode', 'brand_name', 'generic_name', 'category', 'company',
      'drug_class', 'storage_condition', 'rack_location', 'min_stock_alert',
      'requires_prescription', 'is_active', 'unit_name', 'conversion_factor',
      'price_paisa', 'unit_barcode',
    ];
    const rows = productsToExport.map((medicine) => {
      const unit = medicine.units.find((item) => item.is_default_sale_unit);
      return [
        medicine.code, medicine.barcode, medicine.brand_name, medicine.generic_name,
        medicine.category, medicine.company, medicine.drug_class, medicine.storage_condition,
        medicine.rack_location, medicine.min_stock_alert, medicine.requires_prescription,
        medicine.is_active, unit?.name ?? '', unit?.conversion_factor ?? '',
        unit?.price_paisa ?? '', unit?.barcode ?? '',
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pharma-care-products-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${productsToExport.length} product${productsToExport.length === 1 ? '' : 's'} from this page.`);
  };

  const prepareImportPreview = async (file: File) => {
    if (!supabase) {
      setNotice('Supabase is not configured.');
      return;
    }
    setImporting(true);
    setNotice('');
    try {
      const parsedRows = parseProductCsv(await file.text());
      const localPreview = previewProductCsv(parsedRows, []);
      const { data, error: previewError } = await supabase.rpc('products_import_preview', {
        rows: localPreview.map(({ line, values }) => ({ ...values, line })),
      });
      if (previewError) throw previewError;
      if (!Array.isArray(data) || data.some((row) => !isRecord(row)
        || typeof row.line !== 'number' || typeof row.duplicate_in_database !== 'boolean')) {
        throw new Error('The import-preview service returned an invalid response.');
      }
      const databaseDuplicates = new Set<number>();
      for (const row of data) {
        if (isRecord(row) && row.duplicate_in_database === true && typeof row.line === 'number') {
          databaseDuplicates.add(row.line);
        }
      }
      setImportPreview(localPreview.map((row) => ({
        ...row,
        errors: databaseDuplicates.has(row.line)
          ? [...row.errors, 'This product already exists in the database.']
          : row.errors,
      })));
    } catch (caught) {
      setNotice(messageFor(caught, 'Could not prepare the CSV import preview.'));
      setImportPreview(null);
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const importProducts = async () => {
    if (!supabase || !importPreview) return;
    const validRows = importPreview.filter((row) => row.errors.length === 0);
    if (validRows.length === 0) {
      setNotice('There are no valid rows to import. Correct the CSV errors and try again.');
      return;
    }
    setImporting(true);
    setNotice('');
    try {
      const { data, error: importError } = await supabase.rpc('products_bulk_import', {
        rows: validRows.map(({ line, values }) => ({ ...values, line })),
      });
      if (importError) throw importError;
      if (!isRecord(data) || typeof data.imported_count !== 'number') {
        throw new Error('The import service returned an invalid response.');
      }
      await loadProducts();
      setSelectedIds([]);
      setNotice(`Imported ${data.imported_count} product${data.imported_count === 1 ? '' : 's'} in one transaction. ${importPreview.length - validRows.length} row(s) were skipped because of preview errors.`);
      setImportPreview(null);
    } catch (caught) {
      setNotice(messageFor(caught, 'Could not import products. No rows were imported.'));
    } finally {
      setImporting(false);
    }
  };

  const applyBulkUpdate = async (action: 'category' | 'deactivate', value: string | null = null) => {
    if (!supabase || selectedIds.length === 0) return;
    setImporting(true);
    setNotice('');
    try {
      const { data, error: updateError } = await supabase.rpc('products_bulk_update', {
        ids: selectedIds,
        action,
        value,
      });
      if (updateError) throw updateError;
      if (typeof data !== 'number') throw new Error('The bulk-update service returned an invalid response.');
      setSelectedIds([]);
      setConfirmBulkDeactivate(false);
      setNotice(`Updated ${data} product${data === 1 ? '' : 's'}.`);
      await loadProducts();
    } catch (caught) {
      setNotice(messageFor(caught, 'Could not update the selected products.'));
    } finally {
      setImporting(false);
    }
  };

  const printBarcodes = () => {
    const productsToPrint = selectedIds.length
      ? medicines.filter((medicine) => selectedIds.includes(medicine.id))
      : visibleMedicines;
    if (!productsToPrint.length) {
      setNotice('There are no products on this page to print.');
      return;
    }
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      setNotice('The barcode-label window was blocked. Allow pop-ups for this site and try again.');
      return;
    }
    const labels = productsToPrint.map((medicine) => {
      const barcodeValue = medicine.barcode || medicine.code;
      return `<article class="label"><strong>${safePrintText(medicine.brand_name)}</strong><span>${safePrintText(medicine.code)}</span><div class="barcode-value">${safePrintText(barcodeValue)}</div></article>`;
    }).join('');
    printWindow.document.write(`<!doctype html><html><head><title>Product barcode labels</title><style>body{font-family:Arial,sans-serif;margin:12mm;color:#111}.sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}.label{height:27mm;border:1px dashed #777;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2mm;text-align:center;padding:2mm;overflow:hidden}.label strong{font-size:11pt}.label span{font-size:8pt}.barcode-value{font-family:monospace;font-size:12pt;letter-spacing:2px}@media print{.label{break-inside:avoid}}</style></head><body><main class="sheet">${labels}</main><script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
    setNotice(`Prepared ${productsToPrint.length} barcode label${productsToPrint.length === 1 ? '' : 's'} using each product barcode (or product code if none is set).`);
  };

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

  const productColumns: DataTableColumn<Medicine>[] = [
    {
      id: 'product',
      header: 'Product',
      sortable: true,
      sortDirection: sortColumn === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none',
      onSort: () => {
        setPage(1);
        if (sortColumn === 'name') setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
        else { setSortColumn('name'); setSortDirection('asc'); }
      },
      render: (medicine) => (
        <div className="min-w-44">
          <strong className="block text-text">{medicine.brand_name}</strong>
          <span className="text-xs text-muted">{medicine.generic_name} · {medicine.code}</span>
          {medicine.barcode && <span className="mt-1 flex items-center gap-1 text-xs text-muted"><Barcode size={13} />{medicine.barcode}</span>}
        </div>
      ),
    },
    {
      id: 'category',
      header: 'Category / manufacturer',
      render: (medicine) => <>{medicine.category}<span className="block text-xs text-muted">{medicine.company}</span></>,
    },
    {
      id: 'class',
      header: 'Class',
      render: (medicine) => <StatusChip variant={medicine.drug_class === 'CONTROLLED' || medicine.drug_class === 'NARCOTIC' ? 'warning' : 'neutral'}>{medicine.drug_class}</StatusChip>,
    },
    {
      id: 'unit-mrp',
      header: 'Unit / MRP',
      sortable: true,
      sortDirection: sortColumn === 'mrp' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none',
      onSort: () => {
        setPage(1);
        if (sortColumn === 'mrp') setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
        else { setSortColumn('mrp'); setSortDirection('asc'); }
      },
      render: (medicine) => {
        const unit = medicine.units.find((item) => item.is_default_sale_unit);
        return unit ? <>{unit.name}<span className="block text-xs text-muted">{money(unit.price_paisa)}</span></> : <span className="text-warning">No unit configured</span>;
      },
    },
    {
      id: 'stock',
      header: 'Current stock',
      sortable: true,
      sortDirection: sortColumn === 'stock' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none',
      onSort: () => {
        setPage(1);
        if (sortColumn === 'stock') setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
        else { setSortColumn('stock'); setSortDirection('asc'); }
      },
      render: (medicine) => <StockBar quantity={medicine.stock} reorderLevel={medicine.min_stock_alert} />,
    },
    {
      id: 'expiry',
      header: 'Nearest expiry',
      sortable: true,
      sortDirection: sortColumn === 'expiry' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none',
      onSort: () => {
        setPage(1);
        if (sortColumn === 'expiry') setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
        else { setSortColumn('expiry'); setSortDirection('asc'); }
      },
      render: (medicine) => <ExpiryChip expiryDate={medicine.nearest_expiry} quantity={medicine.stock} />,
    },
    {
      id: 'status',
      header: 'Status',
      render: (medicine) => <StatusChip variant={medicine.is_active ? 'ok' : 'neutral'}>{medicine.is_active ? 'Active' : 'Inactive'}</StatusChip>,
    },
    ...(canViewCost ? [
      {
        id: 'cost',
        header: 'Unit cost',
        initiallyHidden: true,
        render: (medicine: Medicine) => medicine.latest_cost_paisa === null
          ? '—'
          : money(medicine.latest_cost_paisa * medicine.default_unit_conversion),
      },
      {
        id: 'margin',
        header: 'Margin',
        initiallyHidden: true,
        render: (medicine: Medicine) => medicine.margin_percent === null
          ? '—'
          : `${medicine.margin_percent.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`,
      },
    ] : []),
  ];

  return (
    <div className="space-y-4">
      <section className={`${PANEL} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="text-xl font-black text-text">Inventory Management</h2>
          <p className="text-sm text-muted">Track products, active stock, and nearest batch expiry.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={SECONDARY} aria-label="Refresh products" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} /> Refresh</button>
          <button type="button" className={SECONDARY} onClick={exportProducts}><Download size={16} /> Export page</button>
          <button type="button" className={SECONDARY} onClick={printBarcodes}><Printer size={16} /> Print barcodes</button>
          {canEditProducts && <>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="Choose product CSV"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void prepareImportPreview(file);
              }}
            />
            <button type="button" className={SECONDARY} disabled={importing} onClick={() => importInputRef.current?.click()}><FileUp size={16} /> Import CSV</button>
          </>}
          {canEditProducts && <button type="button" className={BUTTON} onClick={openCreate}><Plus size={16} /> Add product</button>}
        </div>
      </section>

      <section aria-label="Product summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Active products" value={(overviewStats?.total_active ?? 0).toLocaleString()} detail="Across all categories" icon={<Package size={18} />} />
        <KpiCard label="Low stock" value={(overviewStats?.low_stock ?? 0).toLocaleString()} detail="Above zero and at/below reorder level" icon={<AlertTriangle size={18} />} />
        <KpiCard label="Out of stock" value={(overviewStats?.out_of_stock ?? 0).toLocaleString()} detail="No non-expired stock available" icon={<ShieldAlert size={18} />} />
        <KpiCard label="Expiring soon" value={(overviewStats?.expiring_90 ?? 0).toLocaleString()} detail="Batches expiring within 90 days" icon={<Clock3 size={18} />} />
        {canViewCost && <KpiCard label="Stock value at cost" value={money(overviewStats?.stock_value_cost_paisa ?? 0)} detail="Non-expired stock only" />}
      </section>

      <section aria-label="Product search and filters" className={`${PANEL} space-y-3 p-4`}>
        <label className="relative block">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input className={`${FIELD} pl-9`} aria-label="Search products" placeholder="Search product, code, barcode, or manufacturer" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Filter category" className={FIELD + ' w-auto min-w-36'} value={categoryFilter} onChange={(event) => { setPage(1); setCategoryFilter(event.target.value); }}>
            <option value="">All categories</option>
            {categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </select>
          <select aria-label="Filter manufacturer" className={FIELD + ' w-auto min-w-40'} value={brandFilter} onChange={(event) => { setPage(1); setBrandFilter(event.target.value); }}>
            <option value="">All manufacturers</option>
            {brands.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </select>
          <select aria-label="Filter medicine class" className={FIELD + ' w-auto min-w-36'} value={classFilter} onChange={(event) => { setPage(1); setClassFilter(event.target.value); }}>
            <option value="">All classes</option>
            <option value="OTC">OTC</option><option value="RX">RX</option><option value="CONTROLLED">Controlled</option><option value="NARCOTIC">Narcotic</option>
          </select>
          <select aria-label="Filter active status" className={FIELD + ' w-auto min-w-40'} value={activeFilter} onChange={(event) => { setPage(1); setActiveFilter(event.target.value as typeof activeFilter); }}>
            <option value="active">Active products</option><option value="inactive">Inactive products</option><option value="all">All products</option>
          </select>
          <label className="inline-flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm font-semibold text-text">
            <input type="checkbox" checked={lowStockOnly} onChange={(event) => { setPage(1); setLowStockOnly(event.target.checked); }} className="h-4 w-4 accent-green-700" />
            Low stock only
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-text">
            Sort
            <select aria-label="Sort products" className={FIELD + ' w-auto'} value={sortColumn} onChange={(event) => { setPage(1); setSortColumn(event.target.value as typeof sortColumn); }}>
              <option value="name">Name</option><option value="stock">Stock</option><option value="expiry">Expiry</option><option value="mrp">MRP</option>
            </select>
          </label>
          <button type="button" className={SECONDARY} aria-label={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`} onClick={() => { setPage(1); setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc'); }}>
            {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>
        {(search || categoryFilter || brandFilter || classFilter || activeFilter !== 'active' || lowStockOnly) && (
          <div className="flex flex-wrap gap-2" aria-label="Active filters">
            {search && <FilterChip onRemove={() => { setPage(1); setSearch(''); }}>Search: {search}</FilterChip>}
            {categoryFilter && <FilterChip onRemove={() => { setPage(1); setCategoryFilter(''); }}>Category: {categoryFilter}</FilterChip>}
            {brandFilter && <FilterChip onRemove={() => { setPage(1); setBrandFilter(''); }}>Manufacturer: {brandFilter}</FilterChip>}
            {classFilter && <FilterChip onRemove={() => { setPage(1); setClassFilter(''); }}>Class: {classFilter}</FilterChip>}
            {activeFilter !== 'active' && <FilterChip onRemove={() => { setPage(1); setActiveFilter('active'); }}>Status: {activeFilter}</FilterChip>}
            {lowStockOnly && <FilterChip onRemove={() => { setPage(1); setLowStockOnly(false); }}>Low stock only</FilterChip>}
          </div>
        )}
      </section>

      {error && <div role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
      {optionsError && <div role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{optionsError}</div>}
      {notice && <div role="status" className="rounded-control border border-border bg-surface px-4 py-3 text-sm text-text">{notice}</div>}

      <DataTable
        label="Products"
        rows={medicines}
        columns={productColumns}
        getRowId={(medicine) => medicine.id}
        loading={loading}
        emptyTitle={error ? 'Product data unavailable' : 'No products match these filters'}
        emptyDescription={error ? 'Retry after resolving the data error.' : 'Try changing the filters or add a product.'}
        selectedIds={canEditProducts ? selectedIds : undefined}
        onSelectionChange={canEditProducts ? setSelectedIds : undefined}
        pagination={{
          page,
          pageCount,
          totalCount,
          onPageChange: (nextPage) => {
            setSelectedIds([]);
            setPage(nextPage);
          },
        }}
        actions={canEditProducts ? [
          { label: 'Edit product', onSelect: openEdit },
          { label: 'Deactivate product', onSelect: (medicine) => void deactivate(medicine), disabled: (medicine) => !medicine.is_active },
        ] : []}
      />
      {canEditProducts && selectedIds.length > 0 && (
        <div className={`${PANEL} flex flex-wrap items-center gap-2 p-3`}>
          <label className="text-sm font-semibold text-text">New category
            <select aria-label="Bulk category" className={`${FIELD} ml-2 inline-block w-auto min-w-40`} value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}>
              <option value="">Choose category</option>{categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
          </label>
        </div>
      )}
      <BulkActionBar
        selectedCount={canEditProducts ? selectedIds.length : 0}
        onClear={() => setSelectedIds([])}
        actions={[
          { label: 'Update category', onClick: () => bulkCategory ? void applyBulkUpdate('category', bulkCategory) : setNotice('Choose a category before applying the bulk action.'), disabled: importing },
          { label: 'Deactivate selected', onClick: () => setConfirmBulkDeactivate(true), disabled: importing },
        ]}
      />
      <ConfirmDialog
        open={confirmBulkDeactivate}
        title="Deactivate selected products?"
        description={`${selectedIds.length} product(s) will be unavailable for new purchases but remain in historical records.`}
        confirmLabel="Deactivate"
        destructive
        onCancel={() => setConfirmBulkDeactivate(false)}
        onConfirm={() => void applyBulkUpdate('deactivate')}
      />
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="product-import-title" className={`${PANEL} w-full max-w-3xl space-y-4 p-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="product-import-title" className="text-lg font-black text-text">Review product CSV</h2>
                <p className="text-sm text-muted">{importPreview.filter((row) => !row.errors.length).length} valid of {importPreview.length} row(s). Import runs as one transaction.</p>
              </div>
              <button type="button" className={SECONDARY} aria-label="Close import preview" onClick={() => setImportPreview(null)}><X size={16} /></button>
            </div>
            <p className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text">
              Missing categories and manufacturers are created through the existing category/brand functions. Your account needs Categories permission if the import contains new values.
            </p>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto">
              {importPreview.map((row) => (
                <article key={row.line} className="rounded-control border border-border p-3 text-sm">
                  <strong>Line {row.line}: {row.values.brand_name || 'Unnamed product'}</strong>
                  {row.errors.length > 0 && <ul className="mt-1 list-disc pl-5 text-danger">{row.errors.map((message) => <li key={message}>{message}</li>)}</ul>}
                  {row.errors.length === 0 && <p className="mt-1 text-emerald-700">Ready to import</p>}
                </article>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={SECONDARY} onClick={() => setImportPreview(null)}>Cancel</button>
              <button type="button" className={BUTTON} disabled={importing || !importPreview.some((row) => row.errors.length === 0)} onClick={() => void importProducts()}>
                {importing ? 'Importing…' : 'Import valid rows'}
              </button>
            </div>
          </section>
        </div>
      )}

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
