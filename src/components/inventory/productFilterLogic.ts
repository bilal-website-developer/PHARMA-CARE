export type ProductStatusFilter = 'active' | 'inactive' | 'all';
export type ProductFilterKey = 'search' | 'category' | 'manufacturer' | 'class' | 'status' | 'lowStockOnly';

export interface ProductFilterState {
  search: string;
  category: string;
  manufacturer: string;
  drugClass: string;
  status: ProductStatusFilter;
  lowStockOnly: boolean;
}

export interface ActiveProductFilter {
  key: ProductFilterKey;
  label: string;
}

export const DEFAULT_PRODUCT_FILTERS: ProductFilterState = {
  search: '',
  category: '',
  manufacturer: '',
  drugClass: '',
  status: 'active',
  lowStockOnly: false,
};

export function getActiveProductFilters(filters: ProductFilterState): ActiveProductFilter[] {
  const active: ActiveProductFilter[] = [];
  const search = filters.search.trim();

  if (search) active.push({ key: 'search', label: `Search: ${search}` });
  if (filters.category) active.push({ key: 'category', label: `Category: ${filters.category}` });
  if (filters.manufacturer) active.push({ key: 'manufacturer', label: `Manufacturer: ${filters.manufacturer}` });
  if (filters.drugClass) {
    const classLabel = filters.drugClass === 'RX' ? 'Rx' : filters.drugClass;
    active.push({ key: 'class', label: `Class: ${classLabel}` });
  }
  if (filters.status !== 'active') {
    const statusLabel = filters.status === 'inactive' ? 'Inactive' : 'All';
    active.push({ key: 'status', label: `Status: ${statusLabel}` });
  }
  if (filters.lowStockOnly) active.push({ key: 'lowStockOnly', label: 'Low stock only' });

  return active;
}

export function removeProductFilter(
  filters: ProductFilterState,
  key: ProductFilterKey,
): ProductFilterState {
  switch (key) {
    case 'search':
      return { ...filters, search: '' };
    case 'category':
      return { ...filters, category: '' };
    case 'manufacturer':
      return { ...filters, manufacturer: '' };
    case 'class':
      return { ...filters, drugClass: '' };
    case 'status':
      return { ...filters, status: 'active' };
    case 'lowStockOnly':
      return { ...filters, lowStockOnly: false };
  }
}

export function clearProductFilters(): ProductFilterState {
  return { ...DEFAULT_PRODUCT_FILTERS };
}
