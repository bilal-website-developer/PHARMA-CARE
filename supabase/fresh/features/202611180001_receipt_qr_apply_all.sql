-- Receipt QR package. Owner-run only; never execute from the application.
-- Deliberately contains no top-level BEGIN/COMMIT.
DO $preflight$
DECLARE
  v_signature text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this package as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regnamespace('tenant_private') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('tenant_private.is_current_shop(uuid)') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL THEN
    RAISE EXCEPTION 'S3/S4 tenant helpers or permission helper are missing; stop and inspect.';
  END IF;
  IF to_regclass('public.sales') IS NULL
     OR to_regclass('public.sale_items') IS NULL
     OR to_regclass('public.sale_item_batch_allocations') IS NULL
     OR to_regclass('public.sale_returns') IS NULL
     OR to_regclass('public.sale_return_items') IS NULL
     OR to_regclass('public.audit_logs') IS NULL
     OR to_regclass('public.shops') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'A required S3/S5 table is missing; stop and inspect.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = to_regclass('public.sales') AND relation.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = to_regclass('public.sales')
      AND policy.polname = 'sales_shop_isolation'
      AND NOT policy.polpermissive
  ) THEN
    RAISE EXCEPTION 'S4 sales restrictive tenant isolation is missing or changed; stop and resolve before applying Receipt QR.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = to_regclass('public.sales') AND attname IN (
      'shop_id', 'invoice_number', 'timestamp', 'total_paisa', 'amount_tendered_paisa',
      'change_paisa', 'status'
    ) AND attnum > 0 AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 7
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = to_regclass('public.audit_logs') AND attname = 'shop_id'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Required S4 sale or audit shop columns are missing; stop and inspect before applying.';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_receipt_qr_settings()',
    'public.update_receipt_qr_settings(jsonb)',
    'public.get_or_create_receipt_link(uuid)',
    'public.resolve_receipt_link(text)',
    'public.revoke_receipt_link(uuid)',
    'public.consume_receipt_rate_limit(text,integer,integer)',
    'public.record_public_receipt_view(uuid)',
    'public.sale_id_for_receipt_invoice(text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NOT NULL THEN
      RAISE EXCEPTION 'Receipt QR routine % already exists; stop and inspect instead of replacing it.', v_signature;
    END IF;
  END LOOP;
  IF to_regclass('public.sale_receipt_links') IS NOT NULL
     OR to_regclass('public.shop_receipt_qr_settings') IS NOT NULL
     OR to_regclass('public.receipt_public_rate_limits') IS NOT NULL THEN
    RAISE EXCEPTION 'A Receipt QR table already exists; stop and inspect instead of replacing it.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid IN (
      to_regclass('public.sales'),
      to_regclass('public.sale_items'),
      to_regclass('public.sale_returns')
    )
      AND polname LIKE '%shop_isolation%'
      AND polpermissive
  ) THEN
    RAISE EXCEPTION 'Unexpected permissive S4 tenant policy found; stop and review tenant isolation.';
  END IF;
END
$preflight$;

CREATE TABLE public.sale_receipt_links (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  shop_id uuid NOT NULL DEFAULT tenant_private.current_shop_id()
    REFERENCES public.shops(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_viewed_at timestamptz,
  CONSTRAINT sale_receipt_links_sale_shop_fkey
    FOREIGN KEY (shop_id, sale_id)
    REFERENCES public.sales(shop_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sale_receipt_links_one_active_per_sale
  ON public.sale_receipt_links (sale_id) WHERE revoked_at IS NULL;
CREATE INDEX sale_receipt_links_shop_idx ON public.sale_receipt_links (shop_id);
CREATE INDEX sale_receipt_links_expiry_idx ON public.sale_receipt_links (expires_at)
  WHERE revoked_at IS NULL;
ALTER TABLE public.sale_receipt_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_receipt_links_shop_isolation
  ON public.sale_receipt_links AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_private.is_current_shop(shop_id))
  WITH CHECK (tenant_private.is_current_shop(shop_id));
REVOKE ALL ON TABLE public.sale_receipt_links FROM PUBLIC, anon, authenticated;

CREATE TABLE public.shop_receipt_qr_settings (
  shop_id uuid PRIMARY KEY DEFAULT tenant_private.current_shop_id()
    REFERENCES public.shops(id) ON DELETE RESTRICT,
  public_receipts_enabled boolean NOT NULL DEFAULT false,
  link_lifetime_days integer NOT NULL DEFAULT 90
    CHECK (link_lifetime_days BETWEEN 1 AND 3650),
  show_medicine_names boolean NOT NULL DEFAULT true,
  qr_placement text NOT NULL DEFAULT 'footer'
    CHECK (qr_placement IN ('footer', 'after_totals', 'below_header')),
  qr_base_url text NOT NULL DEFAULT ''
    CHECK (
      qr_base_url = ''
      OR qr_base_url ~ '^https://[^/?#]+/?$'
    ),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.shop_receipt_qr_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_receipt_qr_settings_shop_isolation
  ON public.shop_receipt_qr_settings AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_private.is_current_shop(shop_id))
  WITH CHECK (tenant_private.is_current_shop(shop_id));
REVOKE ALL ON TABLE public.shop_receipt_qr_settings FROM PUBLIC, anon, authenticated;

CREATE TABLE public.receipt_public_rate_limits (
  ip_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX receipt_public_rate_limits_updated_idx
  ON public.receipt_public_rate_limits (updated_at);
ALTER TABLE public.receipt_public_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.receipt_public_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sale_receipt_links, public.shop_receipt_qr_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.receipt_public_rate_limits TO service_role;

CREATE FUNCTION public.get_receipt_qr_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_settings public.shop_receipt_qr_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles AS profile
       WHERE profile.id = auth.uid() AND profile.shop_id = v_shop_id
         AND profile.is_active AND profile.deleted_at IS NULL
     )
     OR NOT public.has_any_permission(ARRAY['settings', 'pos', 'sales_history']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to view receipt QR settings';
  END IF;
  INSERT INTO public.shop_receipt_qr_settings (shop_id)
  VALUES (v_shop_id) ON CONFLICT (shop_id) DO NOTHING;
  SELECT * INTO v_settings FROM public.shop_receipt_qr_settings AS settings
  WHERE settings.shop_id = v_shop_id;
  RETURN pg_catalog.jsonb_build_object(
    'publicReceiptsEnabled', v_settings.public_receipts_enabled,
    'linkLifetimeDays', v_settings.link_lifetime_days,
    'showMedicineNames', v_settings.show_medicine_names,
    'qrPlacement', v_settings.qr_placement,
    'qrBaseUrl', v_settings.qr_base_url
  );
END
$function$;

CREATE FUNCTION public.update_receipt_qr_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_profile public.profiles%ROWTYPE;
  v_enabled boolean;
  v_lifetime integer;
  v_names boolean;
  v_placement text;
  v_base_url text;
  v_result public.shop_receipt_qr_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles AS profile
  WHERE profile.id = v_actor AND profile.shop_id = v_shop_id
    AND profile.is_active AND profile.deleted_at IS NULL;
  IF v_actor IS NULL OR v_shop_id IS NULL OR v_profile.id IS NULL
     OR v_profile.role NOT IN ('admin', 'manager')
     OR NOT public.has_any_permission(ARRAY['settings']::text[]) THEN
    RAISE EXCEPTION 'Only an Admin or Manager with Settings access may update receipt QR settings';
  END IF;
  IF p_settings IS NULL OR pg_catalog.jsonb_typeof(p_settings) <> 'object'
     OR pg_catalog.jsonb_typeof(p_settings->'publicReceiptsEnabled') <> 'boolean'
     OR pg_catalog.jsonb_typeof(p_settings->'linkLifetimeDays') <> 'number'
     OR pg_catalog.jsonb_typeof(p_settings->'showMedicineNames') <> 'boolean'
     OR pg_catalog.jsonb_typeof(p_settings->'qrPlacement') <> 'string'
     OR pg_catalog.jsonb_typeof(p_settings->'qrBaseUrl') <> 'string' THEN
    RAISE EXCEPTION 'Receipt QR settings are invalid';
  END IF;
  v_enabled := (p_settings->>'publicReceiptsEnabled')::boolean;
  v_lifetime := (p_settings->>'linkLifetimeDays')::integer;
  v_names := (p_settings->>'showMedicineNames')::boolean;
  v_placement := p_settings->>'qrPlacement';
  v_base_url := pg_catalog.btrim(p_settings->>'qrBaseUrl');
  IF v_lifetime NOT BETWEEN 1 AND 3650
     OR v_placement NOT IN ('footer', 'after_totals', 'below_header')
     OR (v_base_url <> '' AND v_base_url !~ '^https://[^/?#]+/?$')
     OR pg_catalog.length(v_base_url) > 255 THEN
    RAISE EXCEPTION 'Receipt QR lifetime, placement, or HTTPS base URL is invalid';
  END IF;
  INSERT INTO public.shop_receipt_qr_settings (
    shop_id, public_receipts_enabled, link_lifetime_days, show_medicine_names,
    qr_placement, qr_base_url, updated_by, updated_at
  ) VALUES (
    v_shop_id, v_enabled, v_lifetime, v_names, v_placement, v_base_url, v_actor, pg_catalog.now()
  )
  ON CONFLICT (shop_id) DO UPDATE SET
    public_receipts_enabled = EXCLUDED.public_receipts_enabled,
    link_lifetime_days = EXCLUDED.link_lifetime_days,
    show_medicine_names = EXCLUDED.show_medicine_names,
    qr_placement = EXCLUDED.qr_placement,
    qr_base_url = EXCLUDED.qr_base_url,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_result;
  INSERT INTO public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  VALUES (
    v_shop_id, v_actor, 'RECEIPT_QR_SETTINGS_UPDATED', 'shop_receipt_qr_settings',
    v_shop_id, pg_catalog.jsonb_build_object(
      'enabled', v_enabled, 'link_lifetime_days', v_lifetime,
      'show_medicine_names', v_names, 'qr_placement', v_placement
    )
  );
  RETURN pg_catalog.jsonb_build_object(
    'publicReceiptsEnabled', v_result.public_receipts_enabled,
    'linkLifetimeDays', v_result.link_lifetime_days,
    'showMedicineNames', v_result.show_medicine_names,
    'qrPlacement', v_result.qr_placement,
    'qrBaseUrl', v_result.qr_base_url
  );
END
$function$;

CREATE FUNCTION public.get_or_create_receipt_link(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_settings public.shop_receipt_qr_settings%ROWTYPE;
  v_link public.sale_receipt_links%ROWTYPE;
  v_token text;
  v_expires_at timestamptz;
BEGIN
  IF v_actor IS NULL OR v_shop_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles AS profile
       WHERE profile.id = v_actor AND profile.shop_id = v_shop_id
         AND profile.is_active AND profile.deleted_at IS NULL
     )
     OR NOT public.has_any_permission(ARRAY['pos', 'sales_history']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to create a receipt link';
  END IF;
  SELECT * INTO v_settings FROM public.shop_receipt_qr_settings AS settings
  WHERE settings.shop_id = v_shop_id;
  IF NOT FOUND OR NOT v_settings.public_receipts_enabled THEN
    RAISE EXCEPTION 'Public receipt links are disabled for this shop';
  END IF;
  IF v_settings.qr_base_url = '' THEN
    RAISE EXCEPTION 'The public app URL has not been configured';
  END IF;
  PERFORM 1 FROM public.sales AS sale
  WHERE sale.id = p_sale_id AND sale.shop_id = v_shop_id AND sale.status <> 'VOIDED'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale was not found in your shop'; END IF;
  SELECT * INTO v_link FROM public.sale_receipt_links AS link
  WHERE link.sale_id = p_sale_id AND link.shop_id = v_shop_id AND link.revoked_at IS NULL
  FOR UPDATE;
  IF FOUND AND v_link.expires_at > pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object(
      'token', v_link.token, 'expiresAt', v_link.expires_at, 'qrBaseUrl', v_settings.qr_base_url,
      'qrPlacement', v_settings.qr_placement
    );
  END IF;
  IF FOUND THEN
    UPDATE public.sale_receipt_links AS link
    SET revoked_at = pg_catalog.now()
    WHERE link.id = v_link.id AND link.shop_id = v_shop_id AND link.revoked_at IS NULL;
  END IF;
  v_token := pg_catalog.replace(
    pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
    '-', ''
  );
  v_expires_at := pg_catalog.now() + pg_catalog.make_interval(days => v_settings.link_lifetime_days);
  INSERT INTO public.sale_receipt_links (shop_id, sale_id, token, created_by, expires_at)
  VALUES (v_shop_id, p_sale_id, v_token, v_actor, v_expires_at)
  RETURNING * INTO v_link;
  RETURN pg_catalog.jsonb_build_object(
    'token', v_link.token, 'expiresAt', v_link.expires_at, 'qrBaseUrl', v_settings.qr_base_url,
    'qrPlacement', v_settings.qr_placement
  );
END
$function$;

CREATE FUNCTION public.resolve_receipt_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_sale_id uuid;
  v_invoice text;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_shop_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles AS profile
       WHERE profile.id = v_actor AND profile.shop_id = v_shop_id
         AND profile.is_active AND profile.deleted_at IS NULL
     )
     OR NOT public.has_any_permission(ARRAY['pos', 'sales_history']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to resolve a receipt';
  END IF;
  SELECT link.sale_id INTO v_sale_id
  FROM public.sale_receipt_links AS link
  WHERE link.token = p_token AND link.shop_id = v_shop_id AND link.revoked_at IS NULL;
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'Receipt was not found in your shop'; END IF;
  SELECT sale.invoice_number INTO v_invoice
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id AND sale.shop_id = v_shop_id
    AND sale.status IN ('COMPLETED', 'PARTIALLY_RETURNED');
  IF v_invoice IS NULL THEN RAISE EXCEPTION 'Receipt was not found in your shop'; END IF;
  SELECT pg_catalog.jsonb_build_object(
    'id', sale.id,
    'invoiceNumber', sale.invoice_number,
    'saleDate', sale."timestamp"::date,
    'customerId', sale.customer_id,
    'customerName', sale.customer_name,
    'totalPaisa', sale.total_paisa,
    'items', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'saleItemId', item.id,
        'medicineId', item.medicine_id,
        'productName', item.product_name,
        'genericName', item.generic_name,
        'unitName', item.unit_name,
        'conversionFactor', item.conversion_factor,
        'quantityInUnit', item.quantity_in_unit,
        'quantityBaseUnits', item.quantity_base_units,
        'lineTotalPaisa', item.line_total_paisa,
        'drugClass', medicine.drug_class,
        'storageCondition', medicine.storage_condition,
        'allocations', (
          SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'allocationId', allocation.id,
            'batchId', allocation.batch_id,
            'batchNumber', allocation.batch_number,
            'expiryDate', allocation.expiry_date,
            'quantityBaseUnits', allocation.quantity_base_units,
            'alreadyReturnedBaseUnits', coalesce((
              SELECT sum(return_item.quantity_base_units)
              FROM public.sale_return_items AS return_item
              JOIN public.sale_returns AS return_header
                ON return_header.id = return_item.return_id
               AND return_header.shop_id = v_shop_id
              WHERE return_item.sale_item_batch_allocation_id = allocation.id
                AND return_item.shop_id = v_shop_id
                AND return_header.status IN ('PENDING', 'COMPLETED')
            ), 0)
          ) ORDER BY allocation.expiry_date, allocation.batch_id), '[]'::jsonb)
          FROM public.sale_item_batch_allocations AS allocation
          WHERE allocation.sale_item_id = item.id AND allocation.shop_id = v_shop_id
        )
      ) ORDER BY item.created_at, item.id)
      FROM public.sale_items AS item
      JOIN public.medicines AS medicine
        ON medicine.id = item.medicine_id AND medicine.shop_id = v_shop_id
      WHERE item.sale_id = sale.id AND item.shop_id = v_shop_id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id AND sale.shop_id = v_shop_id;
  RETURN v_result;
END
$function$;

CREATE FUNCTION public.revoke_receipt_link(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_profile public.profiles%ROWTYPE;
  v_settings public.shop_receipt_qr_settings%ROWTYPE;
  v_link public.sale_receipt_links%ROWTYPE;
  v_old_token text;
  v_token text;
  v_expires_at timestamptz;
BEGIN
  SELECT * INTO v_profile FROM public.profiles AS profile
  WHERE profile.id = v_actor AND profile.shop_id = v_shop_id
    AND profile.is_active AND profile.deleted_at IS NULL;
  IF v_actor IS NULL OR v_shop_id IS NULL OR v_profile.id IS NULL
     OR v_profile.role NOT IN ('admin', 'manager')
     OR NOT public.has_any_permission(ARRAY['pos', 'sales_history']::text[]) THEN
    RAISE EXCEPTION 'Only an Admin or Manager with POS or Sales History access may regenerate a receipt QR';
  END IF;
  SELECT * INTO v_settings FROM public.shop_receipt_qr_settings AS settings
  WHERE settings.shop_id = v_shop_id;
  IF NOT FOUND OR NOT v_settings.public_receipts_enabled OR v_settings.qr_base_url = '' THEN
    RAISE EXCEPTION 'Public receipt links must be enabled and configured before regeneration';
  END IF;
  PERFORM 1 FROM public.sales AS sale
  WHERE sale.id = p_sale_id AND sale.shop_id = v_shop_id AND sale.status <> 'VOIDED'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale was not found in your shop'; END IF;
  SELECT * INTO v_link FROM public.sale_receipt_links AS link
  WHERE link.sale_id = p_sale_id AND link.shop_id = v_shop_id AND link.revoked_at IS NULL
  FOR UPDATE;
  IF FOUND THEN
    v_old_token := v_link.token;
    UPDATE public.sale_receipt_links AS link
    SET revoked_at = pg_catalog.now()
    WHERE link.id = v_link.id AND link.shop_id = v_shop_id AND link.revoked_at IS NULL;
  END IF;
  v_token := pg_catalog.replace(
    pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
    '-', ''
  );
  v_expires_at := pg_catalog.now() + pg_catalog.make_interval(days => v_settings.link_lifetime_days);
  INSERT INTO public.sale_receipt_links (shop_id, sale_id, token, created_by, expires_at)
  VALUES (v_shop_id, p_sale_id, v_token, v_actor, v_expires_at)
  RETURNING * INTO v_link;
  INSERT INTO public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  VALUES (
    v_shop_id, v_actor, 'RECEIPT_QR_REGENERATED', 'sale_receipt_link', v_link.id,
    pg_catalog.jsonb_build_object('sale_id', p_sale_id, 'old_token_revoked', v_old_token IS NOT NULL)
  );
  RETURN pg_catalog.jsonb_build_object(
    'token', v_link.token, 'expiresAt', v_link.expires_at, 'qrBaseUrl', v_settings.qr_base_url,
    'qrPlacement', v_settings.qr_placement
  );
END
$function$;

CREATE FUNCTION public.sale_id_for_receipt_invoice(p_invoice_number text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_profile public.profiles%ROWTYPE;
  v_sale_id uuid;
BEGIN
  SELECT * INTO v_profile FROM public.profiles AS profile
  WHERE profile.id = v_actor AND profile.shop_id = v_shop_id
    AND profile.is_active AND profile.deleted_at IS NULL;
  IF v_actor IS NULL OR v_shop_id IS NULL OR v_profile.id IS NULL
     OR v_profile.role NOT IN ('admin', 'manager')
     OR NOT public.has_any_permission(ARRAY['sales_history']::text[]) THEN
    RAISE EXCEPTION 'Only an Admin or Manager with Sales History access may find a receipt';
  END IF;
  SELECT sale.id INTO v_sale_id FROM public.sales AS sale
  WHERE sale.invoice_number = pg_catalog.btrim(p_invoice_number)
    AND sale.shop_id = v_shop_id AND sale.status <> 'VOIDED';
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'Sale was not found in your shop'; END IF;
  RETURN v_sale_id;
END
$function$;

CREATE FUNCTION public.consume_receipt_rate_limit(
  p_ip_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  IF p_ip_key IS NULL OR p_ip_key !~ '^[0-9a-f]{64}$'
     OR p_limit NOT BETWEEN 1 AND 1000
     OR p_window_seconds NOT BETWEEN 1 AND 86400 THEN
    RETURN false;
  END IF;
  DELETE FROM public.receipt_public_rate_limits AS rate_limit
  WHERE rate_limit.updated_at < pg_catalog.now() - interval '1 day';
  INSERT INTO public.receipt_public_rate_limits (ip_key, window_started_at, request_count, updated_at)
  VALUES (p_ip_key, pg_catalog.now(), 1, pg_catalog.now())
  ON CONFLICT (ip_key) DO UPDATE SET
    request_count = CASE
      WHEN public.receipt_public_rate_limits.window_started_at
        <= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds)
      THEN 1 ELSE public.receipt_public_rate_limits.request_count + 1 END,
    window_started_at = CASE
      WHEN public.receipt_public_rate_limits.window_started_at
        <= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds)
      THEN pg_catalog.now() ELSE public.receipt_public_rate_limits.window_started_at END,
    updated_at = pg_catalog.now()
  RETURNING request_count, window_started_at INTO v_count, v_window_start;
  RETURN v_count <= p_limit;
END
$function$;

CREATE FUNCTION public.record_public_receipt_view(p_link_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  UPDATE public.sale_receipt_links
  SET view_count = view_count + 1, last_viewed_at = pg_catalog.now()
  WHERE id = p_link_id AND revoked_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_receipt_qr_settings() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_receipt_qr_settings(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_or_create_receipt_link(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.resolve_receipt_link(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.revoke_receipt_link(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.sale_id_for_receipt_invoice(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.consume_receipt_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_public_receipt_view(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_qr_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_receipt_qr_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_receipt_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_receipt_link(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_receipt_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_id_for_receipt_invoice(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_receipt_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_public_receipt_view(uuid) TO service_role;

DO $postflight$
DECLARE
  v_signature text;
  v_oid oid;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_receipt_qr_settings()',
    'public.update_receipt_qr_settings(jsonb)',
    'public.get_or_create_receipt_link(uuid)',
    'public.resolve_receipt_link(text)',
    'public.revoke_receipt_link(uuid)',
    'public.sale_id_for_receipt_invoice(text)',
    'public.consume_receipt_rate_limit(text,integer,integer)',
    'public.record_public_receipt_view(uuid)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc AS routine
         WHERE routine.oid = v_oid AND routine.prosecdef
           AND routine.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
       )
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           coalesce(
             (SELECT routine.proacl FROM pg_catalog.pg_proc AS routine WHERE routine.oid = v_oid),
             pg_catalog.acldefault('f', (SELECT routine.proowner FROM pg_catalog.pg_proc AS routine WHERE routine.oid = v_oid))
           )
         ) AS privilege
         WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Receipt QR routine % failed its security/ACL postflight.', v_signature;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.get_or_create_receipt_link(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.resolve_receipt_link(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.revoke_receipt_link(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.get_receipt_qr_settings()', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.update_receipt_qr_settings(jsonb)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.sale_id_for_receipt_invoice(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.consume_receipt_rate_limit(text,integer,integer)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.consume_receipt_rate_limit(text,integer,integer)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.record_public_receipt_view(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Receipt QR grants do not match the reviewed role boundaries.';
  END IF;
END
$postflight$;

NOTIFY pgrst, 'reload schema';
