import { parsePrintSnapshot, type PrintSnapshot } from './printSnapshot';

export type EditableReceiptLine = PrintSnapshot['data']['lines'][number];

export function recalculateEditableReceipt(
  snapshot: PrintSnapshot,
  lines: EditableReceiptLine[],
  discountPaisa: number,
): PrintSnapshot {
  if (snapshot.data.kind !== 'SALE') {
    throw new Error('Only sale receipt requests can be modified.');
  }
  if (lines.length === 0 || lines.length > 100) {
    throw new Error('A modified receipt must contain between 1 and 100 items.');
  }
  for (const [index, line] of lines.entries()) {
    if (!line.name.trim() || !Number.isSafeInteger(line.qty) || line.qty <= 0 || line.qty > 1_000_000
      || !Number.isSafeInteger(line.ratePaisa) || line.ratePaisa < 0) {
      throw new Error(`Receipt item ${index + 1} has an invalid name, quantity, or price.`);
    }
  }
  if (!Number.isSafeInteger(discountPaisa) || discountPaisa < 0) {
    throw new Error('Discount must be a non-negative amount in paisa.');
  }

  const grossPaisa = lines.reduce((sum, line) => sum + line.qty * line.ratePaisa, 0);
  if (!Number.isSafeInteger(grossPaisa) || discountPaisa > grossPaisa) {
    throw new Error('Discount cannot exceed the items subtotal.');
  }
  const salesTaxPaisa = snapshot.data.salesTaxPaisa ?? 0;
  const netBeforeRounding = grossPaisa - discountPaisa + salesTaxPaisa;
  const roundingUnit = snapshot.settings.roundNet === 'none'
    ? 0
    : Number(snapshot.settings.roundNet) * 100;
  const roundingPaisa = roundingUnit
    ? Math.floor(netBeforeRounding / roundingUnit + 0.5) * roundingUnit - netBeforeRounding
    : 0;
  const totalPaisa = netBeforeRounding + roundingPaisa;
  const paidPaisa = snapshot.data.paidPaisa ?? 0;

  return parsePrintSnapshot({
    ...snapshot,
    data: {
      ...snapshot.data,
      lines: lines.map((line) => ({ ...line, name: line.name.trim() })),
      discountPaisa,
      roundingPaisa,
      changePaisa: Math.max(0, paidPaisa - totalPaisa),
    },
  });
}
