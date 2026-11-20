import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildPublicReceipt,
  isPublicReceiptLinkAvailable,
  isValidReceiptToken,
  publicReceiptShowsExpiry,
  publicShopLogoUrl,
  publicReceiptNotFound,
  receiptSecurityHeaders,
  type PublicReceiptItemSource,
} from './logic.ts';

const configuredOrigin = (Deno.env.get('APP_PUBLIC_URL') ?? '').replace(/\/+$/, '');
const minNotFoundDelayMs = 300;
const allowedHeaders = (origin: string | null) => receiptSecurityHeaders(origin, configuredOrigin || null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonResponse(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...allowedHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function normalizedOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
}

async function hashIp(ip: string, key: string) {
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(ip));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requestIp(request: Request) {
  const cloudflare = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflare) return cloudflare;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').map((part) => part.trim()).filter(Boolean);
  return forwarded?.[forwarded.length - 1] ?? 'unknown';
}

async function waitForNotFound(startedAt: number) {
  const jitter = Math.floor(Math.random() * 40);
  const remaining = minNotFoundDelayMs + jitter - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  const originAllowed = Boolean(configuredOrigin) && normalizedOrigin(configuredOrigin) === configuredOrigin
    && origin === configuredOrigin;
  if (request.method === 'OPTIONS') {
    if (!originAllowed) return jsonResponse(403, { error: 'Forbidden.' }, origin);
    return new Response(null, { status: 204, headers: allowedHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' }, origin);
  if (!originAllowed) return jsonResponse(403, { error: 'Forbidden.' }, origin);

  const startedAt = Date.now();
  const notFound = async () => {
    await waitForNotFound(startedAt);
    return jsonResponse(404, publicReceiptNotFound(), origin);
  };

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(503, { error: 'Receipt service is unavailable.' }, origin);
  }
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let token: unknown;
  let revealItemNames = false;
  try {
    const body: unknown = await request.json();
    if (isRecord(body)) {
      token = body.token;
      revealItemNames = body.revealItemNames === true;
    }
  } catch {
    return notFound();
  }
  if (!isValidReceiptToken(token)) return notFound();

  try {
    const ipKey = await hashIp(requestIp(request), serviceRoleKey);
    const { data: rateAllowed, error: rateError } = await service.rpc('consume_receipt_rate_limit', {
      p_ip_key: ipKey,
      p_limit: 60,
      p_window_seconds: 600,
    });
    if (rateError) throw rateError;
    if (rateAllowed !== true) return jsonResponse(429, { error: 'Too many receipt lookups. Try again later.' }, origin);

    const { data: link, error: linkError } = await service
      .from('sale_receipt_links')
      .select('id,shop_id,sale_id,expires_at,revoked_at')
      .eq('token', token)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) return notFound();

    const { data: settings, error: settingsError } = await service
      .from('shop_receipt_qr_settings')
      .select('public_receipts_enabled,show_medicine_names')
      .eq('shop_id', link.shop_id)
      .maybeSingle();
    if (settingsError) throw settingsError;
    if (!isPublicReceiptLinkAvailable(
      link.expires_at,
      link.revoked_at,
      settings?.public_receipts_enabled === true,
    )) {
      return notFound();
    }

    const { data: sale, error: saleError } = await service
      .from('sales')
      .select('invoice_number,timestamp,discount_paisa,total_paisa,change_paisa')
      .eq('id', link.sale_id)
      .eq('shop_id', link.shop_id)
      .neq('status', 'VOIDED')
      .maybeSingle();
    if (saleError) throw saleError;
    if (!sale) return notFound();

    const [
      { data: shop, error: shopError },
      { data: rawItems, error: itemsError },
      { data: payments, error: paymentsError },
      { data: creditEntries, error: creditError },
      { data: shopSettings, error: shopSettingsError },
      { data: receiptReturns, error: returnsError },
    ] = await Promise.all([
      service.from('shops').select('name,address,phone,logo_path').eq('id', link.shop_id).maybeSingle(),
      service.from('sale_items')
        .select('id,product_name,unit_name,quantity_in_unit,quantity_base_units,price_paisa_per_unit,line_total_paisa')
        .eq('sale_id', link.sale_id).eq('shop_id', link.shop_id).order('created_at'),
      service.from('sale_payments').select('payment_method,amount_paisa')
        .eq('sale_id', link.sale_id).eq('shop_id', link.shop_id),
      service.from('khata_entries').select('entry_type,debit_paisa,credit_paisa')
        .eq('sale_id', link.sale_id).eq('shop_id', link.shop_id)
        .in('entry_type', ['INVOICE', 'RETURN']),
      service.from('shop_settings').select('settings').eq('shop_id', link.shop_id).maybeSingle(),
      service.from('sale_returns').select('id,status')
        .eq('sale_id', link.sale_id).eq('shop_id', link.shop_id).in('status', ['PENDING', 'COMPLETED']),
    ]);
    if (shopError || itemsError || paymentsError || creditError || shopSettingsError || returnsError) {
      throw shopError ?? itemsError ?? paymentsError ?? creditError ?? shopSettingsError ?? returnsError;
    }
    if (!shop) return notFound();

    const pendingReturnIds = (receiptReturns ?? [])
      .filter((row) => row.status === 'PENDING')
      .map((row) => row.id);
    const completedReturnIds = (receiptReturns ?? [])
      .filter((row) => row.status === 'COMPLETED')
      .map((row) => row.id);
    const returnIds = [...pendingReturnIds, ...completedReturnIds];
    let returnRows: Array<{ return_id: string; sale_item_id: string; quantity_base_units: number }> = [];
    if (returnIds.length) {
      const { data, error } = await service.from('sale_return_items')
        .select('return_id,sale_item_id,quantity_base_units')
        .in('return_id', returnIds).eq('shop_id', link.shop_id);
      if (error) throw error;
      returnRows = data ?? [];
    }
    if (payments === null || creditEntries === null || rawItems === null) {
      throw new Error('Receipt data query returned an incomplete result.');
    }

    const expiryMonthsByItem = new Map<string, string[]>();
    if (rawItems.length > 0) {
      const { data: allocations, error: allocationsError } = await service
        .from('sale_item_batch_allocations')
        .select('sale_item_id,expiry_date')
        .eq('shop_id', link.shop_id)
        .in('sale_item_id', rawItems.map((item) => item.id));
      if (allocationsError) throw allocationsError;
      if (allocations === null) throw new Error('Receipt batch query returned an incomplete result.');
      for (const allocation of allocations) {
        const expiryMonths = expiryMonthsByItem.get(allocation.sale_item_id) ?? [];
        expiryMonths.push(allocation.expiry_date.slice(0, 7));
        expiryMonthsByItem.set(allocation.sale_item_id, expiryMonths);
      }
    }

    const returnedByItem = new Map<string, number>();
    const pendingByItem = new Map<string, number>();
    for (const row of returnRows) {
      const quantities = row.return_id && pendingReturnIds.includes(row.return_id)
        ? pendingByItem
        : returnedByItem;
      quantities.set(
        row.sale_item_id,
        (quantities.get(row.sale_item_id) ?? 0) + row.quantity_base_units,
      );
    }
    const items: PublicReceiptItemSource[] = rawItems.map((item) => ({
      product_name: item.product_name,
      unit_name: item.unit_name,
      quantity_in_unit: item.quantity_in_unit,
      quantity_base_units: item.quantity_base_units,
      price_paisa_per_unit: item.price_paisa_per_unit,
      line_total_paisa: item.line_total_paisa,
      returned_base_units: returnedByItem.get(item.id) ?? 0,
      pending_base_units: pendingByItem.get(item.id) ?? 0,
      expiry_months: expiryMonthsByItem.get(item.id) ?? [],
    }));
    const creditDue = creditEntries.reduce(
      (total, entry) => total + entry.debit_paisa - entry.credit_paisa,
      0,
    );
    const hasCredit = payments.some((payment) => payment.payment_method === 'CREDIT');
    const payload = buildPublicReceipt({
      shop: {
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        logo_url: publicShopLogoUrl(shop.logo_path, supabaseUrl, link.shop_id),
      },
      sale,
      payments,
      items,
      credit_due_paisa: creditDue,
      has_credit: hasCredit,
    }, settings.show_medicine_names === true || revealItemNames, publicReceiptShowsExpiry(shopSettings?.settings));

    const { error: viewError } = await service.rpc('record_public_receipt_view', {
      p_link_id: link.id,
    });
    if (viewError) throw viewError;
    return jsonResponse(200, payload, origin);
  } catch (error) {
    console.error('Public receipt lookup failed:', error);
    return jsonResponse(503, { error: 'Receipt service is unavailable.' }, origin);
  }
});
