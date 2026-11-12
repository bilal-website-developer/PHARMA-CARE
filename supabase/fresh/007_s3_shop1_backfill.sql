-- S3 step 2: assign existing rows to the already-prepared Shop 1.
-- Run only after 006_s3_additive_shop_foundation.sql commits successfully.
-- This transaction updates existing rows but does not alter table definitions.

BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

LOCK TABLE
  public.profiles,
  public.audit_logs,
  public.brands,
  public.categories,
  public.customers,
  public.khata_entries,
  public.medicine_units,
  public.medicines,
  public.print_requests,
  public.purchase_items,
  public.purchase_number_state,
  public.purchases,
  public.return_policy_settings,
  public.sale_item_batch_allocations,
  public.sale_items,
  public.sale_payments,
  public.sale_return_items,
  public.sale_returns,
  public.sales,
  public.stock_batches,
  public.stock_movements,
  public.supplier_ledger,
  public.suppliers,
  public.trash_bin_events
IN SHARE ROW EXCLUSIVE MODE;

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
BEGIN
  IF to_regclass('public.shops') IS NULL
     OR to_regnamespace('tenant_private') IS NULL THEN
    RAISE EXCEPTION 'S3 schema preparation is missing; stop without running the backfill.';
  END IF;

  IF (SELECT count(*) FROM public.shops) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.shops
       WHERE name = 'Pharma Care' AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'Expected exactly one active Pharma Care shop; stop and inspect.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass(format('public.%I', v_table))
        AND attribute.attname = 'shop_id'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'S3 shop_id column is missing from public.%; stop and inspect.', v_table;
    END IF;
  END LOOP;
END
$preflight$;

DO $backfill$
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
  v_shop_id uuid;
BEGIN
  SELECT id INTO STRICT v_shop_id
  FROM public.shops
  WHERE name = 'Pharma Care'
    AND status = 'active';

  FOREACH v_table IN ARRAY v_tables LOOP
    IF v_table = 'profiles' THEN
      EXECUTE format(
        'UPDATE public.%I SET shop_id = $1 WHERE role <> %L AND shop_id IS DISTINCT FROM $1',
        v_table,
        'super_admin'
      ) USING v_shop_id;
      EXECUTE format(
        'UPDATE public.%I SET shop_id = NULL WHERE role = %L AND shop_id IS NOT NULL',
        v_table,
        'super_admin'
      );
    ELSE
      EXECUTE format(
        'UPDATE public.%I SET shop_id = $1 WHERE shop_id IS DISTINCT FROM $1',
        v_table
      ) USING v_shop_id;
    END IF;
  END LOOP;
END
$backfill$;

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
  v_unassigned bigint;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF pg_catalog.has_column_privilege(
      'authenticated',
      format('public.%I', v_table),
      'shop_id',
      'SELECT'
    ) OR pg_catalog.has_column_privilege(
      'anon',
      format('public.%I', v_table),
      'shop_id',
      'SELECT'
    ) THEN
      RAISE EXCEPTION 'A public API role can read public.%.shop_id; refusing to commit.', v_table;
    END IF;

    IF v_table = 'profiles' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE role <> %L AND shop_id IS NULL',
        v_table,
        'super_admin'
      ) INTO v_unassigned;
    ELSE
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE shop_id IS NULL',
        v_table
      ) INTO v_unassigned;
    END IF;

    IF v_unassigned <> 0 THEN
      RAISE EXCEPTION 'public.% has % unassigned existing rows; refusing to commit.',
        v_table, v_unassigned;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege(
    'authenticated',
    'tenant_private.current_shop_id()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can directly call current_shop_id(); refusing to commit.';
  END IF;
END
$postflight$;

COMMIT;
