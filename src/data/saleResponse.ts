export function findSavedSaleForResponse<T extends { id: string }>(
  response: unknown,
  recentSales: T[],
): T | null {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return null;
  if (!('id' in response) || typeof response.id !== 'string') return null;
  return recentSales.find((sale) => sale.id === response.id) ?? null;
}
