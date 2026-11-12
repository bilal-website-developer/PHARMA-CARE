-- S5 batch 1: enforce the authenticated user's active shop on product reads.
-- Owner-run only. This migration does not add shops or change function ACLs.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $preflight$
DECLARE
  v_table text;
  v_tables text[] := ARRAY['medicines', 'medicine_units', 'stock_batches'];
  v_signature text;
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
    RAISE EXCEPTION 'S3 trusted shop helper or product authorization helper is missing.';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.products_list(text,text,text,text,text,boolean,text,text,integer,integer)',
    'public.products_overview_stats()',
    'public.products_import_preview(jsonb)',
    'public.pos_catalog()'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Expected routine % is missing; stop and inspect live definitions.', v_signature;
    END IF;
    IF NOT has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE') THEN
      RAISE EXCEPTION 'Routine % has unexpected API execute grants; stop and inspect.', v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = to_regprocedure(v_signature)
        AND routine.prosecdef
        AND routine.proconfig @> ARRAY['search_path=public']
    ) THEN
      RAISE EXCEPTION 'Routine % has unexpected security settings; stop and inspect.', v_signature;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE attrelid = to_regclass(format('public.%I', v_table))
        AND attname = 'shop_id'
        AND attnum > 0
        AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'Expected tenant column public.%.shop_id is missing.', v_table;
    END IF;
  END LOOP;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.products_list(
  p_search text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_manufacturer text DEFAULT NULL,
  p_class text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_low_only boolean DEFAULT false,
  p_sort_col text DEFAULT 'name',
  p_sort_dir text DEFAULT 'asc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 200);
  v_sort_col text := coalesce(p_sort_col, 'name');
  v_sort_dir text := lower(coalesce(p_sort_dir, 'asc'));
  v_shop_id uuid := tenant_private.current_shop_id();
  v_can_view_cost boolean;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_active = true AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['products']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with products permission is required';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'inactive', 'all') THEN
    RAISE EXCEPTION 'Status must be active, inactive, or all';
  END IF;
  IF p_class IS NOT NULL AND p_class NOT IN ('OTC', 'RX', 'CONTROLLED', 'NARCOTIC') THEN
    RAISE EXCEPTION 'Medicine class is invalid';
  END IF;
  IF v_sort_col NOT IN ('name', 'stock', 'expiry', 'mrp') OR v_sort_dir NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Product sort option is invalid';
  END IF;

  v_can_view_cost := public.can_view_cost();
  WITH product_rows AS (
    SELECT
      medicine.id,
      medicine.code,
      medicine.barcode,
      medicine.brand_name,
      medicine.generic_name,
      medicine.strength,
      medicine.category,
      medicine.company,
      medicine.drug_class,
      medicine.storage_condition,
      medicine.rack_location,
      medicine.min_stock_alert,
      medicine.requires_prescription,
      medicine.is_active,
      coalesce(stock.quantity, 0)::bigint AS stock,
      stock.nearest_expiry,
      coalesce(unit.price_paisa, 0)::bigint AS mrp_paisa,
      coalesce(unit.conversion_factor, 1)::bigint AS default_unit_conversion,
      CASE WHEN v_can_view_cost THEN stock.latest_cost_paisa ELSE NULL END AS latest_cost_paisa,
      CASE
        WHEN NOT v_can_view_cost
          OR stock.latest_cost_paisa IS NULL
          OR coalesce(unit.price_paisa, 0) = 0 THEN NULL
        ELSE round(
          ((coalesce(unit.price_paisa, 0)::numeric
            - stock.latest_cost_paisa::numeric * coalesce(unit.conversion_factor, 1))
            * 100)
          / unit.price_paisa::numeric,
          2
        )
      END AS margin_percent
    FROM public.medicines AS medicine
    LEFT JOIN LATERAL (
      SELECT
        sum(batch.quantity_remaining)::bigint AS quantity,
        min(batch.expiry_date) AS nearest_expiry,
        (array_agg(batch.cost_paisa_per_base_unit ORDER BY batch.received_date DESC, batch.id DESC))[1] AS latest_cost_paisa
      FROM public.stock_batches AS batch
      WHERE batch.medicine_id = medicine.id
        AND batch.shop_id = v_shop_id
        AND batch.quantity_remaining > 0
        AND batch.expiry_date >= current_date
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
    ) AS stock ON true
    LEFT JOIN LATERAL (
      SELECT medicine_unit.price_paisa, medicine_unit.conversion_factor
      FROM public.medicine_units AS medicine_unit
      WHERE medicine_unit.medicine_id = medicine.id
        AND medicine_unit.shop_id = v_shop_id
      ORDER BY medicine_unit.is_default_sale_unit DESC, medicine_unit.id
      LIMIT 1
    ) AS unit ON true
    WHERE medicine.shop_id = v_shop_id
      AND (p_status = 'all' OR medicine.is_active = (p_status = 'active'))
      AND (p_category IS NULL OR p_category = '' OR medicine.category = p_category)
      AND (p_manufacturer IS NULL OR p_manufacturer = '' OR medicine.company = p_manufacturer)
      AND (
        p_class IS NULL
        OR (p_class = 'CONTROLLED' AND medicine.drug_class IN ('CONTROLLED', 'NARCOTIC'))
        OR (p_class <> 'CONTROLLED' AND medicine.drug_class = p_class)
      )
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR medicine.brand_name ILIKE '%' || btrim(p_search) || '%'
        OR medicine.generic_name ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(medicine.strength, '') ILIKE '%' || btrim(p_search) || '%'
        OR medicine.code ILIKE '%' || btrim(p_search) || '%'
        OR medicine.category ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(medicine.barcode, '') ILIKE '%' || btrim(p_search) || '%'
        OR medicine.company ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  filtered AS (
    SELECT * FROM product_rows
    WHERE NOT coalesce(p_low_only, false)
      OR (min_stock_alert > 0 AND stock > 0 AND stock <= min_stock_alert)
  ),
  counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ),
  ordered AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN v_sort_col = 'name' AND v_sort_dir = 'asc' THEN brand_name END ASC,
      CASE WHEN v_sort_col = 'name' AND v_sort_dir = 'desc' THEN brand_name END DESC,
      CASE WHEN v_sort_col = 'stock' AND v_sort_dir = 'asc' THEN stock END ASC,
      CASE WHEN v_sort_col = 'stock' AND v_sort_dir = 'desc' THEN stock END DESC,
      CASE WHEN v_sort_col = 'expiry' AND v_sort_dir = 'asc' THEN nearest_expiry END ASC NULLS LAST,
      CASE WHEN v_sort_col = 'expiry' AND v_sort_dir = 'desc' THEN nearest_expiry END DESC NULLS LAST,
      CASE WHEN v_sort_col = 'mrp' AND v_sort_dir = 'asc' THEN mrp_paisa END ASC,
      CASE WHEN v_sort_col = 'mrp' AND v_sort_dir = 'desc' THEN mrp_paisa END DESC,
      id
    OFFSET (v_page - 1) * v_page_size
    LIMIT v_page_size
  )
  SELECT counted.total_count,
    coalesce((SELECT jsonb_agg(to_jsonb(ordered)) FROM ordered), '[]'::jsonb)
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

CREATE OR REPLACE FUNCTION public.products_overview_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_stats jsonb;
  v_can_view_cost boolean;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_active = true AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['products']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with products permission is required';
  END IF;

  v_can_view_cost := public.can_view_cost();
  SELECT jsonb_build_object(
    'total_active', count(*) FILTER (WHERE medicine.is_active),
    'low_stock', count(*) FILTER (
      WHERE medicine.is_active
        AND medicine.min_stock_alert > 0
        AND coalesce(stock.quantity, 0) > 0
        AND stock.quantity <= medicine.min_stock_alert
    ),
    'out_of_stock', count(*) FILTER (
      WHERE medicine.is_active AND coalesce(stock.quantity, 0) = 0
    ),
    'expiring_90', (
      SELECT count(*)
      FROM public.stock_batches AS batch
      JOIN public.medicines AS active_medicine
        ON active_medicine.id = batch.medicine_id
       AND active_medicine.shop_id = batch.shop_id
      WHERE batch.shop_id = v_shop_id
        AND active_medicine.shop_id = v_shop_id
        AND active_medicine.is_active
        AND batch.quantity_remaining > 0
        AND batch.expiry_date BETWEEN current_date AND current_date + 90
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
    ),
    'stock_value_cost_paisa', CASE WHEN v_can_view_cost THEN coalesce((
      SELECT sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
      FROM public.stock_batches AS batch
      JOIN public.medicines AS active_medicine
        ON active_medicine.id = batch.medicine_id
       AND active_medicine.shop_id = batch.shop_id
      WHERE batch.shop_id = v_shop_id
        AND active_medicine.shop_id = v_shop_id
        AND active_medicine.is_active
        AND batch.quantity_remaining > 0
        AND batch.expiry_date >= current_date
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
    ), 0) ELSE NULL END
  )
  INTO v_stats
  FROM public.medicines AS medicine
  LEFT JOIN LATERAL (
    SELECT sum(batch.quantity_remaining)::bigint AS quantity
    FROM public.stock_batches AS batch
    WHERE batch.medicine_id = medicine.id
      AND batch.shop_id = v_shop_id
      AND batch.quantity_remaining > 0
      AND batch.expiry_date >= current_date
      AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
  ) AS stock ON true
  WHERE medicine.shop_id = v_shop_id;

  RETURN v_stats;
END;
$function$;

CREATE OR REPLACE FUNCTION public.products_import_preview(rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_row jsonb;
  v_results jsonb := '[]'::jsonb;
  v_line integer := 1;
  v_duplicate boolean;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_active = true AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['products']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with products permission is required';
  END IF;
  IF rows IS NULL OR jsonb_typeof(rows) <> 'array'
    OR jsonb_array_length(rows) < 1 OR jsonb_array_length(rows) > 2000 THEN
    RAISE EXCEPTION 'Preview must contain between 1 and 2000 product rows';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(rows)
  LOOP
    v_line := coalesce(nullif(v_row->>'line', '')::integer, v_line);
    SELECT EXISTS (
      SELECT 1 FROM public.medicines AS medicine
      WHERE medicine.shop_id = v_shop_id
        AND (
          (
            nullif(btrim(v_row->>'barcode'), '') IS NOT NULL
            AND medicine.barcode = btrim(v_row->>'barcode')
          ) OR (
            nullif(btrim(v_row->>'barcode'), '') IS NULL
            AND lower(btrim(medicine.brand_name)) = lower(btrim(v_row->>'brand_name'))
            AND lower(btrim(medicine.company)) = lower(btrim(v_row->>'company'))
            AND (
              NOT (v_row ? 'strength')
              OR lower(btrim(coalesce(medicine.strength, '')))
                 = lower(btrim(coalesce(v_row->>'strength', '')))
            )
          )
        )
    ) INTO v_duplicate;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'line', v_line,
      'duplicate_in_database', v_duplicate
    ));
    v_line := v_line + 1;
  END LOOP;
  RETURN v_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_catalog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_catalog jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_active = true
      AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['pos']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with POS permission is required';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', medicine.id,
      'code', medicine.code,
      'barcode', medicine.barcode,
      'brandName', medicine.brand_name,
      'genericName', medicine.generic_name,
      'strength', medicine.strength,
      'category', medicine.category,
      'company', medicine.company,
      'drugClass', medicine.drug_class,
      'units', unit_rows.units,
      'batches', batch_rows.batches
    )
    ORDER BY medicine.brand_name, medicine.id
  ), '[]'::jsonb)
  INTO v_catalog
  FROM public.medicines AS medicine
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', unit.id,
        'name', unit.name,
        'conversionFactor', unit.conversion_factor,
        'isDefaultSaleUnit', unit.is_default_sale_unit,
        'pricePerUnitPaisa', unit.price_paisa
      )
      ORDER BY unit.is_default_sale_unit DESC, unit.name, unit.id
    ), '[]'::jsonb) AS units
    FROM public.medicine_units AS unit
    WHERE unit.medicine_id = medicine.id
      AND unit.shop_id = v_shop_id
  ) AS unit_rows
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', batch.id,
        'batchNumber', batch.batch_number,
        'expiryDate', batch.expiry_date,
        'receivedDate', batch.received_date,
        'quantitySmallestUnit', batch.quantity_remaining,
        'status', batch.status
      )
      ORDER BY batch.expiry_date, batch.received_date, batch.id
    ), '[]'::jsonb) AS batches
    FROM public.stock_batches AS batch
    WHERE batch.medicine_id = medicine.id
      AND batch.shop_id = v_shop_id
      AND batch.quantity_remaining > 0
      AND batch.expiry_date >= current_date
      AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
  ) AS batch_rows
  WHERE medicine.shop_id = v_shop_id
    AND medicine.is_active
    AND jsonb_array_length(unit_rows.units) > 0
    AND jsonb_array_length(batch_rows.batches) > 0;

  RETURN v_catalog;
END;
$function$;

DO $postflight$
DECLARE
  v_signature text;
  v_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.products_list(text,text,text,text,text,boolean,text,text,integer,integer)',
    'public.products_overview_stats()',
    'public.products_import_preview(jsonb)',
    'public.pos_catalog()'
  ] LOOP
    SELECT pg_catalog.pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_definition;
    IF position('tenant_private.current_shop_id()' IN v_definition) = 0
       OR position('shop_id = v_shop_id' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Shop scope is missing from %; transaction aborted.', v_signature;
    END IF;
  END LOOP;
END
$postflight$;

COMMIT;
