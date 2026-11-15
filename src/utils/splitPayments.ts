export interface SplitPaymentAmount {
  amount: string;
}

export interface SplitPaymentSummary {
  paidPaisa: number;
  remainingPaisa: number;
  hasValidRows: boolean;
  isBalanced: boolean;
}

export function parsePaisaAmount(value: string): number | null {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const paisa = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paisa) ? paisa : null;
}

export function getSplitPaymentSummary(
  rows: SplitPaymentAmount[],
  totalPaisa: number,
): SplitPaymentSummary {
  const parsedAmounts = rows.map((row) => parsePaisaAmount(row.amount));
  const hasValidRows = rows.length > 0
    && parsedAmounts.every((amount) => amount !== null && amount > 0);
  const paidPaisa = parsedAmounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  return {
    paidPaisa,
    remainingPaisa: totalPaisa - paidPaisa,
    hasValidRows,
    isBalanced: hasValidRows && paidPaisa === totalPaisa,
  };
}
