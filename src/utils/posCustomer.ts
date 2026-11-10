export function resolvePosCustomerName(
  registeredCustomerName: string | undefined,
  walkInCustomerName: string,
): string {
  return registeredCustomerName?.trim() || walkInCustomerName.trim() || 'Walk-in Customer';
}
