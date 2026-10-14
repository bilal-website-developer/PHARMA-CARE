begin;

do $$
declare
  v_table name;
begin
  foreach v_table in array array[
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
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated',
        v_table
      );
    end if;
  end loop;

  foreach v_table in array array[
    'stock_batches',
    'purchases',
    'purchase_items',
    'sale_items',
    'sale_item_batch_allocations'
  ]::name[]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated',
        v_table
      );
    end if;
  end loop;
end;
$$;

commit;
