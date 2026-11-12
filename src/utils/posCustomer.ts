export function resolvePosCustomerName(
  registeredCustomerName: string | undefined,
  walkInCustomerName: string,
): string {
  return registeredCustomerName?.trim() || walkInCustomerName.trim() || 'Walk-in Customer';
}

export function isValidOptionalPhone(value: string): boolean {
  return !value.trim() || /^\+?\d+$/.test(value.trim());
}
