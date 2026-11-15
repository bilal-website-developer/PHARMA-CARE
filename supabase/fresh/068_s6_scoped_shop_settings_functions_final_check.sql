-- Final metadata, definition, and grant check for S6 package 068.
WITH routines AS (
  SELECT
    procedure.proname,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.prosrc,
    procedure.proacl,
    procedure.proowner,
    procedure.oid
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND (
      (procedure.proname = 'current_shop_settings'
        AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) = '')
      OR (procedure.proname = 'update_current_shop_settings'
        AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'p_settings jsonb')
    )
),
checks AS (
  SELECT
    count(*) = 2 AS both_routines_exist,
    bool_and(prosecdef) AS both_security_definer,
    bool_and(proconfig @> ARRAY['search_path=""']::text[]) AS both_empty_search_path,
    bool_and(pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')) AS authenticated_execute,
    bool_and(NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')) AS anon_execute_revoked,
    bool_and(NOT pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')) AS service_role_execute_revoked,
    bool_and(NOT EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(coalesce(routines.proacl, pg_catalog.acldefault('f', routines.proowner))) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )) AS public_execute_revoked,
    bool_and(
      proname <> 'current_shop_settings'
      OR (
        pg_catalog.strpos(prosrc, 'tenant_private.current_shop_id') > 0
        AND pg_catalog.strpos(prosrc, 'shop_settings') > 0
      )
    ) AS read_scope_verified,
    bool_and(
      proname <> 'update_current_shop_settings'
      OR (
        pg_catalog.strpos(prosrc, 'tenant_private.current_shop_id') > 0
        AND pg_catalog.strpos(prosrc, 'v_actor_role <> ''admin''') > 0
        AND pg_catalog.strpos(prosrc, '''settings''') > 0
        AND pg_catalog.strpos(prosrc, 'maxDiscountPaisa') > 0
        AND pg_catalog.strpos(prosrc, 'roundNet') > 0
        AND pg_catalog.strpos(prosrc, 'shopName') = 0
      )
    ) AS update_validation_verified
  FROM routines
)
SELECT pg_catalog.jsonb_build_object(
  'stage', 'S6 package 068 scoped shop-settings functions final check',
  'status', CASE
    WHEN coalesce(both_routines_exist, false)
      AND coalesce(both_security_definer, false)
      AND coalesce(both_empty_search_path, false)
      AND coalesce(authenticated_execute, false)
      AND coalesce(anon_execute_revoked, false)
      AND coalesce(service_role_execute_revoked, false)
      AND coalesce(public_execute_revoked, false)
      AND coalesce(read_scope_verified, false)
      AND coalesce(update_validation_verified, false)
    THEN 'PASS' ELSE 'FAIL' END,
  'routine_count', (SELECT count(*) FROM routines),
  'both_security_definer', both_security_definer,
  'both_empty_search_path', both_empty_search_path,
  'authenticated_execute', authenticated_execute,
  'anon_execute_revoked', anon_execute_revoked,
  'service_role_execute_revoked', service_role_execute_revoked,
  'public_execute_revoked', public_execute_revoked,
  'read_scope_verified', read_scope_verified,
  'update_validation_verified', update_validation_verified
) AS s6_scoped_shop_settings_functions_final_check
FROM checks;
