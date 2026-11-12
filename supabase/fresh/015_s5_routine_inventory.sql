-- Read-only S5 inventory of application and tenant-private routines.
-- Review each routine's body and call sites before proposing any rewrite.
SELECT
  n.nspname AS schema_name,
  p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  CASE
    WHEN p.prokind = 'p' THEN NULL
    ELSE pg_catalog.pg_get_function_result(p.oid)
  END AS result_type,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  l.lanname AS language_name,
  p.prokind AS routine_kind,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS function_settings,
  coalesce(p.proacl::text, '(default ACL)') AS explicit_acl,
  CASE
    WHEN to_regrole('anon') IS NULL THEN NULL
    ELSE has_function_privilege(to_regrole('anon'), p.oid, 'EXECUTE')
  END AS anon_can_execute,
  CASE
    WHEN to_regrole('authenticated') IS NULL THEN NULL
    ELSE has_function_privilege(to_regrole('authenticated'), p.oid, 'EXECUTE')
  END AS authenticated_can_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language AS l
  ON l.oid = p.prolang
WHERE n.nspname IN ('public', 'tenant_private')
  AND p.prokind IN ('f', 'p')
ORDER BY n.nspname, p.proname,
  pg_catalog.pg_get_function_identity_arguments(p.oid);
