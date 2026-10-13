export const STOCK_CHANGED_EVENT = 'pharma:stock-changed';

export function dispatchStockChanged(): void {
  window.dispatchEvent(new Event(STOCK_CHANGED_EVENT));
}
