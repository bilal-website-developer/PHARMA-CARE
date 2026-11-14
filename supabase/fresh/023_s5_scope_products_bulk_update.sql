-- S5 batch 4: scope bulk product updates and audit events to the caller shop.
-- Owner-run only. CREATE OR REPLACE preserves the reviewed function ACLs.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $preflight$
DECLARE
  v_signature text := 'public.products_bulk_update(uuid[],text,text)';
  v_definition text;
  v_table text;
  v_tables text[] := ARRAY['categories', 'medicines', 'audit_logs'];
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
    RAISE EXCEPTION 'S3 tenant helper or expected products_bulk_update routine is missing.';
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
    RAISE EXCEPTION 'products_bulk_update grants or security settings differ from the reviewed definition.';
  END IF;

  IF to_regclass('public.categories_shop_name_lower_key') IS NULL
     OR to_regclass('public.categories_name_lower_key') IS NOT NULL THEN
    RAISE EXCEPTION 'Expected S4 shop-scoped category key; stop and inspect index state.';
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

  SELECT pg_catalog.pg_get_functiondef(to_regprocedure(v_signature))
  INTO v_definition;
  IF position('tenant_private.current_shop_id()' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'products_bulk_update already contains tenant scoping; inspect before replacing it.';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.products_bulk_update(
  ids uuid[],
  action text,
  value text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_category text;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['products']::text[]) THEN
    RAISE EXCEPTION 'An active user with products permission is required';
  END IF;
  IF ids IS NULL OR cardinality(ids) = 0 OR cardinality(ids) > 2000 THEN
    RAISE EXCEPTION 'Select between 1 and 2000 products';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ids) AS selected(id)
    WHERE selected.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Product selection contains an invalid id';
  END IF;
  IF (
    SELECT count(DISTINCT selected.id)
    FROM unnest(ids) AS selected(id)
  ) <> cardinality(ids) THEN
    RAISE EXCEPTION 'Product selection contains duplicate ids';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ids) AS selected(id)
    LEFT JOIN public.medicines AS medicine
      ON medicine.id = selected.id
     AND medicine.shop_id = v_shop_id
    WHERE medicine.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more selected products no longer exist';
  END IF;

  IF action = 'category' THEN
    SELECT category.name INTO v_category
    FROM public.categories AS category
    WHERE category.shop_id = v_shop_id
      AND category.is_active
      AND lower(category.name) = lower(btrim(value))
    LIMIT 1;
    IF nullif(btrim(value), '') IS NULL OR v_category IS NULL THEN
      RAISE EXCEPTION 'Select an active category';
    END IF;
    UPDATE public.medicines
    SET category = v_category
    WHERE shop_id = v_shop_id
      AND id = ANY(ids);
  ELSIF action = 'deactivate' THEN
    UPDATE public.medicines
    SET is_active = false
    WHERE shop_id = v_shop_id
      AND id = ANY(ids);
  ELSIF action = 'activate' THEN
    UPDATE public.medicines
    SET is_active = true
    WHERE shop_id = v_shop_id
      AND id = ANY(ids);
  ELSE
    RAISE EXCEPTION 'Bulk action must be category, activate, or deactivate';
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    'products_bulk_' || action,
    'medicines',
    ids[1],
    jsonb_build_object('ids', to_jsonb(ids), 'value', value, 'updated_count', v_updated)
  );
  RETURN v_updated;
END;
$function$;

DO $postflight$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    to_regprocedure('public.products_bulk_update(uuid[],text,text)')
  ) INTO v_definition;

  IF position('tenant_private.current_shop_id()' IN v_definition) = 0
     OR position('medicine.shop_id = v_shop_id' IN v_definition) = 0
     OR position('category.shop_id = v_shop_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'products_bulk_update is missing an explicit shop scope; transaction aborted.';
  END IF;
END
$postflight$;

COMMIT;
