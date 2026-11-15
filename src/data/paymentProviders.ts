import { PaymentMethod, type PaymentMethod as PaymentMethodType } from '../types/pharmacy';

export type PaymentProviderId =
  | 'cash'
  | 'jazzcash'
  | 'easypaisa'
  | 'sadapay'
  | 'nayapay'
  | 'meezan'
  | 'hbl'
  | 'ubl'
  | 'mcb'
  | 'abl'
  | 'alfalah'
  | 'faysal'
  | 'bop'
  | 'askari'
  | 'other_bank_transfer_raast'
  | 'card';

export interface PaymentProvider {
  id: PaymentProviderId;
  name: string;
  category: 'wallet' | 'bank' | 'cash' | 'card';
  logoPath?: string;
}

export const PAYMENT_PROVIDER_GROUPS: Array<{
  label: string;
  providers: PaymentProvider[];
}> = [
  {
    label: 'Mobile Wallets and FinTech',
    providers: [
      { id: 'jazzcash', name: 'JazzCash', category: 'wallet' },
      { id: 'easypaisa', name: 'Easypaisa', category: 'wallet' },
      { id: 'sadapay', name: 'SadaPay', category: 'wallet', logoPath: '/payment-logos/sadapay.png' },
      { id: 'nayapay', name: 'NayaPay', category: 'wallet', logoPath: '/payment-logos/nayapay.svg' },
    ],
  },
  {
    label: 'Pakistani Banks (IBFT / Raast)',
    providers: [
      { id: 'meezan', name: 'Meezan Bank', category: 'bank', logoPath: '/payment-logos/meezan.png' },
      { id: 'hbl', name: 'HBL (Habib Bank)', category: 'bank', logoPath: '/payment-logos/hbl.png' },
      { id: 'ubl', name: 'UBL (United Bank)', category: 'bank' },
      { id: 'mcb', name: 'MCB Bank', category: 'bank', logoPath: '/payment-logos/mcb.svg' },
      { id: 'abl', name: 'Allied Bank (ABL)', category: 'bank', logoPath: '/payment-logos/abl.png' },
      { id: 'alfalah', name: 'Bank Alfalah', category: 'bank', logoPath: '/payment-logos/alfalah.png' },
      { id: 'faysal', name: 'Faysal Bank', category: 'bank' },
      { id: 'bop', name: 'Bank of Punjab (BOP)', category: 'bank' },
      { id: 'askari', name: 'Askari Bank', category: 'bank' },
      { id: 'other_bank_transfer_raast', name: 'Other Bank Transfer / Raast', category: 'bank' },
    ],
  },
];

export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  { id: 'cash', name: 'Cash', category: 'cash' },
  ...PAYMENT_PROVIDER_GROUPS.flatMap((group) => group.providers),
  { id: 'card', name: 'Card', category: 'card' },
];

export const ONLINE_PAYMENT_PROVIDERS = PAYMENT_PROVIDER_GROUPS.flatMap((group) => group.providers);

export function getPaymentProvider(providerId: PaymentProviderId | string | null | undefined): PaymentProvider | undefined {
  return PAYMENT_PROVIDERS.find((provider) => provider.id === providerId);
}

export function getPaymentMethodForProvider(
  providerId: PaymentProviderId,
): Exclude<PaymentMethodType, PaymentMethodType.SPLIT> {
  if (providerId === 'cash') return PaymentMethod.CASH;
  if (providerId === 'easypaisa') return PaymentMethod.EASYPAISA;
  if (providerId === 'jazzcash') return PaymentMethod.JAZZCASH;
  return PaymentMethod.CARD;
}

export function isPaymentProviderId(value: unknown): value is PaymentProviderId {
  return typeof value === 'string' && PAYMENT_PROVIDERS.some((provider) => provider.id === value);
}
