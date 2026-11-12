WITH customer_columns AS (
  SELECT
    count(*) = 5
    AND coalesce(bool_and(is_nullable = 'NO'), false) AS passed
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'sales'
    AND column_name = ANY (ARRAY[
      'customer_type',
      'customer_phone',
      'customer_whatsapp',
      'customer_address',
      'customer_notes'
    ])
), customer_type_constraint AS (
  SELECT coalesce(bool_or(convalidated), false) AS passed
  FROM pg_constraint
  WHERE conrelid = 'public.sales'::regclass
    AND conname = 'sales_customer_type_check'
    AND contype = 'c'
), routines AS (
  SELECT
    p.oid,
    p.prosecdef,
    coalesce(array_to_string(p.proconfig, ','), '') AS settings,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
    pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  WHERE p.oid IN (
    to_regprocedure(
      'public.post_sale_with_customer_details(uuid,text,text,text,text,text,text,jsonb,integer,integer,integer,jsonb)'
    ),
    to_regprocedure('public.sales_history_range(timestamptz,timestamptz)')
  )
), routine_checks AS (
  SELECT
    count(*) = 2 AS expected_routine_count,
    coalesce(bool_and(
      prosecdef
      AND position('search_path=public' IN settings) > 0
      AND NOT anon_execute
      AND authenticated_execute
    ), false) AS security_and_grants_passed,
    coalesce(bool_and(
      position('tenant_private.current_shop_id()' IN definition) > 0
      AND position('shop_id' IN definition) > 0
    ), false) AS shop_scope_checks_present
  FROM routines
)
SELECT jsonb_build_object(
  'sales_customer_columns', customer_columns.passed,
  'customer_type_check_validated', customer_type_constraint.passed,
  'expected_routine_count', routine_checks.expected_routine_count,
  'routine_security_and_grants', routine_checks.security_and_grants_passed,
  'shop_scope_checks_present', routine_checks.shop_scope_checks_present,
  'all_passed',
    customer_columns.passed
    AND customer_type_constraint.passed
    AND routine_checks.expected_routine_count
    AND routine_checks.security_and_grants_passed
    AND routine_checks.shop_scope_checks_present
) AS pos_customer_details_smoke_test
FROM customer_columns
CROSS JOIN customer_type_constraint
CROSS JOIN routine_checks;
