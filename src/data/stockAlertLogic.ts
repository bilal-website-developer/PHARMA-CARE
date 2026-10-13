export interface StockAlertItem {
  medicine_id: string;
  name: string;
  strength: string | null;
  generic_name: string;
  stock: number;
  min_stock_alert: number;
  kind: 'low' | 'out';
}

export interface StockAlertsSummary {
  low_count: number;
  out_count: number;
  generated_at: string;
  items: StockAlertItem[];
}

export type StockAlertLinkTarget = 'stock-inventory' | 'products' | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isStockAlertItem(value: unknown): value is StockAlertItem {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'medicine_id', 'name', 'strength', 'generic_name', 'stock', 'min_stock_alert', 'kind',
  ])) return false;

  return typeof value.medicine_id === 'string'
    && value.medicine_id.length > 0
    && typeof value.name === 'string'
    && (typeof value.strength === 'string' || value.strength === null)
    && typeof value.generic_name === 'string'
    && isNonNegativeInteger(value.stock)
    && isNonNegativeInteger(value.min_stock_alert)
    && value.min_stock_alert > 0
    && (value.kind === 'low' || value.kind === 'out')
    && (value.kind === 'out' ? value.stock === 0 : value.stock > 0 && value.stock <= value.min_stock_alert);
}

export function isStockAlertsSummary(value: unknown): value is StockAlertsSummary {
  return isRecord(value)
    && hasOnlyKeys(value, ['low_count', 'out_count', 'generated_at', 'items'])
    && isNonNegativeInteger(value.low_count)
    && isNonNegativeInteger(value.out_count)
    && typeof value.generated_at === 'string'
    && Number.isFinite(Date.parse(value.generated_at))
    && Array.isArray(value.items)
    && value.items.every(isStockAlertItem);
}

export function formatStockAlertBadgeCount(count: number): string | null {
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

export function stockAlertKey(item: Pick<StockAlertItem, 'medicine_id' | 'kind'>): string {
  return `${item.medicine_id}\u0000${item.kind}`;
}

export function getUnseenStockAlertKeys(
  items: readonly StockAlertItem[],
  seenKeys: ReadonlySet<string>,
): string[] {
  return [...new Set(items.map(stockAlertKey))].filter((key) => !seenKeys.has(key));
}

export function getStockAlertLinkTarget(
  hasStockInventoryPermission: boolean,
  hasProductsPermission: boolean,
): StockAlertLinkTarget {
  if (hasStockInventoryPermission) return 'stock-inventory';
  if (hasProductsPermission) return 'products';
  return null;
}
