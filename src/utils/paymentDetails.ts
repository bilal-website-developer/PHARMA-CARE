import type { SalePaymentDetail } from '../types/pharmacy';
import { getPaymentProvider } from '../data/paymentProviders';

export function formatPaymentDetails(
  details: SalePaymentDetail[] | undefined,
  fallbackMethod: string,
): string {
  if (!details?.length) return fallbackMethod;
  return details.map((detail) => {
    const providerName = getPaymentProvider(detail.providerId)?.name ?? detail.paymentMethod;
    const reference = detail.reference?.trim();
    return `${providerName}: Rs. ${(detail.amountPaisa / 100).toFixed(2)}${
      reference ? ` · Ref: ${reference}` : ''
    }`;
  }).join(' + ');
}
