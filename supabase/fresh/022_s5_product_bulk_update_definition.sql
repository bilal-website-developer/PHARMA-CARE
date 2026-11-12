-- Read-only S5 source review for products_bulk_update before tenant-scoping it.
-- Inspect the live definition, selected IDs, category lookup, writes, audit event, and ACL.
WITH expected AS (
  SELECT *
  FROM (VALUES
    ('public.products_bulk_update', 'public.products_bulk_update(uuid[],text,text)')
  ) AS routine_list(expected_name, signature)
)
SELECT
  expected.expected_name,
  expected.signature,
  p.oid IS NOT NULL AS routine_found,
  p.proname AS routine_name,
  CASE
    WHEN p.oid IS NULL THEN NULL
    ELSE pg_catalog.pg_get_function_identity_arguments(p.oid)
  END AS identity_arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  CASE
    WHEN p.oid IS NULL THEN NULL
    ELSE has_function_privilege('anon', p.oid, 'EXECUTE')
  END AS anon_can_execute,
  CASE
    WHEN p.oid IS NULL THEN NULL
    ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE')
  END AS authenticated_can_execute,
  CASE
    WHEN p.oid IS NULL THEN NULL
    ELSE pg_catalog.pg_get_functiondef(p.oid)
  END AS function_definition
FROM expected
LEFT JOIN pg_catalog.pg_proc AS p
  ON p.oid = to_regprocedure(expected.signature)
ORDER BY expected.expected_name;
