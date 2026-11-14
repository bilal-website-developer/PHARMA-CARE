-- Read-only S5 review of the live sale-posting RPCs before any tenant-scope changes.
-- Returns function metadata and definitions only; it performs no writes.
WITH expected AS (
  SELECT *
  FROM (VALUES
    (
      'public.post_sale',
      'public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)'
    ),
    (
      'public.post_sale_with_customer_details',
      'public.post_sale_with_customer_details(uuid,text,text,text,text,text,text,jsonb,integer,integer,integer,jsonb)'
    )
  ) AS routine_list(expected_name, signature)
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
  )
) AS s5_sale_write_rpc_definitions;
