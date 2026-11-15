-- S6 package 068. Adds scoped read/write functions for per-shop operational settings.
-- Owner-run only after package 067's smoke and final checks pass.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE public.profiles, public.shops, public.shop_settings IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run package 068 as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regclass('public.shop_settings') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.current_shop_settings()') IS NOT NULL
     OR to_regprocedure('public.update_current_shop_settings(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Package 067 is missing or package 068 routines already exist; inspect before applying.';
  END IF;
END
$preflight$;

CREATE FUNCTION public.current_shop_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_shop_id uuid;
  v_settings jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An authenticated shop profile is required.';
  END IF;

  v_shop_id := tenant_private.current_shop_id();
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active shop assignment is required.';
  END IF;

  SELECT settings.settings
    INTO v_settings
  FROM public.shop_settings AS settings
  WHERE settings.shop_id = v_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'Shop settings are not initialized.';
  END IF;

  RETURN v_settings;
END
$function$;

CREATE FUNCTION public.update_current_shop_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_shop_id uuid;
  v_actor_role text;
  v_actor_permissions text[];
  v_memo jsonb;
  v_caps jsonb;
  v_notes jsonb;
  v_number numeric;
  v_max_discount numeric;
  v_expiry_days numeric;
  v_admin_cap numeric;
  v_manager_cap numeric;
  v_cashier_cap numeric;
  v_accountant_cap numeric;
  v_saved_settings jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An authenticated shop profile is required.';
  END IF;

  v_shop_id := tenant_private.current_shop_id();
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active shop assignment is required.';
  END IF;

  SELECT profile.role, profile.permissions
    INTO v_actor_role, v_actor_permissions
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id
    AND profile.shop_id = v_shop_id
    AND profile.is_active
    AND profile.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND
     OR v_actor_role = 'super_admin'
     OR (
       v_actor_role <> 'admin'
       AND NOT (coalesce(v_actor_permissions, ARRAY[]::text[]) @> ARRAY['settings']::text[])
     ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Settings permission is required.';
  END IF;

  IF p_settings IS NULL OR pg_catalog.jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Settings must be a JSON object.';
  END IF;
  IF NOT (p_settings ?& ARRAY[
       'billingTemplate', 'receiptFormat', 'maxDiscountPaisa',
       'roleDiscountPercentCap', 'expiryWarningDays', 'memo'
     ]::text[])
     OR p_settings - ARRAY[
       'billingTemplate', 'receiptFormat', 'maxDiscountPaisa',
       'roleDiscountPercentCap', 'expiryWarningDays', 'memo'
     ]::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Settings contain missing or unsupported fields.';
  END IF;

  IF pg_catalog.jsonb_typeof(p_settings->'billingTemplate') <> 'string'
     OR p_settings->>'billingTemplate' NOT IN ('simple', 'classic', 'professional', 'modern', 'pharmacy-memo')
     OR pg_catalog.jsonb_typeof(p_settings->'receiptFormat') <> 'string'
     OR p_settings->>'receiptFormat' NOT IN ('thermal58', 'thermal80', 'a4')
     OR pg_catalog.jsonb_typeof(p_settings->'maxDiscountPaisa') <> 'number'
     OR pg_catalog.jsonb_typeof(p_settings->'expiryWarningDays') <> 'number' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Settings contain invalid template, format, discount, or expiry values.';
  END IF;

  v_max_discount := (p_settings->>'maxDiscountPaisa')::numeric;
  v_expiry_days := (p_settings->>'expiryWarningDays')::numeric;
  IF v_max_discount < 0 OR v_max_discount > 20000 OR pg_catalog.trunc(v_max_discount) <> v_max_discount
     OR v_expiry_days < 1 OR v_expiry_days > 365 OR pg_catalog.trunc(v_expiry_days) <> v_expiry_days THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Discount or expiry settings are outside the approved bounds.';
  END IF;

  v_caps := p_settings->'roleDiscountPercentCap';
  IF pg_catalog.jsonb_typeof(v_caps) <> 'object' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Role discount caps must be a JSON object.';
  END IF;
  IF NOT (v_caps ?& ARRAY['admin', 'manager', 'cashier', 'accountant']::text[])
     OR v_caps - ARRAY['admin', 'manager', 'cashier', 'accountant']::text[] <> '{}'::jsonb
     OR pg_catalog.jsonb_typeof(v_caps->'admin') <> 'number'
     OR pg_catalog.jsonb_typeof(v_caps->'manager') <> 'number'
     OR pg_catalog.jsonb_typeof(v_caps->'cashier') <> 'number'
     OR pg_catalog.jsonb_typeof(v_caps->'accountant') <> 'number' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Discount caps exceed the approved role limits.';
  END IF;
  v_admin_cap := (v_caps->>'admin')::numeric;
  v_manager_cap := (v_caps->>'manager')::numeric;
  v_cashier_cap := (v_caps->>'cashier')::numeric;
  v_accountant_cap := (v_caps->>'accountant')::numeric;
  IF v_admin_cap < 0 OR v_admin_cap > 30
     OR v_manager_cap < 0 OR v_manager_cap > 15
     OR v_cashier_cap < 0 OR v_cashier_cap > 10
     OR v_accountant_cap <> 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Discount caps exceed the approved role limits.';
  END IF;

  v_memo := p_settings->'memo';
  IF pg_catalog.jsonb_typeof(v_memo) <> 'object' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo settings must be a JSON object.';
  END IF;
  IF NOT (v_memo ?& ARRAY[
       'notes', 'terminalName', 'showBatchExpiry', 'roundNet',
       'printTax', 'duplicateLabel', 'autoPrint', 'numberDigits', 'printLogo'
     ]::text[])
     OR v_memo - ARRAY[
       'notes', 'terminalName', 'showBatchExpiry', 'roundNet',
       'printTax', 'duplicateLabel', 'autoPrint', 'numberDigits', 'printLogo'
     ]::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo settings contain missing or unsupported fields.';
  END IF;

  v_notes := v_memo->'notes';
  IF pg_catalog.jsonb_typeof(v_notes) <> 'array' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo notes must be an array.';
  END IF;
  IF jsonb_array_length(v_notes) <> 3 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Exactly three memo notes are required.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_notes) AS note(value)
    WHERE pg_catalog.jsonb_typeof(note.value) <> 'string'
       OR pg_catalog.btrim(note.value #>> '{}') = ''
       OR pg_catalog.length(note.value #>> '{}') > 200
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo notes must be non-empty text of at most 200 characters.';
  END IF;

  IF pg_catalog.jsonb_typeof(v_memo->'terminalName') <> 'string'
     OR pg_catalog.btrim(v_memo->>'terminalName') = ''
     OR pg_catalog.length(v_memo->>'terminalName') > 80
     OR pg_catalog.jsonb_typeof(v_memo->'showBatchExpiry') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'roundNet') <> 'string'
     OR v_memo->>'roundNet' NOT IN ('none', '1', '5', '10')
     OR pg_catalog.jsonb_typeof(v_memo->'printTax') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'duplicateLabel') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'autoPrint') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'printLogo') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'numberDigits') <> 'number' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo settings contain invalid values.';
  END IF;

  v_number := (v_memo->>'numberDigits')::numeric;
  IF v_number < 1 OR v_number > 20 OR pg_catalog.trunc(v_number) <> v_number THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo number digits must be an integer from 1 to 20.';
  END IF;

  INSERT INTO public.shop_settings (shop_id, settings, settings_version, updated_by, updated_at)
  VALUES (v_shop_id, p_settings, 1, v_actor_id, pg_catalog.clock_timestamp())
  ON CONFLICT (shop_id) DO UPDATE
    SET settings = EXCLUDED.settings,
        settings_version = 1,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
  RETURNING settings INTO v_saved_settings;

  RETURN v_saved_settings;
END
$function$;

REVOKE ALL ON FUNCTION public.current_shop_settings() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_current_shop_settings(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_shop_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_current_shop_settings(jsonb) TO authenticated;

DO $postflight$
BEGIN
  IF to_regprocedure('public.current_shop_settings()') IS NULL
     OR to_regprocedure('public.update_current_shop_settings(jsonb)') IS NULL
     OR pg_catalog.has_function_privilege('authenticated', 'public.current_shop_settings()', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('authenticated', 'public.update_current_shop_settings(jsonb)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('anon', 'public.current_shop_settings()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.update_current_shop_settings(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Package 068 postflight verification failed.';
  END IF;
END
$postflight$;

COMMIT;
