begin;

do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname = any (array[
        'deactivate_supplier',
        'has_any_permission',
        'is_admin',
        'is_staff',
        'master_data_overview',
        'post_purchase',
        'purchase_catalog',
        'purchase_detail',
        'purchase_history',
        'save_supplier',
        'stock_adjustments_log',
        'stock_batches_list',
        'stock_expiry_buckets',
        'stock_overview_stats',
        'void_purchase',
        'write_off_expired_batch'
      ]::name[])
  loop
    execute format(
      'GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon',
      v_function
    );
  end loop;
end;
$$;

commit;
