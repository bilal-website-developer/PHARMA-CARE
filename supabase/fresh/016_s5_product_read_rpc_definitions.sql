-- Read-only S5 source review for the first product/catalog read batch.
-- Returns every overload for each target routine; a missing routine returns
-- one row with a NULL definition so the inventory can be reconciled.
WITH expected_routines(routine_name) AS (
  VALUES
    ('products_list'),
    ('products_overview_stats'),
    ('products_import_preview'),
    ('pos_catalog')
)
SELECT
  expected.routine_name AS expected_name,
  p.proname AS routine_name,
  CASE
    WHEN p.oid IS NULL THEN NULL
    ELSE pg_catalog.pg_get_function_identity_arguments(p.oid)
  END AS identity_arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  CASE
    WHEN p.oid IS NULL OR to_regrole('anon') IS NULL THEN NULL
    ELSE has_function_privilege(to_regrole('anon'), p.oid, 'EXECUTE')
  END AS anon_can_execute,
  CASE
    WHEN p.oid IS NULL OR to_regrole('authenticated') IS NULL THEN NULL
    ELSE has_function_privilege(to_regrole('authenticated'), p.oid, 'EXECUTE')
  END AS authenticated_can_execute,
  CASE
    WHEN p.oid IS NULL THEN NULL
    ELSE pg_catalog.pg_get_functiondef(p.oid)
  END AS function_definition
FROM expected_routines AS expected
LEFT JOIN pg_catalog.pg_proc AS p
  ON p.pronamespace = 'public'::regnamespace
 AND p.proname = expected.routine_name
 AND p.prokind = 'f'
ORDER BY expected.routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid);
