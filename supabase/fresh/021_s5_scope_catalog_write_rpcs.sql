-- S5 batch 3: scope category/brand writes and bulk product import to the caller shop.
-- Owner-run only. CREATE OR REPLACE preserves the reviewed function ACLs.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $preflight$
DECLARE
  v_signature text;
  v_table text;
  v_save_medicine_definition text;
  v_signatures text[] := ARRAY[
    'public.save_category(uuid,text,boolean)',
    'public.delete_category(uuid)',
    'public.save_brand(uuid,text,boolean)',
    'public.delete_brand(uuid)',
    'public.products_bulk_import(jsonb)'
  ];
  v_tables text[] := ARRAY['categories', 'brands', 'medicines', 'audit_logs'];
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
     OR to_regprocedure('public.save_medicine(uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'S3 tenant helper or S5 save_medicine dependency is missing.';
  END IF;

  IF to_regclass('public.categories_shop_name_lower_key') IS NULL
     OR to_regclass('public.brands_shop_name_lower_key') IS NULL
     OR to_regclass('public.categories_name_lower_key') IS NOT NULL
     OR to_regclass('public.brands_name_lower_key') IS NOT NULL THEN
    RAISE EXCEPTION 'Expected S4 shop-scoped category/brand keys; stop and inspect index state.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    to_regprocedure('public.save_medicine(uuid,jsonb,jsonb)')
  ) INTO v_save_medicine_definition;
  IF position('tenant_private.current_shop_id()' IN v_save_medicine_definition) = 0
     OR position('shop_id = v_shop_id' IN v_save_medicine_definition) = 0 THEN
    RAISE EXCEPTION 'save_medicine is not tenant-scoped; apply its S5 batch before continuing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND tgname = 'audit_logs_assign_shop_id'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'The audit_logs shop-attribution trigger is missing or disabled.';
  END IF;

  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Expected routine % is missing; stop and inspect live definitions.', v_signature;
    END IF;
    IF NOT has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS routine
         WHERE routine.oid = to_regprocedure(v_signature)
           AND routine.prosecdef
           AND routine.proconfig @> ARRAY['search_path=public']
       ) THEN
      RAISE EXCEPTION 'Routine % grants or security settings differ from the reviewed definitions.', v_signature;
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

CREATE OR REPLACE FUNCTION public.save_category(
  p_category_id uuid,
  p_name text,
  p_is_active boolean DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_name text := nullif(btrim(p_name), '');
  v_old_name text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_any_permission(ARRAY['categories']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to manage categories';
  END IF;
  IF v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active shop user with categories permission is required';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Category name is required';
  END IF;

  IF p_category_id IS NULL THEN
    INSERT INTO public.categories (shop_id, name, is_active)
    VALUES (v_shop_id, v_name, coalesce(p_is_active, true))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT category.name INTO v_old_name
  FROM public.categories AS category
  WHERE category.id = p_category_id
    AND category.shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found';
  END IF;

  IF v_old_name IS DISTINCT FROM v_name THEN
    LOCK TABLE public.medicines IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (
      SELECT 1
      FROM public.medicines AS medicine
      WHERE medicine.shop_id = v_shop_id
        AND lower(btrim(medicine.category)) = lower(v_old_name)
    ) AND NOT public.has_any_permission(ARRAY['products']::text[]) THEN
      RAISE EXCEPTION 'Editing a category used by products also requires products permission';
    END IF;
    UPDATE public.medicines
    SET category = v_name
    WHERE shop_id = v_shop_id
      AND lower(btrim(category)) = lower(v_old_name);
  END IF;

  UPDATE public.categories
  SET name = v_name,
      is_active = coalesce(p_is_active, is_active)
  WHERE id = p_category_id
    AND shop_id = v_shop_id
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_category(p_category_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_name text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_any_permission(ARRAY['categories']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to manage categories';
  END IF;
  IF v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active shop user with categories permission is required';
  END IF;

  SELECT category.name INTO v_name
  FROM public.categories AS category
  WHERE category.id = p_category_id
    AND category.shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found';
  END IF;

  LOCK TABLE public.medicines IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1
    FROM public.medicines AS medicine
    WHERE medicine.shop_id = v_shop_id
      AND lower(btrim(medicine.category)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'Category is in use by one or more medicines';
  END IF;
  DELETE FROM public.categories
  WHERE id = p_category_id
    AND shop_id = v_shop_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_brand(
  p_brand_id uuid,
  p_name text,
  p_is_active boolean DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_name text := nullif(btrim(p_name), '');
  v_old_name text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_any_permission(ARRAY['categories']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to manage brands';
  END IF;
  IF v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active shop user with categories permission is required';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Brand name is required';
  END IF;

  IF p_brand_id IS NULL THEN
    INSERT INTO public.brands (shop_id, name, is_active)
    VALUES (v_shop_id, v_name, coalesce(p_is_active, true))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT brand.name INTO v_old_name
  FROM public.brands AS brand
  WHERE brand.id = p_brand_id
    AND brand.shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Brand not found';
  END IF;

  IF v_old_name IS DISTINCT FROM v_name THEN
    LOCK TABLE public.medicines IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (
      SELECT 1
      FROM public.medicines AS medicine
      WHERE medicine.shop_id = v_shop_id
        AND lower(btrim(medicine.company)) = lower(v_old_name)
    ) AND NOT public.has_any_permission(ARRAY['products']::text[]) THEN
      RAISE EXCEPTION 'Editing a brand used by products also requires products permission';
    END IF;
    UPDATE public.medicines
    SET company = v_name
    WHERE shop_id = v_shop_id
      AND lower(btrim(company)) = lower(v_old_name);
  END IF;

  UPDATE public.brands
  SET name = v_name,
      is_active = coalesce(p_is_active, is_active)
  WHERE id = p_brand_id
    AND shop_id = v_shop_id
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_brand(p_brand_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_name text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_any_permission(ARRAY['categories']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to manage brands';
  END IF;
  IF v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active shop user with categories permission is required';
  END IF;

  SELECT brand.name INTO v_name
  FROM public.brands AS brand
  WHERE brand.id = p_brand_id
    AND brand.shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Brand not found';
  END IF;

  LOCK TABLE public.medicines IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1
    FROM public.medicines AS medicine
    WHERE medicine.shop_id = v_shop_id
      AND lower(btrim(medicine.company)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'Brand is in use by one or more medicines';
  END IF;
  DELETE FROM public.brands
  WHERE id = p_brand_id
    AND shop_id = v_shop_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.products_bulk_import(rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_row jsonb;
  v_id uuid;
  v_first_id uuid;
  v_imported integer := 0;
  v_category text;
  v_company text;
  v_values jsonb;
  v_units jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE id = auth.uid()
         AND is_active = true
         AND deleted_at IS NULL
     )
     OR NOT public.has_any_permission(ARRAY['products']::text[]) THEN
    RAISE EXCEPTION 'An active user with products permission is required';
  END IF;
  IF v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active user with products permission is required';
  END IF;
  IF rows IS NULL OR jsonb_typeof(rows) <> 'array'
    OR jsonb_array_length(rows) < 1 OR jsonb_array_length(rows) > 2000 THEN
    RAISE EXCEPTION 'Import must contain between 1 and 2000 product rows';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(rows)
  LOOP
    IF jsonb_typeof(v_row) <> 'object'
      OR nullif(btrim(v_row->>'code'), '') IS NULL
      OR nullif(btrim(v_row->>'brand_name'), '') IS NULL
      OR nullif(btrim(v_row->>'generic_name'), '') IS NULL
      OR nullif(btrim(v_row->>'category'), '') IS NULL
      OR nullif(btrim(v_row->>'company'), '') IS NULL
      OR nullif(btrim(v_row->>'unit_name'), '') IS NULL THEN
      RAISE EXCEPTION 'Every import row must include code, product name, generic name, category, manufacturer, and unit';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.medicines AS medicine
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
    ) THEN
      RAISE EXCEPTION 'Import contains a duplicate product: %', btrim(v_row->>'brand_name');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.categories AS category
      WHERE category.shop_id = v_shop_id
        AND category.is_active
        AND lower(category.name) = lower(btrim(v_row->>'category'))
    ) THEN
      PERFORM public.save_category(NULL, btrim(v_row->>'category'), true);
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.brands AS brand
      WHERE brand.shop_id = v_shop_id
        AND brand.is_active
        AND lower(brand.name) = lower(btrim(v_row->>'company'))
    ) THEN
      PERFORM public.save_brand(NULL, btrim(v_row->>'company'), true);
    END IF;

    SELECT category.name INTO v_category
    FROM public.categories AS category
    WHERE category.shop_id = v_shop_id
      AND category.is_active
      AND lower(category.name) = lower(btrim(v_row->>'category'))
    LIMIT 1;
    SELECT brand.name INTO v_company
    FROM public.brands AS brand
    WHERE brand.shop_id = v_shop_id
      AND brand.is_active
      AND lower(brand.name) = lower(btrim(v_row->>'company'))
    LIMIT 1;

    v_values := jsonb_build_object(
      'code', btrim(v_row->>'code'),
      'barcode', nullif(btrim(v_row->>'barcode'), ''),
      'brand_name', btrim(v_row->>'brand_name'),
      'generic_name', btrim(v_row->>'generic_name'),
      'strength', CASE WHEN v_row ? 'strength'
        THEN nullif(btrim(v_row->>'strength'), '') ELSE NULL END,
      'category', v_category,
      'company', v_company,
      'drug_class', coalesce(nullif(v_row->>'drug_class', ''), 'OTC'),
      'storage_condition', coalesce(nullif(v_row->>'storage_condition', ''), 'ROOM_TEMPERATURE'),
      'rack_location', coalesce(v_row->>'rack_location', ''),
      'min_stock_alert', coalesce(nullif(v_row->>'min_stock_alert', '')::integer, 0),
      'requires_prescription', coalesce(nullif(v_row->>'requires_prescription', '')::boolean, false),
      'is_active', coalesce(nullif(v_row->>'is_active', '')::boolean, true)
    );
    v_units := jsonb_build_array(jsonb_build_object(
      'name', btrim(v_row->>'unit_name'),
      'conversion_factor', (v_row->>'conversion_factor')::integer,
      'is_default_sale_unit', true,
      'price_paisa', (v_row->>'price_paisa')::integer,
      'barcode', nullif(btrim(v_row->>'unit_barcode'), '')
    ));
    v_id := public.save_medicine(NULL, v_values, v_units);
    v_first_id := coalesce(v_first_id, v_id);
    v_imported := v_imported + 1;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    'products_bulk_import',
    'medicines',
    v_first_id,
    jsonb_build_object('imported_count', v_imported)
  );
  RETURN jsonb_build_object('imported_count', v_imported);
END;
$function$;

DO $postflight$
DECLARE
  v_signature text;
  v_definition text;
  v_signatures text[] := ARRAY[
    'public.save_category(uuid,text,boolean)',
    'public.delete_category(uuid)',
    'public.save_brand(uuid,text,boolean)',
    'public.delete_brand(uuid)',
    'public.products_bulk_import(jsonb)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    SELECT pg_catalog.pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_definition;
    IF position('tenant_private.current_shop_id()' IN v_definition) = 0
       OR position('shop_id = v_shop_id' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Routine % is missing an explicit shop scope; transaction aborted.', v_signature;
    END IF;
  END LOOP;
END
$postflight$;

COMMIT;
