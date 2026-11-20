export function normalizeReturnInvoiceInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'INV-';
  if (/^(?:https?:\/\/|\/r\/)/i.test(trimmed)) return trimmed;
  if (/^INV-/i.test(trimmed)) return `INV-${trimmed.slice(4)}`;
  return `INV-${trimmed}`;
}
