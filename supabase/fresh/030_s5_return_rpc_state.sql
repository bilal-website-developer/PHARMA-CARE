-- Read-only diagnostic after Batch 029 detected existing scope in sale_for_return().
-- Returns current definitions and scope/security markers; it performs no writes.
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
resolved AS (
  SELECT
    expected.expected_name,
    expected.signature,
    routine.oid,
    CASE
      WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_functiondef(routine.oid)
    END AS function_definition
  FROM expected
  LEFT JOIN pg_catalog.pg_proc AS routine
    ON routine.oid = to_regprocedure(expected.signature)
)
SELECT jsonb_build_object(
  'routines', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'expected_name', resolved.expected_name,
      'signature', resolved.signature,
      'routine_found', resolved.oid IS NOT NULL,
      'identity_arguments', CASE
        WHEN resolved.oid IS NULL THEN NULL
        ELSE pg_catalog.pg_get_function_identity_arguments(resolved.oid)
      END,
      'result_type', CASE
        WHEN resolved.oid IS NULL THEN NULL
        ELSE pg_catalog.pg_get_function_result(resolved.oid)
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
      'shop_helper_present', CASE
        WHEN resolved.function_definition IS NULL THEN NULL
        ELSE position(
          'tenant_private.current_shop_id()'
          IN lower(resolved.function_definition)
        ) > 0
      END,
      'shop_filter_marker_present', CASE
        WHEN resolved.function_definition IS NULL THEN NULL
        ELSE position(
          'shop_id = v_shop_id'
          IN lower(resolved.function_definition)
        ) > 0
      END,
      'function_definition', resolved.function_definition
    ) ORDER BY resolved.expected_name), '[]'::jsonb)
    FROM resolved
    LEFT JOIN pg_catalog.pg_proc AS routine ON routine.oid = resolved.oid
  )
) AS s5_return_rpc_state;
