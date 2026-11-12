-- Read-only S5 source review for the medicine create/update RPC.
-- Inspect all reads, writes, nested unit IDs, and shop assignment before rewriting.
WITH expected AS (
  SELECT to_regprocedure('public.save_medicine(uuid,jsonb,jsonb)') AS routine_oid
)
SELECT
  'public.save_medicine' AS expected_name,
  p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  pg_catalog.pg_get_functiondef(p.oid) AS function_definition
FROM expected
JOIN pg_catalog.pg_proc AS p
  ON p.oid = expected.routine_oid;
