-- Read-only S5 review of the live sales-return workflow and return-policy RPCs.
-- Returns routine definitions and tenant-table metadata only; it performs no writes.
WITH expected AS (
  SELECT *
  FROM (VALUES
    ('public.sale_for_return', 'public.sale_for_return(text)'),
    ('public.request_sale_return', 'public.request_sale_return(uuid,text,jsonb)'),
    ('public.pending_sale_returns', 'public.pending_sale_returns()'),
    ('public.reject_sale_return', 'public.reject_sale_return(uuid,text)'),
    ('public.process_sale_return', 'public.process_sale_return(uuid,jsonb)'),
    ('public.get_return_policy_settings', 'public.get_return_policy_settings()'),
    ('public.update_return_policy_settings', 'public.update_return_policy_settings(integer,integer)')
  ) AS routine_list(expected_name, signature)
),
tenant_tables AS (
  SELECT table_list.table_name
  FROM (VALUES
    ('return_policy_settings'),
    ('sale_returns'),
    ('sale_return_items'),
    ('sales'),
    ('sale_items'),
    ('sale_item_batch_allocations'),
    ('sale_payments'),
    ('stock_batches'),
    ('stock_movements'),
    ('customers'),
    ('medicines'),
    ('medicine_units'),
    ('khata_entries'),
    ('audit_logs'),
    ('profiles')
  ) AS table_list(table_name)
)
SELECT jsonb_build_object(
  'routines', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'expected_name', expected.expected_name,
      'signature', expected.signature,
      'routine_found', routine.oid IS NOT NULL,
      'identity_arguments', CASE
        WHEN routine.oid IS NULL THEN NULL
        ELSE pg_catalog.pg_get_function_identity_arguments(routine.oid)
      END,
      'result_type', CASE
        WHEN routine.oid IS NULL THEN NULL
        ELSE pg_catalog.pg_get_function_result(routine.oid)
      END,
      'security_definer', routine.prosecdef,
      'function_settings', routine.proconfig,
      'anon_can_execute', CASE
        WHEN routine.oid IS NULL THEN NULL
        ELSE has_function_privilege('anon', routine.oid, 'EXECUTE')
      END,
      'authenticated_can_execute', CASE
        WHEN routine.oid IS NULL THEN NULL
        ELSE has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      END,
      'function_definition', CASE
        WHEN routine.oid IS NULL THEN NULL
        ELSE pg_catalog.pg_get_functiondef(routine.oid)
      END
    ) ORDER BY expected.expected_name), '[]'::jsonb)
    FROM expected
    LEFT JOIN pg_catalog.pg_proc AS routine
      ON routine.oid = to_regprocedure(expected.signature)
  ),
  'tenant_tables', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table_name', expected.table_name,
      'table_found', table_class.oid IS NOT NULL,
      'shop_id_column', EXISTS (
        SELECT 1
        FROM information_schema.columns column_info
        WHERE column_info.table_schema = 'public'
          AND column_info.table_name = expected.table_name
          AND column_info.column_name = 'shop_id'
      ),
      'rls_enabled', table_class.relrowsecurity,
      'rls_forced', table_class.relforcerowsecurity
    ) ORDER BY expected.table_name), '[]'::jsonb)
    FROM tenant_tables AS expected
    LEFT JOIN pg_catalog.pg_class AS table_class
      ON table_class.oid = to_regclass(format('public.%I', expected.table_name))
  )
) AS s5_sales_return_rpc_inventory;
