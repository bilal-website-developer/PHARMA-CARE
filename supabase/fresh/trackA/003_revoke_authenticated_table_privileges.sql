DO $$
DECLARE
  v_table name;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles',
    'customers',
    'suppliers',
    'medicines',
    'medicine_units',
    'purchases',
    'stock_batches',
    'sales',
    'sale_items',
    'sale_item_batch_allocations',
    'sale_payments',
    'purchase_items',
    'stock_movements',
    'khata_entries',
    'categories',
    'brands',
    'audit_logs',
    'print_requests',
    'purchase_number_state',
    'supplier_ledger',
    'trash_bin_events',
    'return_policy_settings',
    'sale_returns',
    'sale_return_items'
  ]::name[]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.%I FROM authenticated',
        v_table
      );
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'stock_batches',
    'purchases',
    'purchase_items',
    'sale_items',
    'sale_item_batch_allocations'
  ]::name[]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated',
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL PRIVILEGES ON SEQUENCE public.medicine_barcode_seq
  FROM PUBLIC, anon, authenticated;
