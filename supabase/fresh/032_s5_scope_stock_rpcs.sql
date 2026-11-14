-- Batch 032: bind stock reads and mutations to the caller's shop.
-- Query 031 found six SECURITY DEFINER stock RPCs without explicit shop scope.
-- Owner-run; function replacements preserve their signatures and response shapes.
BEGIN;

DO $preflight$
DECLARE
  v_signature text;
  v_expected_result text;
  v_expected_arguments text;
  v_routine pg_catalog.pg_proc%rowtype;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this migration as the reviewed database owner role with RLS bypass.';
  END IF;

  IF to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL
     OR to_regprocedure('public.can_view_cost()') IS NULL THEN
    RAISE EXCEPTION 'Required tenant, permission, or cost-visibility helpers are missing.';
  END IF;

  FOR v_signature, v_expected_arguments, v_expected_result IN
    SELECT expected.signature, expected.identity_arguments, expected.result_type
    FROM (VALUES
      ('public.adjust_stock(uuid,integer,text)', 'p_batch_id uuid, p_quantity_delta integer, p_reason text', 'integer'),
      ('public.stock_overview_stats()', '', 'jsonb'),
      ('public.stock_batches_list(text,text,text,integer,integer,uuid,text)', 'p_tab text, p_search text, p_sort text, p_page integer, p_page_size integer, p_medicine_id uuid, p_expiry_bucket text', 'jsonb'),
      ('public.stock_expiry_buckets()', '', 'jsonb'),
      ('public.stock_adjustments_log(integer,integer,date,date,text,uuid)', 'p_page integer, p_page_size integer, p_date_from date, p_date_to date, p_reason text, p_batch_id uuid', 'jsonb'),
      ('public.write_off_expired_batch(uuid,text)', 'p_batch_id uuid, p_reason text', 'jsonb')
    ) AS expected(signature, identity_arguments, result_type)
  LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Expected stock RPC % is missing.', v_signature;
    END IF;

    SELECT * INTO v_routine
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure(v_signature);

    IF pg_catalog.pg_get_function_identity_arguments(v_routine.oid) <> v_expected_arguments
       OR pg_catalog.pg_get_function_result(v_routine.oid) <> v_expected_result
       OR NOT v_routine.prosecdef
       OR NOT (coalesce(v_routine.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public'])
       OR NOT has_function_privilege('authenticated', v_routine.oid, 'EXECUTE')
       OR has_function_privilege('anon', v_routine.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Stock RPC % has an unexpected signature, result, security setting, or grant.', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT expected.table_name
    FROM (VALUES
      ('profiles'), ('medicines'), ('medicine_units'), ('suppliers'),
      ('stock_batches'), ('stock_movements'), ('audit_logs')
    ) AS expected(table_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public'
        AND column_info.table_name = expected.table_name
        AND column_info.column_name = 'shop_id'
    ) OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class table_class
      WHERE table_class.oid = to_regclass('public.' || expected.table_name)
        AND table_class.relrowsecurity
    )
  ) THEN
    RAISE EXCEPTION 'A stock-workflow table lacks shop_id or enabled RLS.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_batch_id uuid,
  p_quantity_delta integer,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_current_quantity integer;
  v_next_quantity bigint;
  v_reason text := lower(btrim(p_reason));
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND shop_id = v_shop_id
      AND is_active AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active shop user is required';
  END IF;
  IF NOT public.has_any_permission(ARRAY['stock_inventory']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to adjust stock';
  END IF;
  IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Stock adjustment quantity must not be zero';
  END IF;
  IF v_reason IS NULL
     OR v_reason NOT IN ('damage', 'expired', 'counting error', 'theft', 'other') THEN
    RAISE EXCEPTION 'Reason must be damage, expired, counting error, theft, or other';
  END IF;

  SELECT quantity_remaining
  INTO v_current_quantity
  FROM public.stock_batches
  WHERE id = p_batch_id AND shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock batch not found';
  END IF;

  v_next_quantity := v_current_quantity::bigint + p_quantity_delta::bigint;
  IF v_next_quantity < 0 THEN
    RAISE EXCEPTION 'Stock adjustment cannot make batch quantity negative';
  END IF;
  IF v_next_quantity > 2147483647 THEN
    RAISE EXCEPTION 'Adjusted quantity exceeds the supported stock limit';
  END IF;

  UPDATE public.stock_batches
  SET quantity_remaining = v_next_quantity::integer
  WHERE id = p_batch_id AND shop_id = v_shop_id;

  INSERT INTO public.stock_movements (
    shop_id, batch_id, movement_type, quantity_delta, reason, created_by
  )
  VALUES (
    v_shop_id, p_batch_id, 'ADJUSTMENT', p_quantity_delta, v_reason, auth.uid()
  );

  RETURN v_next_quantity::integer;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stock_overview_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_can_view_cost boolean;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND shop_id = v_shop_id
      AND is_active = true AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['stock_inventory']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with stock inventory permission is required';
  END IF;

  v_can_view_cost := public.can_view_cost();

  SELECT jsonb_build_object(
    'stock_value_cost_paisa', CASE WHEN v_can_view_cost THEN coalesce((
      SELECT sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
      FROM public.stock_batches batch
      JOIN public.medicines medicine
        ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
      WHERE batch.shop_id = v_shop_id
        AND medicine.is_active
        AND batch.quantity_remaining > 0
        AND batch.expiry_date >= current_date
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
    ), 0) ELSE NULL END,
    'stock_value_mrp_paisa', coalesce((
      SELECT sum(batch.quantity_remaining::numeric * batch.mrp_paisa_per_base_unit)
      FROM public.stock_batches batch
      JOIN public.medicines medicine
        ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
      WHERE batch.shop_id = v_shop_id
        AND medicine.is_active
        AND batch.quantity_remaining > 0
        AND batch.expiry_date >= current_date
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
    ), 0),
    'expiring_30', (
      SELECT count(*)
      FROM public.stock_batches batch
      JOIN public.medicines medicine
        ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
      WHERE batch.shop_id = v_shop_id
        AND medicine.is_active
        AND batch.quantity_remaining > 0
        AND batch.expiry_date BETWEEN current_date AND current_date + 30
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
    ),
    'expired_batches', (
      SELECT count(*)
      FROM public.stock_batches batch
      WHERE batch.shop_id = v_shop_id
        AND batch.quantity_remaining > 0
        AND batch.expiry_date < current_date
    ),
    'expired_value_at_risk_paisa', CASE WHEN v_can_view_cost THEN coalesce((
      SELECT sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
      FROM public.stock_batches batch
      WHERE batch.shop_id = v_shop_id
        AND batch.quantity_remaining > 0
        AND batch.expiry_date < current_date
    ), 0) ELSE NULL END
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stock_batches_list(
  p_tab text DEFAULT 'all',
  p_search text DEFAULT NULL,
  p_sort text DEFAULT 'expiry_asc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_medicine_id uuid DEFAULT NULL,
  p_expiry_bucket text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 500);
  v_search text := nullif(btrim(p_search), '');
  v_sort text := lower(coalesce(p_sort, 'expiry_asc'));
  v_can_view_cost boolean;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND shop_id = v_shop_id
      AND is_active = true AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['stock_inventory']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with stock inventory permission is required';
  END IF;
  IF p_tab IS NULL OR p_tab NOT IN ('all', 'near-expiry', 'expired', 'low-stock') THEN
    RAISE EXCEPTION 'Stock tab must be all, near-expiry, expired, or low-stock';
  END IF;
  IF p_expiry_bucket IS NOT NULL
     AND p_expiry_bucket NOT IN ('expired', '0-30', '31-60', '61-90', '90+') THEN
    RAISE EXCEPTION 'Expiry bucket is invalid';
  END IF;
  IF v_sort NOT IN (
    'medicine_asc', 'medicine_desc', 'batch_asc', 'batch_desc',
    'expiry_asc', 'expiry_desc', 'quantity_asc', 'quantity_desc',
    'cost_asc', 'cost_desc', 'value_asc', 'value_desc'
  ) THEN
    RAISE EXCEPTION 'Stock sort option is invalid';
  END IF;

  v_can_view_cost := public.can_view_cost();
  IF NOT v_can_view_cost AND v_sort IN ('cost_asc', 'cost_desc', 'value_asc', 'value_desc') THEN
    RAISE EXCEPTION 'Cost sort options require cost visibility';
  END IF;

  WITH batch_rows AS (
    SELECT
      batch.id,
      batch.medicine_id,
      medicine.brand_name AS medicine_name,
      medicine.generic_name,
      medicine.code,
      medicine.barcode,
      medicine.is_active AS medicine_is_active,
      medicine.min_stock_alert,
      batch.batch_number,
      batch.expiry_date,
      batch.received_date,
      batch.quantity_remaining,
      batch.status,
      batch.supplier_id,
      supplier.name AS supplier_name,
      batch.mrp_paisa_per_base_unit,
      CASE WHEN v_can_view_cost THEN batch.cost_paisa_per_base_unit ELSE NULL END AS cost_paisa_per_base_unit,
      CASE WHEN v_can_view_cost
        THEN batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit
        ELSE NULL
      END AS stock_value_cost_paisa,
      batch.quantity_remaining > 0
        AND batch.expiry_date >= current_date
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AS is_sellable,
      coalesce((
        SELECT sum(sellable_batch.quantity_remaining)::bigint
        FROM public.stock_batches sellable_batch
        WHERE sellable_batch.medicine_id = medicine.id
          AND sellable_batch.shop_id = v_shop_id
          AND sellable_batch.quantity_remaining > 0
          AND sellable_batch.expiry_date >= current_date
          AND sellable_batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
      ), 0) AS sellable_stock
    FROM public.stock_batches batch
    JOIN public.medicines medicine
      ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
    LEFT JOIN public.suppliers supplier
      ON supplier.id = batch.supplier_id AND supplier.shop_id = v_shop_id
    WHERE batch.shop_id = v_shop_id
      AND (p_medicine_id IS NULL OR batch.medicine_id = p_medicine_id)
      AND (
        v_search IS NULL
        OR batch.batch_number ILIKE '%' || v_search || '%'
        OR medicine.brand_name ILIKE '%' || v_search || '%'
        OR medicine.generic_name ILIKE '%' || v_search || '%'
        OR medicine.code ILIKE '%' || v_search || '%'
        OR coalesce(medicine.barcode, '') ILIKE '%' || v_search || '%'
      )
  ),
  filtered AS (
    SELECT *
    FROM batch_rows
    WHERE
      (
        p_tab = 'all'
        OR (p_tab = 'near-expiry'
          AND medicine_is_active
          AND is_sellable
          AND expiry_date BETWEEN current_date AND current_date + 90)
        OR (p_tab = 'expired'
          AND quantity_remaining > 0
          AND expiry_date < current_date)
        OR (p_tab = 'low-stock'
          AND medicine_is_active
          AND is_sellable
          AND min_stock_alert > 0
          AND sellable_stock > 0
          AND sellable_stock <= min_stock_alert)
      )
      AND (
        p_tab <> 'all'
        OR quantity_remaining > 0
        OR v_search IS NOT NULL
        OR p_medicine_id IS NOT NULL
      )
      AND (
        p_expiry_bucket IS NULL
        OR (p_expiry_bucket = 'expired'
          AND quantity_remaining > 0
          AND expiry_date < current_date)
        OR (p_expiry_bucket = '0-30'
          AND medicine_is_active
          AND is_sellable
          AND expiry_date BETWEEN current_date AND current_date + 30)
        OR (p_expiry_bucket = '31-60'
          AND medicine_is_active
          AND is_sellable
          AND expiry_date BETWEEN current_date + 31 AND current_date + 60)
        OR (p_expiry_bucket = '61-90'
          AND medicine_is_active
          AND is_sellable
          AND expiry_date BETWEEN current_date + 61 AND current_date + 90)
        OR (p_expiry_bucket = '90+'
          AND medicine_is_active
          AND is_sellable
          AND expiry_date > current_date + 90)
      )
  ),
  counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ),
  page_rows AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN v_sort = 'medicine_asc' THEN lower(medicine_name) END ASC,
      CASE WHEN v_sort = 'medicine_desc' THEN lower(medicine_name) END DESC,
      CASE WHEN v_sort = 'batch_asc' THEN lower(batch_number) END ASC,
      CASE WHEN v_sort = 'batch_desc' THEN lower(batch_number) END DESC,
      CASE WHEN v_sort = 'expiry_asc' THEN expiry_date END ASC,
      CASE WHEN v_sort = 'expiry_desc' THEN expiry_date END DESC,
      CASE WHEN v_sort = 'quantity_asc' THEN quantity_remaining END ASC,
      CASE WHEN v_sort = 'quantity_desc' THEN quantity_remaining END DESC,
      CASE WHEN v_sort = 'cost_asc' THEN cost_paisa_per_base_unit END ASC NULLS LAST,
      CASE WHEN v_sort = 'cost_desc' THEN cost_paisa_per_base_unit END DESC NULLS LAST,
      CASE WHEN v_sort = 'value_asc' THEN stock_value_cost_paisa END ASC NULLS LAST,
      CASE WHEN v_sort = 'value_desc' THEN stock_value_cost_paisa END DESC NULLS LAST,
      expiry_date ASC,
      batch_number ASC,
      id
    OFFSET (v_page - 1) * v_page_size
    LIMIT v_page_size
  )
  SELECT counted.total_count,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', page_rows.id,
        'medicine_id', page_rows.medicine_id,
        'medicine_name', page_rows.medicine_name,
        'generic_name', page_rows.generic_name,
        'code', page_rows.code,
        'barcode', page_rows.barcode,
        'batch_number', page_rows.batch_number,
        'expiry_date', page_rows.expiry_date,
        'received_date', page_rows.received_date,
        'quantity_remaining', page_rows.quantity_remaining,
        'status', page_rows.status,
        'supplier_id', page_rows.supplier_id,
        'supplier_name', page_rows.supplier_name,
        'min_stock_alert', page_rows.min_stock_alert,
        'cost_paisa_per_base_unit', page_rows.cost_paisa_per_base_unit,
        'mrp_paisa_per_base_unit', page_rows.mrp_paisa_per_base_unit,
        'stock_value_cost_paisa', page_rows.stock_value_cost_paisa,
        'is_sellable', page_rows.is_sellable
      ) ORDER BY page_rows.expiry_date, page_rows.batch_number, page_rows.id)
      FROM page_rows
    ), '[]'::jsonb)
  INTO v_total, v_rows
  FROM counted;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'can_view_cost', v_can_view_cost
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.stock_expiry_buckets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND shop_id = v_shop_id
      AND is_active = true AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['stock_inventory']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with stock inventory permission is required';
  END IF;

  SELECT jsonb_build_object(
    'buckets', jsonb_build_array(
      jsonb_build_object(
        'key', 'expired',
        'label', 'Expired',
        'count', count(*) FILTER (WHERE batch.expiry_date < current_date),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE batch.expiry_date < current_date), 0)
      ),
      jsonb_build_object(
        'key', '0-30',
        'label', '0-30 days',
        'count', count(*) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date AND current_date + 30),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date AND current_date + 30), 0)
      ),
      jsonb_build_object(
        'key', '31-60',
        'label', '31-60 days',
        'count', count(*) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date + 31 AND current_date + 60),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date + 31 AND current_date + 60), 0)
      ),
      jsonb_build_object(
        'key', '61-90',
        'label', '61-90 days',
        'count', count(*) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date + 61 AND current_date + 90),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date + 61 AND current_date + 90), 0)
      ),
      jsonb_build_object(
        'key', '90+',
        'label', '90+ days',
        'count', count(*) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date > current_date + 90),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date > current_date + 90), 0)
      )
    )
  )
  INTO v_result
  FROM public.stock_batches batch
  JOIN public.medicines medicine
    ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
  WHERE batch.shop_id = v_shop_id
    AND batch.quantity_remaining > 0
    AND (
      batch.expiry_date < current_date
      OR (medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY'))
    );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stock_adjustments_log(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 500);
  v_reason text := nullif(lower(btrim(p_reason)), '');
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND shop_id = v_shop_id
      AND is_active = true AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['stock_inventory']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with stock inventory permission is required';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Start date must not be after end date';
  END IF;

  WITH filtered AS (
    SELECT
      movement.id,
      movement.batch_id,
      movement.movement_type,
      movement.quantity_delta,
      movement.reason,
      movement.created_at,
      batch.batch_number,
      medicine.id AS medicine_id,
      medicine.brand_name AS medicine_name,
      medicine.generic_name,
      coalesce(profile.username, profile.full_name, 'Unknown') AS actor_name
    FROM public.stock_movements movement
    JOIN public.stock_batches batch
      ON batch.id = movement.batch_id AND batch.shop_id = v_shop_id
    JOIN public.medicines medicine
      ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
    LEFT JOIN public.profiles profile
      ON profile.id = movement.created_by AND profile.shop_id = v_shop_id
    WHERE movement.shop_id = v_shop_id
      AND (
        (p_batch_id IS NULL AND movement.movement_type IN ('ADJUSTMENT', 'WRITE_OFF'))
        OR (
          p_batch_id IS NOT NULL
          AND movement.batch_id = p_batch_id
          AND movement.movement_type IN (
            'RECEIPT', 'SALE', 'SALE_RETURN', 'ADJUSTMENT', 'WRITE_OFF', 'PURCHASE_RETURN'
          )
        )
      )
      AND (p_date_from IS NULL OR movement.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR movement.created_at::date <= p_date_to)
      AND (v_reason IS NULL OR lower(btrim(movement.reason)) = v_reason)
  ),
  counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ),
  page_rows AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC, id DESC
    OFFSET (v_page - 1) * v_page_size
    LIMIT v_page_size
  )
  SELECT counted.total_count,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', page_rows.id,
        'batch_id', page_rows.batch_id,
        'batch_number', page_rows.batch_number,
        'medicine_id', page_rows.medicine_id,
        'medicine_name', page_rows.medicine_name,
        'generic_name', page_rows.generic_name,
        'movement_type', page_rows.movement_type,
        'quantity_delta', page_rows.quantity_delta,
        'reason', page_rows.reason,
        'created_at', page_rows.created_at,
        'actor_name', page_rows.actor_name
      ) ORDER BY page_rows.created_at DESC, page_rows.id DESC)
      FROM page_rows
    ), '[]'::jsonb)
  INTO v_total, v_rows
  FROM counted;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'page', v_page,
    'page_size', v_page_size
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.write_off_expired_batch(
  p_batch_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_batch record;
  v_reason text := lower(btrim(p_reason));
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND shop_id = v_shop_id
      AND is_active = true AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active shop user is required';
  END IF;
  IF NOT public.has_any_permission(ARRAY['stock_inventory']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to write off stock';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'A stock batch is required';
  END IF;
  IF v_reason IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'Write-off reason must be expired';
  END IF;

  SELECT id, batch_number, expiry_date, quantity_remaining
  INTO v_batch
  FROM public.stock_batches
  WHERE id = p_batch_id AND shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock batch not found';
  END IF;
  IF v_batch.expiry_date >= current_date THEN
    RAISE EXCEPTION 'Only an expired batch can be written off';
  END IF;
  IF v_batch.quantity_remaining <= 0 THEN
    RAISE EXCEPTION 'Expired batch has no remaining stock to write off';
  END IF;

  UPDATE public.stock_batches
  SET quantity_remaining = 0
  WHERE id = v_batch.id AND shop_id = v_shop_id;

  INSERT INTO public.stock_movements (
    shop_id, batch_id, movement_type, quantity_delta, reason, created_by
  )
  VALUES (
    v_shop_id, v_batch.id, 'WRITE_OFF', -v_batch.quantity_remaining, v_reason, auth.uid()
  );

  INSERT INTO public.audit_logs (
    shop_id, actor_id, action, entity, entity_id, details
  )
  VALUES (
    v_shop_id,
    auth.uid(),
    'stock_batch_write_off',
    'stock_batches',
    v_batch.id,
    jsonb_build_object(
      'batch_number', v_batch.batch_number,
      'expiry_date', v_batch.expiry_date,
      'quantity_before', v_batch.quantity_remaining,
      'quantity_after', 0,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'batch_id', v_batch.id,
    'quantity_before', v_batch.quantity_remaining,
    'quantity_after', 0,
    'movement_type', 'WRITE_OFF',
    'reason', v_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.adjust_stock(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_overview_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_batches_list(text, text, text, integer, integer, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_expiry_buckets() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_adjustments_log(integer, integer, date, date, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.write_off_expired_batch(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_overview_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_batches_list(text, text, text, integer, integer, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_expiry_buckets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_adjustments_log(integer, integer, date, date, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_off_expired_batch(uuid, text) TO authenticated;

DO $postflight$
DECLARE
  v_signature text;
  v_routine pg_catalog.pg_proc%rowtype;
  v_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.adjust_stock(uuid,integer,text)',
    'public.stock_overview_stats()',
    'public.stock_batches_list(text,text,text,integer,integer,uuid,text)',
    'public.stock_expiry_buckets()',
    'public.stock_adjustments_log(integer,integer,date,date,text,uuid)',
    'public.write_off_expired_batch(uuid,text)'
  ] LOOP
    SELECT * INTO v_routine
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure(v_signature);
    v_definition := lower(pg_catalog.pg_get_functiondef(v_routine.oid));
    IF NOT v_routine.prosecdef
       OR NOT (coalesce(v_routine.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public'])
       OR position('tenant_private.current_shop_id()' IN v_definition) = 0
       OR position('shop_id = v_shop_id' IN v_definition) = 0
       OR has_function_privilege('anon', v_routine.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_routine.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Scoped stock RPC % failed security or API grant postflight.', v_signature;
    END IF;
  END LOOP;
END;
$postflight$;

COMMIT;
