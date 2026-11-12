-- S5 batch 2: scope medicine create/update and nested unit writes to the caller shop.
-- Owner-run only. Existing function ACLs are preserved.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $preflight$
DECLARE
  v_table text;
  v_tables text[] := ARRAY['categories', 'brands', 'medicines', 'medicine_units'];
  v_signature text := 'public.save_medicine(uuid,jsonb,jsonb)';
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
     OR to_regprocedure(v_signature) IS NULL THEN
    RAISE EXCEPTION 'S3 tenant helper or expected save_medicine routine is missing.';
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
    RAISE EXCEPTION 'save_medicine API grants or security settings differ from the reviewed routine.';
  END IF;

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

CREATE OR REPLACE FUNCTION public.save_medicine(
  p_medicine_id uuid,
  p_values jsonb,
  p_units jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_id uuid;
  v_unit jsonb;
  v_unit_id uuid;
  v_unit_name text;
  v_unit_factor integer;
  v_unit_price integer;
  v_is_default boolean;
  v_default_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['products']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with products permission is required';
  END IF;

  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'Medicine details are required';
  END IF;
  IF nullif(btrim(p_values->>'code'), '') IS NULL
     OR nullif(btrim(p_values->>'brand_name'), '') IS NULL
     OR nullif(btrim(p_values->>'generic_name'), '') IS NULL
     OR nullif(btrim(p_values->>'category'), '') IS NULL
     OR nullif(btrim(p_values->>'company'), '') IS NULL
     OR nullif(btrim(p_values->>'drug_class'), '') IS NULL THEN
    RAISE EXCEPTION 'Code, brand, generic, category, and manufacturer are required';
  END IF;
  IF p_values->>'drug_class' NOT IN ('OTC', 'RX', 'CONTROLLED', 'NARCOTIC') THEN
    RAISE EXCEPTION 'Invalid medicine classification';
  END IF;
  IF coalesce(nullif(p_values->>'storage_condition', ''), 'ROOM_TEMPERATURE')
       NOT IN ('ROOM_TEMPERATURE', 'COOL', 'COLD_REFRIGERATED') THEN
    RAISE EXCEPTION 'Invalid storage condition';
  END IF;
  IF coalesce(nullif(p_values->>'min_stock_alert', '')::bigint, 0) < 0
     OR coalesce(nullif(p_values->>'min_stock_alert', '')::bigint, 0) > 2147483647 THEN
    RAISE EXCEPTION 'Minimum stock threshold is out of range';
  END IF;
  IF p_units IS NULL
     OR jsonb_typeof(p_units) <> 'array'
     OR jsonb_array_length(p_units) = 0 THEN
    RAISE EXCEPTION 'At least one medicine unit is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.categories
    WHERE shop_id = v_shop_id
      AND is_active
      AND lower(name) = lower(btrim(p_values->>'category'))
  ) THEN
    RAISE EXCEPTION 'Select an active category';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.brands
    WHERE shop_id = v_shop_id
      AND is_active
      AND lower(name) = lower(btrim(p_values->>'company'))
  ) THEN
    RAISE EXCEPTION 'Select an active manufacturer';
  END IF;

  FOR v_unit IN SELECT value FROM jsonb_array_elements(p_units)
  LOOP
    v_unit_name := nullif(btrim(v_unit->>'name'), '');
    v_unit_factor := nullif(v_unit->>'conversion_factor', '')::integer;
    v_unit_price := nullif(v_unit->>'price_paisa', '')::integer;
    v_is_default := coalesce((v_unit->>'is_default_sale_unit')::boolean, false);

    IF jsonb_typeof(v_unit) <> 'object' OR v_unit_name IS NULL THEN
      RAISE EXCEPTION 'Every unit needs a name';
    END IF;
    IF v_unit_factor IS NULL OR v_unit_factor <= 0 OR v_unit_factor > 2147483647 THEN
      RAISE EXCEPTION 'Unit conversion factor must be greater than zero';
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 OR v_unit_price > 2147483647 THEN
      RAISE EXCEPTION 'Unit price cannot be negative';
    END IF;
    IF v_is_default THEN
      v_default_count := v_default_count + 1;
    END IF;
  END LOOP;
  IF v_default_count <> 1 THEN
    RAISE EXCEPTION 'Exactly one unit must be the default sale unit';
  END IF;

  IF p_medicine_id IS NULL THEN
    INSERT INTO public.medicines (
      shop_id, code, barcode, brand_name, generic_name, strength, category, company,
      drug_class, storage_condition, rack_location, min_stock_alert,
      requires_prescription, is_active
    )
    VALUES (
      v_shop_id,
      btrim(p_values->>'code'),
      nullif(btrim(p_values->>'barcode'), ''),
      btrim(p_values->>'brand_name'),
      btrim(p_values->>'generic_name'),
      nullif(btrim(p_values->>'strength'), ''),
      btrim(p_values->>'category'),
      btrim(p_values->>'company'),
      p_values->>'drug_class',
      coalesce(nullif(p_values->>'storage_condition', ''), 'ROOM_TEMPERATURE'),
      coalesce(p_values->>'rack_location', ''),
      coalesce(nullif(p_values->>'min_stock_alert', '')::integer, 0),
      coalesce((p_values->>'requires_prescription')::boolean, false),
      coalesce((p_values->>'is_active')::boolean, true)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.medicines
    SET code = btrim(p_values->>'code'),
        barcode = nullif(btrim(p_values->>'barcode'), ''),
        brand_name = btrim(p_values->>'brand_name'),
        generic_name = btrim(p_values->>'generic_name'),
        strength = CASE WHEN p_values ? 'strength'
          THEN nullif(btrim(p_values->>'strength'), '') ELSE strength END,
        category = btrim(p_values->>'category'),
        company = btrim(p_values->>'company'),
        drug_class = p_values->>'drug_class',
        storage_condition = coalesce(nullif(p_values->>'storage_condition', ''), 'ROOM_TEMPERATURE'),
        rack_location = coalesce(p_values->>'rack_location', ''),
        min_stock_alert = coalesce(nullif(p_values->>'min_stock_alert', '')::integer, 0),
        requires_prescription = coalesce((p_values->>'requires_prescription')::boolean, false),
        is_active = coalesce((p_values->>'is_active')::boolean, true)
    WHERE id = p_medicine_id
      AND shop_id = v_shop_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Medicine not found';
    END IF;
  END IF;

  FOR v_unit IN SELECT value FROM jsonb_array_elements(p_units)
  LOOP
    v_unit_id := nullif(v_unit->>'id', '')::uuid;
    v_unit_name := btrim(v_unit->>'name');
    v_unit_factor := (v_unit->>'conversion_factor')::integer;
    v_unit_price := (v_unit->>'price_paisa')::integer;
    v_is_default := coalesce((v_unit->>'is_default_sale_unit')::boolean, false);

    IF v_unit_id IS NULL THEN
      INSERT INTO public.medicine_units (
        shop_id, medicine_id, name, conversion_factor, is_default_sale_unit, price_paisa, barcode
      )
      VALUES (
        v_shop_id, v_id, v_unit_name, v_unit_factor, v_is_default, v_unit_price,
        nullif(btrim(v_unit->>'barcode'), '')
      );
    ELSE
      UPDATE public.medicine_units
      SET name = v_unit_name,
          conversion_factor = v_unit_factor,
          is_default_sale_unit = v_is_default,
          price_paisa = v_unit_price,
          barcode = nullif(btrim(v_unit->>'barcode'), '')
      WHERE id = v_unit_id
        AND medicine_id = v_id
        AND shop_id = v_shop_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A selected unit does not belong to this medicine';
      END IF;
    END IF;
  END LOOP;

  RETURN v_id;
END;
$function$;

DO $postflight$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    to_regprocedure('public.save_medicine(uuid,jsonb,jsonb)')
  ) INTO v_definition;

  IF position('tenant_private.current_shop_id()' IN v_definition) = 0
     OR position('shop_id = v_shop_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'save_medicine shop scoping is missing; transaction aborted.';
  END IF;
END
$postflight$;

COMMIT;
