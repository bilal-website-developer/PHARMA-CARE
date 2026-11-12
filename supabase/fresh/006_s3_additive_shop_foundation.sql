-- S3 step 1: prepare the additive shop schema and trusted assignment triggers.
-- Owner-run only. This step does not backfill or delete business rows.
-- Keep tenant_private out of Supabase's exposed API schemas.

BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $preflight$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'profiles',
    'audit_logs',
    'brands',
    'categories',
    'customers',
    'khata_entries',
    'medicine_units',
    'medicines',
    'print_requests',
    'purchase_items',
    'purchase_number_state',
    'purchases',
    'return_policy_settings',
    'sale_item_batch_allocations',
    'sale_items',
    'sale_payments',
    'sale_return_items',
    'sale_returns',
    'sales',
    'stock_batches',
    'stock_movements',
    'supplier_ledger',
    'suppliers',
    'trash_bin_events'
  ];
  v_definition text;
  v_occurrences integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this migration as the reviewed database owner role with RLS bypass.';
  END IF;

  IF to_regclass('public.shops') IS NOT NULL
     OR to_regnamespace('tenant_private') IS NOT NULL THEN
    RAISE EXCEPTION 'A shop foundation object already exists; stop and inspect before continuing.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'Required public table is missing: %', v_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE attrelid = to_regclass(format('public.%I', v_table))
        AND attname = 'shop_id'
        AND attnum > 0
        AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'Column public.%.shop_id already exists; stop and inspect.', v_table;
    END IF;
  END LOOP;

  IF to_regprocedure('public.request_print(text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Expected public.request_print(text,text,jsonb) routine is missing.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    to_regprocedure('public.request_print(text,text,jsonb)')
  ) INTO v_definition;

  v_occurrences :=
    (length(v_definition) - length(replace(v_definition, 'to_jsonb(v_request)', '')))
    / length('to_jsonb(v_request)');

  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'request_print no longer has the reviewed single whole-row JSON return; stop for review.';
  END IF;
END
$preflight$;

CREATE TABLE public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  logo_path text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shops FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shops TO service_role;

CREATE SCHEMA tenant_private;
REVOKE ALL ON SCHEMA tenant_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA tenant_private TO authenticated, service_role;

INSERT INTO public.shops (name) VALUES ('Pharma Care');

DO $add_columns$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'profiles',
    'audit_logs',
    'brands',
    'categories',
    'customers',
    'khata_entries',
    'medicine_units',
    'medicines',
    'print_requests',
    'purchase_items',
    'purchase_number_state',
    'purchases',
    'return_policy_settings',
    'sale_item_batch_allocations',
    'sale_items',
    'sale_payments',
    'sale_return_items',
    'sale_returns',
    'sales',
    'stock_batches',
    'stock_movements',
    'supplier_ledger',
    'suppliers',
    'trash_bin_events'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN shop_id uuid', v_table);
  END LOOP;
END
$add_columns$;

DO $add_shop_references$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'profiles',
    'audit_logs',
    'brands',
    'categories',
    'customers',
    'khata_entries',
    'medicine_units',
    'medicines',
    'print_requests',
    'purchase_items',
    'purchase_number_state',
    'purchases',
    'return_policy_settings',
    'sale_item_batch_allocations',
    'sale_items',
    'sale_payments',
    'sale_return_items',
    'sale_returns',
    'sales',
    'stock_batches',
    'stock_movements',
    'supplier_ledger',
    'suppliers',
    'trash_bin_events'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE RESTRICT',
      v_table,
      v_table || '_shop_id_fkey'
    );
    EXECUTE format(
      'CREATE INDEX %I ON public.%I (shop_id)',
      v_table || '_shop_id_idx',
      v_table
    );
  END LOOP;
END
$add_shop_references$;

CREATE FUNCTION tenant_private.current_shop_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT profile.shop_id
  FROM public.profiles AS profile
  JOIN public.shops AS shop ON shop.id = profile.shop_id
  WHERE profile.id = auth.uid()
    AND profile.is_active = true
    AND profile.deleted_at IS NULL
    AND profile.role <> 'super_admin'
    AND shop.status = 'active'
  LIMIT 1;
$function$;

CREATE FUNCTION tenant_private.is_current_shop(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, tenant_private
AS $function$
  SELECT p_shop_id IS NOT NULL
    AND p_shop_id = tenant_private.current_shop_id();
$function$;

CREATE FUNCTION tenant_private.assign_profile_shop_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, tenant_private
AS $function$
DECLARE
  v_actor_shop_id uuid;
BEGIN
  IF NEW.role = 'super_admin' THEN
    NEW.shop_id := NULL;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.shop_id := tenant_private.current_shop_id();
    RETURN NEW;
  END IF;

  IF NEW.shop_id IS NULL AND NEW.created_by IS NOT NULL THEN
    SELECT profile.shop_id INTO v_actor_shop_id
    FROM public.profiles AS profile
    WHERE profile.id = NEW.created_by
      AND profile.role <> 'super_admin';
    NEW.shop_id := v_actor_shop_id;
  END IF;

  IF NEW.shop_id IS NULL THEN
    SELECT id INTO NEW.shop_id
    FROM public.shops
    WHERE status = 'active'
    ORDER BY created_at, id
    LIMIT 1;
  END IF;

  IF NEW.shop_id IS NULL THEN
    RAISE EXCEPTION 'No active shop is available for this profile.';
  END IF;

  RETURN NEW;
END
$function$;

CREATE FUNCTION tenant_private.assign_tenant_shop_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, tenant_private
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.shop_id := tenant_private.current_shop_id();
  END IF;

  RETURN NEW;
END
$function$;

CREATE FUNCTION tenant_private.assign_actor_shop_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, tenant_private
AS $function$
DECLARE
  v_shop_id uuid;
  v_actor_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.shop_id := tenant_private.current_shop_id();
    RETURN NEW;
  END IF;

  v_actor_id := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::uuid;
  IF NEW.shop_id IS NULL AND v_actor_id IS NOT NULL THEN
    SELECT profile.shop_id INTO v_shop_id
    FROM public.profiles AS profile
    WHERE profile.id = v_actor_id
      AND profile.role <> 'super_admin';
    NEW.shop_id := v_shop_id;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION tenant_private.current_shop_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION tenant_private.is_current_shop(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION tenant_private.assign_profile_shop_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION tenant_private.assign_tenant_shop_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION tenant_private.assign_actor_shop_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION tenant_private.is_current_shop(uuid) TO authenticated, service_role;

CREATE TRIGGER profiles_assign_shop_id
  BEFORE INSERT OR UPDATE OF shop_id, role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION tenant_private.assign_profile_shop_id();

CREATE TRIGGER audit_logs_assign_shop_id
  BEFORE INSERT OR UPDATE OF shop_id, actor_id ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION tenant_private.assign_actor_shop_id('actor_id');

CREATE TRIGGER trash_bin_events_assign_shop_id
  BEFORE INSERT OR UPDATE OF shop_id, actor_id ON public.trash_bin_events
  FOR EACH ROW EXECUTE FUNCTION tenant_private.assign_actor_shop_id('actor_id');

DO $tenant_triggers$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'brands',
    'categories',
    'customers',
    'khata_entries',
    'medicine_units',
    'medicines',
    'print_requests',
    'purchase_items',
    'purchase_number_state',
    'purchases',
    'return_policy_settings',
    'sale_item_batch_allocations',
    'sale_items',
    'sale_payments',
    'sale_return_items',
    'sale_returns',
    'sales',
    'stock_batches',
    'stock_movements',
    'supplier_ledger',
    'suppliers'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF shop_id ON public.%I FOR EACH ROW EXECUTE FUNCTION tenant_private.assign_tenant_shop_id()',
      v_table || '_assign_shop_id',
      v_table
    );
  END LOOP;
END
$tenant_triggers$;

-- These tables had effective table-wide SELECT for authenticated users. Keep
-- their previous columns readable while excluding the new tenant identifier.
DO $safe_columns$
DECLARE
  v_table text;
  v_safe_columns text;
  v_tables text[] := ARRAY[
    'audit_logs',
    'brands',
    'categories',
    'customers',
    'khata_entries',
    'medicines',
    'print_requests',
    'profiles',
    'sale_payments',
    'sales',
    'stock_movements',
    'supplier_ledger',
    'suppliers'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'REVOKE SELECT ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table
    );

    SELECT string_agg(format('%I', attribute.attname), ', ' ORDER BY attribute.attnum)
    INTO v_safe_columns
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = to_regclass(format('public.%I', v_table))
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attname <> 'shop_id';

    IF v_safe_columns IS NULL THEN
      RAISE EXCEPTION 'No safe columns were found for public.%', v_table;
    END IF;

    EXECUTE format(
      'GRANT SELECT (%s) ON TABLE public.%I TO authenticated',
      v_safe_columns,
      v_table
    );
  END LOOP;
END
$safe_columns$;

DO $patch_print_response$
DECLARE
  v_definition text;
  v_patched text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.request_print(text,text,jsonb)'::regprocedure
  ) INTO v_definition;

  v_patched := replace(
    v_definition,
    'to_jsonb(v_request)',
    '(to_jsonb(v_request) - ''shop_id'')'
  );
  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'The reviewed request_print whole-row response was not found.';
  END IF;

  EXECUTE v_patched;
END
$patch_print_response$;

NOTIFY pgrst, 'reload schema';
COMMIT;
