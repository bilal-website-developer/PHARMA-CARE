-- S6 package 062 catalog/ACL check. Read-only; returns status and metadata only.
WITH helper_checks AS (
  SELECT
    procedure.proname,
    procedure.prosecdef AS security_definer,
    procedure.proconfig,
    has_function_privilege('authenticated', procedure.oid, 'EXECUTE') AS authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'EXECUTE') AS anon_execute,
    CASE procedure.proname
      WHEN 'is_admin' THEN
        position('profile.role = ''admin''' IN lower(pg_catalog.pg_get_functiondef(procedure.oid))) > 0
        AND position('tenant_private.current_shop_id()' IN lower(pg_catalog.pg_get_functiondef(procedure.oid))) > 0
      WHEN 'has_any_permission' THEN
        position('profile.permissions && coalesce(perms, array[]::text[])' IN lower(pg_catalog.pg_get_functiondef(procedure.oid))) > 0
        AND position('profile.role in' IN lower(pg_catalog.pg_get_functiondef(procedure.oid))) = 0
        AND position('tenant_private.current_shop_id()' IN lower(pg_catalog.pg_get_functiondef(procedure.oid))) > 0
      WHEN 'is_staff' THEN
        position('profile.shop_id = tenant_private.current_shop_id()' IN lower(pg_catalog.pg_get_functiondef(procedure.oid))) > 0
        AND position('profile.role in (''admin'', ''manager'', ''cashier'', ''accountant'')' IN lower(pg_catalog.pg_get_functiondef(procedure.oid))) > 0
      WHEN 'is_platform_admin' THEN
        position('profile.role = ''super_admin''' IN lower(pg_catalog.pg_get_functiondef(procedure.oid))) > 0
        AND position('profile.shop_id is null' IN lower(pg_catalog.pg_get_functiondef(procedure.oid))) > 0
      ELSE false
    END AS expected_definition
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname IN ('is_admin', 'has_any_permission', 'is_staff', 'is_platform_admin')
    AND procedure.prokind = 'f'
),
policy_checks AS (
  SELECT
    count(*) FILTER (
      WHERE policyname = 'profiles read own profile or assigned team'
        AND cmd = 'SELECT'
        AND permissive = 'PERMISSIVE'
        AND qual LIKE '%created_by = auth.uid()%'
    ) = 1 AS creator_scoped_read,
    count(*) FILTER (
      WHERE policyname = 'profiles_shop_isolation'
        AND cmd = 'ALL'
        AND permissive = 'RESTRICTIVE'
    ) = 1 AS shop_isolation_present,
    count(*) FILTER (
      WHERE policyname IN (
        'read own profile or admin reads all',
        'admin can add profiles',
        'admin can edit profiles',
        'admin can delete profiles'
      )
    ) = 0 AS legacy_profile_policies_absent
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles'
),
permission_constraint AS (
  SELECT count(*) = 1
    AND bool_and(pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''settings''%')
    AS settings_allowed
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::regclass
    AND constraint_row.conname = 'profiles_permissions_valid'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated
),
acl_checks AS (
  SELECT
    NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.profiles', 'DELETE')
      AS authenticated_profile_dml_revoked,
    NOT has_column_privilege('authenticated', 'public.profiles', 'shop_id', 'SELECT')
      AS shop_id_hidden
)
SELECT jsonb_build_object(
  'stage', 'S6 package 062 final check',
  'status', CASE WHEN
    (SELECT count(*) = 4 AND bool_and(
      security_definer
      AND authenticated_execute
      AND NOT anon_execute
      AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
      AND expected_definition
    ) FROM helper_checks)
    AND (SELECT creator_scoped_read AND shop_isolation_present AND legacy_profile_policies_absent FROM policy_checks)
    AND (SELECT settings_allowed FROM permission_constraint)
    AND (SELECT authenticated_profile_dml_revoked AND shop_id_hidden FROM acl_checks)
    THEN 'PASS' ELSE 'FAIL' END,
  'helpers', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', proname,
      'security_definer', security_definer,
      'search_path', proconfig,
      'authenticated_execute', authenticated_execute,
      'anon_execute', anon_execute,
      'expected_definition', expected_definition
    ) ORDER BY proname), '[]'::jsonb)
    FROM helper_checks
  ),
  'profile_policies', (SELECT to_jsonb(policy_checks) FROM policy_checks),
  'settings_permission_allowed', (SELECT settings_allowed FROM permission_constraint),
  'authenticated_profile_dml_revoked', (SELECT authenticated_profile_dml_revoked FROM acl_checks),
  'shop_id_hidden', (SELECT shop_id_hidden FROM acl_checks)
) AS s6_package_062_final_check;
