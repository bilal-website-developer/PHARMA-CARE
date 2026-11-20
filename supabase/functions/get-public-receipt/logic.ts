export interface PublicReceiptItemSource {
  product_name: string;
  unit_name: string;
  quantity_in_unit: number;
  quantity_base_units: number;
  price_paisa_per_unit: number;
  line_total_paisa: number;
  returned_base_units: number;
  pending_base_units: number;
  expiry_months: string[];
}

export interface PublicReceiptSource {
  shop: { name: string; address: string; phone: string; logo_url: string | null };
  sale: {
    invoice_number: string;
    timestamp: string;
    discount_paisa: number;
    total_paisa: number;
    change_paisa: number;
  };
  payments: Array<{ payment_method: string; amount_paisa: number }>;
  items: PublicReceiptItemSource[];
  credit_due_paisa: number;
  has_credit: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function publicShopLogoUrl(
  logoUrl: string | null,
  supabaseUrl: string,
  shopId: string,
): string | null {
  if (!logoUrl || !UUID_PATTERN.test(shopId)) return null;
  try {
    const url = new URL(logoUrl);
    const expectedOrigin = new URL(supabaseUrl).origin;
    if (url.origin !== expectedOrigin || url.username || url.password || url.search || url.hash) return null;
    const logoPath = url.pathname.match(
      /^\/storage\/v1\/object\/public\/shop-logos\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:png|jpg|webp))$/i,
    );
    if (!logoPath || logoPath[1].toLowerCase() !== shopId.toLowerCase()) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isValidReceiptToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

export function isPublicReceiptLinkAvailable(
  expiresAt: string,
  revokedAt: string | null,
  publicReceiptsEnabled: boolean,
  now = Date.now(),
): boolean {
  const expiry = new Date(expiresAt).getTime();
  return publicReceiptsEnabled
    && revokedAt === null
    && Number.isFinite(expiry)
    && expiry > now;
}

export function publicReceiptShowsExpiry(settings: unknown): boolean {
  if (!isRecord(settings)) return true;
  const memo = settings.memo;
  if (!isRecord(memo)) return true;
  const showExpiryDate = memo.showExpiryDate;
  return typeof showExpiryDate === 'boolean' ? showExpiryDate : true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildPublicReceipt(
  source: PublicReceiptSource,
  showMedicineNames: boolean,
  showExpiryMonth = true,
) {
  const paymentMethods = source.payments.map((payment) => ({
    method: payment.payment_method,
    amountPaisa: payment.amount_paisa,
  }));
  const paidPaisa = source.has_credit
    ? 0
    : source.payments.reduce(
      (total, payment) => total + (payment.payment_method === 'CREDIT' ? 0 : payment.amount_paisa),
      0,
    );
  const creditDuePaisa = source.has_credit ? Math.max(0, source.credit_due_paisa) : null;
  return {
    shop: {
      name: source.shop.name,
      address: source.shop.address,
      phone: source.shop.phone,
      logoUrl: source.shop.logo_url,
    },
    invoiceNumber: source.sale.invoice_number,
    dateTime: source.sale.timestamp,
    itemsHidden: !showMedicineNames,
    items: source.items.map((item, index) => {
      const returned = Math.min(item.quantity_base_units, Math.max(0, item.returned_base_units));
      const pending = Math.max(0, item.pending_base_units);
      return {
        name: showMedicineNames ? item.product_name : `Item ${index + 1}`,
        unit: item.unit_name,
        quantity: item.quantity_in_unit,
        pricePaisa: item.price_paisa_per_unit,
        lineTotalPaisa: item.line_total_paisa,
        ...(showExpiryMonth && item.expiry_months.length > 0
          ? { expiryMonths: [...new Set(item.expiry_months.filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)))] }
          : {}),
        ...(pending > 0
          ? { returnStatus: 'pending' }
          : returned === 0
            ? {}
          : returned >= item.quantity_base_units
              ? { returnStatus: 'returned' }
              : { returnStatus: 'partially_returned' }),
      };
    }),
    discountPaisa: source.sale.discount_paisa,
    totalPaisa: source.sale.total_paisa,
    paidPaisa,
    paymentMethods,
    changePaisa: source.sale.change_paisa,
    creditDuePaisa,
    paymentStatus: creditDuePaisa === null || creditDuePaisa === 0
      ? 'paid'
      : paidPaisa > 0
        ? 'partially_paid'
        : 'due',
  };
}

export function receiptSecurityHeaders(origin: string | null, allowedOrigin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Vary': 'Origin',
  };
  if (origin && allowedOrigin && origin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

export function publicReceiptNotFound() {
  return { error: 'Receipt not found.' };
}
