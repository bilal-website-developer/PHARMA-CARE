-- Read-only S3 verification. Returns one result row with all check summaries.
WITH expected_tables(table_name) AS (
  VALUES
    ('profiles'),
    ('audit_logs'),
    ('brands'),
    ('categories'),
    ('customers'),
    ('khata_entries'),
    ('medicine_units'),
    ('medicines'),
    ('print_requests'),
    ('purchase_items'),
    ('purchase_number_state'),
    ('purchases'),
    ('return_policy_settings'),
    ('sale_item_batch_allocations'),
    ('sale_items'),
    ('sale_payments'),
    ('sale_return_items'),
    ('sale_returns'),
    ('sales'),
    ('stock_batches'),
    ('stock_movements'),
    ('supplier_ledger'),
    ('suppliers'),
    ('trash_bin_events')
),
coverage AS (
  SELECT table_name, total_rows, unassigned_rows
  FROM (
    SELECT 'profiles'::text AS table_name,
      count(*)::bigint AS total_rows,
      count(*) FILTER (
        WHERE role <> 'super_admin' AND shop_id IS NULL
      )::bigint AS unassigned_rows
    FROM public.profiles
    UNION ALL SELECT 'audit_logs', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.audit_logs
    UNION ALL SELECT 'brands', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.brands
    UNION ALL SELECT 'categories', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.categories
    UNION ALL SELECT 'customers', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.customers
    UNION ALL SELECT 'khata_entries', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.khata_entries
    UNION ALL SELECT 'medicine_units', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.medicine_units
    UNION ALL SELECT 'medicines', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.medicines
    UNION ALL SELECT 'print_requests', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.print_requests
    UNION ALL SELECT 'purchase_items', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.purchase_items
    UNION ALL SELECT 'purchase_number_state', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.purchase_number_state
    UNION ALL SELECT 'purchases', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.purchases
    UNION ALL SELECT 'return_policy_settings', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.return_policy_settings
    UNION ALL SELECT 'sale_item_batch_allocations', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.sale_item_batch_allocations
    UNION ALL SELECT 'sale_items', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.sale_items
    UNION ALL SELECT 'sale_payments', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.sale_payments
    UNION ALL SELECT 'sale_return_items', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.sale_return_items
    UNION ALL SELECT 'sale_returns', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.sale_returns
    UNION ALL SELECT 'sales', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.sales
    UNION ALL SELECT 'stock_batches', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.stock_batches
    UNION ALL SELECT 'stock_movements', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.stock_movements
    UNION ALL SELECT 'supplier_ledger', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.supplier_ledger
    UNION ALL SELECT 'suppliers', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.suppliers
    UNION ALL SELECT 'trash_bin_events', count(*), count(*) FILTER (WHERE shop_id IS NULL) FROM public.trash_bin_events
  ) AS counts
),
privacy AS (
  SELECT
    coalesce(bool_and(NOT has_column_privilege(
      'authenticated',
      format('public.%I', table_name),
      'shop_id',
      'SELECT'
    )), false) AS authenticated_cannot_read_any_shop_id,
    coalesce(bool_and(NOT has_column_privilege(
      'anon',
      format('public.%I', table_name),
      'shop_id',
      'SELECT'
    )), false) AS anon_cannot_read_any_shop_id,
    NOT has_function_privilege(
      'authenticated',
      'tenant_private.current_shop_id()',
      'EXECUTE'
    ) AS authenticated_cannot_call_shop_id_helper,
    has_function_privilege(
      'authenticated',
      'tenant_private.is_current_shop(uuid)',
      'EXECUTE'
    ) AS authenticated_can_call_non_disclosing_scope_check,
    position(
      'to_jsonb(v_request) - ''shop_id'''
      IN pg_get_functiondef('public.request_print(text,text,jsonb)'::regprocedure)
    ) > 0 AS request_print_omits_shop_id
  FROM expected_tables
)
SELECT pg_catalog.jsonb_build_object(
  'coverage', (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'table', table_name,
          'total_rows', total_rows,
          'unassigned_rows', unassigned_rows
        )
        ORDER BY table_name
      ),
      '[]'::jsonb
    )
    FROM coverage
  ),
  'shop_counts', jsonb_build_object(
    'active_pharma_care_shops',
      (SELECT count(*) FROM public.shops WHERE name = 'Pharma Care' AND status = 'active'),
    'total_shops',
      (SELECT count(*) FROM public.shops),
    'assigned_super_admin_profiles',
      (SELECT count(*) FROM public.profiles WHERE role = 'super_admin' AND shop_id IS NOT NULL)
  ),
  'shop_constraint_counts', jsonb_build_object(
    'shop_foreign_key_count',
      (SELECT count(*) FROM pg_catalog.pg_constraint
       WHERE conname LIKE '%\_shop_id\_fkey' ESCAPE '\'
         AND connamespace = 'public'::regnamespace),
    'shop_index_count',
      (SELECT count(*) FROM pg_catalog.pg_indexes
       WHERE schemaname = 'public'
         AND indexname LIKE '%\_shop_id\_idx' ESCAPE '\')
  ),
  'privacy', (SELECT to_jsonb(privacy) FROM privacy)
) AS s3_smoke_test;
