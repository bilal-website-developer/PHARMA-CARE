-- S3 rollback. Owner-run only; use only before S4 or any additional shop exists.
-- request_print remains safely patched to omit shop_id; after this rollback the
-- omitted key no longer exists, so its client response shape remains unchanged.

BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $rollback_preflight$
DECLARE
  v_table text;
  v_has_reference boolean;
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

  IF to_regclass('public.shops') IS NULL
     OR to_regnamespace('tenant_private') IS NULL THEN
    RAISE EXCEPTION 'S3 objects are incomplete; stop and inspect before rolling back.';
  END IF;

  IF (SELECT count(*) FROM public.shops) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.shops WHERE name = 'Pharma Care') THEN
    RAISE EXCEPTION 'Rollback is blocked unless Pharma Care is still the only shop.';
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
      RAISE EXCEPTION 'Expected S3 column public.%.shop_id is missing.', v_table;
    END IF;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE shop_id IS NOT NULL AND shop_id NOT IN (SELECT id FROM public.shops))',
      v_table
    ) INTO v_has_reference;
    IF v_has_reference THEN
      RAISE EXCEPTION 'Unexpected shop reference exists in public.%; stop and inspect.', v_table;
    END IF;
  END LOOP;
END
$rollback_preflight$;

DROP TRIGGER profiles_assign_shop_id ON public.profiles;
DROP TRIGGER audit_logs_assign_shop_id ON public.audit_logs;
DROP TRIGGER trash_bin_events_assign_shop_id ON public.trash_bin_events;

DO $drop_tenant_triggers$
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
    EXECUTE format('DROP TRIGGER %I ON public.%I', v_table || '_assign_shop_id', v_table);
  END LOOP;
END
$drop_tenant_triggers$;

DROP FUNCTION tenant_private.assign_profile_shop_id();
DROP FUNCTION tenant_private.assign_tenant_shop_id();
DROP FUNCTION tenant_private.assign_actor_shop_id();
DROP FUNCTION tenant_private.is_current_shop(uuid);
DROP FUNCTION tenant_private.current_shop_id();

DO $drop_shop_columns$
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
      'ALTER TABLE public.%I DROP CONSTRAINT %I',
      v_table,
      v_table || '_shop_id_fkey'
    );
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN shop_id', v_table);
  END LOOP;
END
$drop_shop_columns$;

DROP SCHEMA tenant_private;
DROP TABLE public.shops;

GRANT SELECT ON TABLE
  public.audit_logs,
  public.brands,
  public.categories,
  public.customers,
  public.khata_entries,
  public.medicines,
  public.print_requests,
  public.profiles,
  public.sale_payments,
  public.sales,
  public.stock_movements,
  public.supplier_ledger,
  public.suppliers
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
