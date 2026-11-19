export interface PublicReceiptItemSource {
  product_name: string;
  unit_name: string;
  quantity_in_unit: number;
  quantity_base_units: number;
  price_paisa_per_unit: number;
  line_total_paisa: number;
  returned_base_units: number;
  allocations: Array<{
    batch_number: string;
    expiry_date: string;
  }>;
}

export interface PublicReceiptSource {
  shop: { name: string; address: string; phone: string };
  sale: {
    invoice_number: string;
    timestamp: string;
    subtotal_paisa: number;
    discount_paisa: number;
    total_paisa: number;
    amount_tendered_paisa: number;
    change_paisa: number;
    status: string;
  };
  items: PublicReceiptItemSource[];
  credit_due_paisa: number;
  has_credit: boolean;
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

export function buildPublicReceipt(source: PublicReceiptSource, showMedicineNames: boolean) {
  return {
    shop: {
      name: source.shop.name,
      address: source.shop.address,
      phone: source.shop.phone,
    },
    invoiceNumber: source.sale.invoice_number,
    dateTime: source.sale.timestamp,
    items: source.items.map((item, index) => {
      const returned = Math.min(item.quantity_base_units, Math.max(0, item.returned_base_units));
      return {
        name: showMedicineNames ? item.product_name : `Item ${index + 1}`,
        unit: item.unit_name,
        quantity: item.quantity_in_unit,
        pricePaisa: item.price_paisa_per_unit,
        lineTotalPaisa: item.line_total_paisa,
        batchDetails: item.allocations.map((allocation) => ({
          batchNumber: allocation.batch_number,
          expiryDate: allocation.expiry_date,
        })),
        returnStatus: returned === 0
          ? 'not_returned'
          : returned >= item.quantity_base_units
            ? 'returned'
            : 'partially_returned',
      };
    }),
    discountPaisa: source.sale.discount_paisa,
    totalPaisa: source.sale.total_paisa,
    paidPaisa: source.sale.amount_tendered_paisa,
    changePaisa: source.sale.change_paisa,
    creditDuePaisa: source.has_credit ? Math.max(0, source.credit_due_paisa) : null,
    status: source.sale.status,
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
