-- S4 stage 1: add a restrictive same-shop RLS boundary to every S3 tenant table.
-- This does not replace existing permission policies or make SECURITY DEFINER
-- functions tenant-safe; those remain a separate reviewed S5 stage.

BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $preflight$
DECLARE
  v_table text;
  v_has_unexpected_rows boolean;
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
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this migration as the reviewed database owner role with RLS bypass.';
  END IF;

  IF to_regnamespace('tenant_private') IS NULL
     OR to_regprocedure('tenant_private.is_current_shop(uuid)') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL THEN
    RAISE EXCEPTION 'S3 trusted shop-scope helpers are missing; stop and inspect.';
  END IF;

  IF has_function_privilege('authenticated', 'tenant_private.current_shop_id()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'tenant_private.is_current_shop(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S3 helper grants do not match the reviewed non-disclosing policy design.';
  END IF;

  IF (SELECT count(*) FROM public.shops) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.shops
       WHERE name = 'Pharma Care' AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'Expected the single active Pharma Care shop before S4; stop and inspect.';
  END IF;

  IF has_table_privilege('authenticated', 'public.shops', 'SELECT')
     OR has_table_privilege('anon', 'public.shops', 'SELECT') THEN
    RAISE EXCEPTION 'A public API role can read public.shops directly; stop and review shop metadata access.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_attribute
         WHERE attrelid = to_regclass(format('public.%I', v_table))
           AND attname = 'shop_id'
           AND attnum > 0
           AND NOT attisdropped
       ) THEN
      RAISE EXCEPTION 'S3 ownership column is missing from public.%; stop and inspect.', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = to_regclass(format('public.%I', v_table))
        AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%; stop and inspect.', v_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy
      WHERE polrelid = to_regclass(format('public.%I', v_table))
        AND polname = v_table || '_shop_isolation'
    ) THEN
      RAISE EXCEPTION 'S4 policy already exists on public.%; stop and inspect.', v_table;
    END IF;

    IF has_column_privilege('authenticated', format('public.%I', v_table), 'shop_id', 'SELECT')
       OR has_column_privilege('anon', format('public.%I', v_table), 'shop_id', 'SELECT') THEN
      RAISE EXCEPTION 'A public API role can read public.%.shop_id; stop and restore concealment first.', v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname NOT IN ('shops', 'user_favorites', 'user_sidebar_preferences')
      AND NOT (relation.relname = ANY(v_tables))
  ) THEN
    RAISE EXCEPTION 'Unexpected public base table exists outside S3 ownership inventory; stop and scope it before S4.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('v', 'm')
  ) THEN
    RAISE EXCEPTION 'A public view or materialized view exists; review its tenant scope before S4.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid IN (
      to_regclass('public.user_favorites'),
      to_regclass('public.user_sidebar_preferences')
    )
      AND NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'A per-user preference table lacks RLS; review it before S4.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE (role = 'super_admin' AND shop_id IS NOT NULL)
       OR (role <> 'super_admin' AND shop_id IS DISTINCT FROM (SELECT id FROM public.shops WHERE name = 'Pharma Care'))
  ) THEN
    RAISE EXCEPTION 'Profile shop assignments do not match the verified single-shop S3 state.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF v_table = 'audit_logs' AND EXISTS (
      SELECT 1
      FROM public.audit_logs AS log
      LEFT JOIN public.profiles AS actor ON actor.id = log.actor_id
      WHERE log.shop_id IS NULL
        AND actor.role::text IS DISTINCT FROM 'super_admin'
    ) THEN
      RAISE EXCEPTION 'A null-shop audit log is not attributed to a Super Admin.';
    ELSIF v_table = 'trash_bin_events' AND EXISTS (
      SELECT 1
      FROM public.trash_bin_events AS trash_event
      LEFT JOIN public.profiles AS actor ON actor.id = trash_event.actor_id
      WHERE trash_event.shop_id IS NULL
        AND trash_event.actor_id IS NOT NULL
        AND actor.role::text IS DISTINCT FROM 'super_admin'
    ) THEN
      RAISE EXCEPTION 'A null-shop trash event is not attributed to a Super Admin.';
    ELSIF v_table NOT IN ('profiles', 'audit_logs', 'trash_bin_events') THEN
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.%I WHERE shop_id IS DISTINCT FROM (SELECT id FROM public.shops WHERE name = %L))',
        v_table,
        'Pharma Care'
      ) INTO v_has_unexpected_rows;
      IF v_has_unexpected_rows THEN
        RAISE EXCEPTION 'public.% contains rows outside the verified Pharma Care shop.', v_table;
      END IF;
    END IF;
  END LOOP;
END
$preflight$;

DO $add_isolation_policies$
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
    IF v_table = 'profiles' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (tenant_private.is_current_shop(shop_id) OR (id = auth.uid() AND role = %L AND shop_id IS NULL)) WITH CHECK (tenant_private.is_current_shop(shop_id) OR (id = auth.uid() AND role = %L AND shop_id IS NULL))',
        v_table || '_shop_isolation',
        v_table,
        'super_admin',
        'super_admin'
      );
    ELSIF v_table IN ('audit_logs', 'trash_bin_events') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (tenant_private.is_current_shop(shop_id) OR (shop_id IS NULL AND actor_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles AS platform_actor WHERE platform_actor.id = auth.uid() AND platform_actor.role = %L AND platform_actor.shop_id IS NULL))) WITH CHECK (tenant_private.is_current_shop(shop_id) OR (shop_id IS NULL AND actor_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles AS platform_actor WHERE platform_actor.id = auth.uid() AND platform_actor.role = %L AND platform_actor.shop_id IS NULL)))',
        v_table || '_shop_isolation',
        v_table,
        'super_admin',
        'super_admin'
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (tenant_private.is_current_shop(shop_id)) WITH CHECK (tenant_private.is_current_shop(shop_id))',
        v_table || '_shop_isolation',
        v_table
      );
    END IF;
  END LOOP;
END
$add_isolation_policies$;

DO $postflight$
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
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy
      WHERE polrelid = to_regclass(format('public.%I', v_table))
        AND polname = v_table || '_shop_isolation'
        AND NOT polpermissive
        AND polcmd = '*'
        AND polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')]
    ) THEN
      RAISE EXCEPTION 'Restrictive all-command tenant policy is missing on public.%; transaction aborted.', v_table;
    END IF;

    IF v_table = 'profiles' AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy
      WHERE polrelid = to_regclass('public.profiles')
        AND polname = 'profiles_shop_isolation'
        AND position('super_admin' IN coalesce(pg_catalog.pg_get_expr(polqual, polrelid), '')) > 0
        AND position('auth.uid()' IN coalesce(pg_catalog.pg_get_expr(polqual, polrelid), '')) > 0
        AND position('super_admin' IN coalesce(pg_catalog.pg_get_expr(polwithcheck, polrelid), '')) > 0
        AND position('auth.uid()' IN coalesce(pg_catalog.pg_get_expr(polwithcheck, polrelid), '')) > 0
    ) THEN
      RAISE EXCEPTION 'profiles isolation policy does not preserve only the Super Admin own-profile access; transaction aborted.';
    END IF;

    IF v_table IN ('audit_logs', 'trash_bin_events') AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy
      WHERE polrelid = to_regclass(format('public.%I', v_table))
        AND polname = v_table || '_shop_isolation'
        AND position('tenant_private.is_current_shop' IN coalesce(pg_catalog.pg_get_expr(polqual, polrelid), '')) > 0
        AND position('shop_id' IN coalesce(pg_catalog.pg_get_expr(polqual, polrelid), '')) > 0
        AND position('actor_id' IN coalesce(pg_catalog.pg_get_expr(polqual, polrelid), '')) > 0
        AND position('super_admin' IN coalesce(pg_catalog.pg_get_expr(polqual, polrelid), '')) > 0
        AND position('auth.uid()' IN coalesce(pg_catalog.pg_get_expr(polqual, polrelid), '')) > 0
        AND position('tenant_private.is_current_shop' IN coalesce(pg_catalog.pg_get_expr(polwithcheck, polrelid), '')) > 0
        AND position('shop_id' IN coalesce(pg_catalog.pg_get_expr(polwithcheck, polrelid), '')) > 0
        AND position('actor_id' IN coalesce(pg_catalog.pg_get_expr(polwithcheck, polrelid), '')) > 0
        AND position('super_admin' IN coalesce(pg_catalog.pg_get_expr(polwithcheck, polrelid), '')) > 0
        AND position('auth.uid()' IN coalesce(pg_catalog.pg_get_expr(polwithcheck, polrelid), '')) > 0
    ) THEN
      RAISE EXCEPTION 'Platform actor scope is missing from public.%; transaction aborted.', v_table;
    END IF;
  END LOOP;
END
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
