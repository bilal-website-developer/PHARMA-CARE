export interface StockAdjustmentPreview {
  delta: number;
  resultingQuantity: number;
}

const MAX_STOCK_QUANTITY = 2_147_483_647;

export function getStockAdjustmentPreview(
  currentQuantity: number,
  rawDelta: string,
): StockAdjustmentPreview | null {
  if (!Number.isSafeInteger(currentQuantity) || currentQuantity < 0 || currentQuantity > MAX_STOCK_QUANTITY) {
    return null;
  }
  if (!/^-?\d+$/.test(rawDelta.trim())) return null;

  const delta = Number(rawDelta);
  const resultingQuantity = currentQuantity + delta;
  if (!Number.isSafeInteger(delta)
    || delta === 0
    || resultingQuantity < 0
    || resultingQuantity > MAX_STOCK_QUANTITY) {
    return null;
  }

  return { delta, resultingQuantity };
}
