-- S4 stage-1 rollback. Run only before S5 rewrites or creating another shop.
-- Removing these policies is safe only while Pharma Care is the sole shop.

BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $rollback_preflight$
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
    RAISE EXCEPTION 'Run this rollback as the reviewed database owner role with RLS bypass.';
  END IF;

  IF (SELECT count(*) FROM public.shops) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.shops
       WHERE name = 'Pharma Care' AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'Rollback is unsafe unless Pharma Care is still the only shop.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE (role = 'super_admin' AND shop_id IS NOT NULL)
       OR (role <> 'super_admin' AND shop_id IS DISTINCT FROM (SELECT id FROM public.shops WHERE name = 'Pharma Care'))
  ) THEN
    RAISE EXCEPTION 'Profile shop assignments are no longer in the verified single-shop state.';
  END IF;

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
      RAISE EXCEPTION 'Expected S4 policy is missing or changed on public.%; stop and inspect.', v_table;
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
      RAISE EXCEPTION 'Platform actor scope is missing from public.%; rollback stopped.', v_table;
    END IF;

    IF v_table = 'audit_logs' AND EXISTS (
      SELECT 1
      FROM public.audit_logs AS log
      LEFT JOIN public.profiles AS actor ON actor.id = log.actor_id
      WHERE log.shop_id IS NULL
        AND actor.role::text IS DISTINCT FROM 'super_admin'
    ) THEN
      RAISE EXCEPTION 'A null-shop audit log is not attributed to a Super Admin; rollback stopped.';
    ELSIF v_table = 'trash_bin_events' AND EXISTS (
      SELECT 1
      FROM public.trash_bin_events AS trash_event
      LEFT JOIN public.profiles AS actor ON actor.id = trash_event.actor_id
      WHERE trash_event.shop_id IS NULL
        AND trash_event.actor_id IS NOT NULL
        AND actor.role::text IS DISTINCT FROM 'super_admin'
    ) THEN
      RAISE EXCEPTION 'A null-shop trash event is not attributed to a Super Admin; rollback stopped.';
    ELSIF v_table NOT IN ('profiles', 'audit_logs', 'trash_bin_events') THEN
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.%I WHERE shop_id IS DISTINCT FROM (SELECT id FROM public.shops WHERE name = %L))',
        v_table,
        'Pharma Care'
      ) INTO v_has_unexpected_rows;
      IF v_has_unexpected_rows THEN
        RAISE EXCEPTION 'public.% contains rows outside Pharma Care; rollback stopped.', v_table;
      END IF;
    END IF;
  END LOOP;
END
$rollback_preflight$;

DO $drop_isolation_policies$
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
      'DROP POLICY %I ON public.%I',
      v_table || '_shop_isolation',
      v_table
    );
  END LOOP;
END
$drop_isolation_policies$;

NOTIFY pgrst, 'reload schema';
COMMIT;
