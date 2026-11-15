-- S6 policy/privilege preflight. Read-only; returns policy expressions and grants, no row data.
WITH policy_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', tablename,
    'name', policyname,
    'command', cmd,
    'permissive', permissive,
    'roles', roles,
    'using', qual,
    'with_check', with_check
  ) ORDER BY tablename, policyname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND (
      tablename IN ('profiles', 'shops', 'audit_logs', 'trash_bin_events')
      OR strpos(lower(COALESCE(qual, '') || ' ' || COALESCE(with_check, '')), 'is_admin(') > 0
      OR strpos(lower(COALESCE(qual, '') || ' ' || COALESCE(with_check, '')), 'has_any_permission(') > 0
      OR strpos(lower(COALESCE(qual, '') || ' ' || COALESCE(with_check, '')), 'is_staff(') > 0
      OR strpos(lower(COALESCE(qual, '') || ' ' || COALESCE(with_check, '')), 'current_shop_id(') > 0
      OR strpos(lower(COALESCE(qual, '') || ' ' || COALESCE(with_check, '')), 'is_current_shop(') > 0
    )
),
table_privileges AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', table_name,
    'grantee', grantee,
    'privilege', privilege_type,
    'grantable', is_grantable
  ) ORDER BY table_name, grantee, privilege_type), '[]'::jsonb) AS value
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('profiles', 'shops', 'audit_logs', 'trash_bin_events')
    AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
),
column_privileges AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', table_name,
    'column', column_name,
    'grantee', grantee,
    'privilege', privilege_type,
    'grantable', is_grantable
  ) ORDER BY table_name, column_name, grantee, privilege_type), '[]'::jsonb) AS value
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name IN ('profiles', 'shops')
    AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
)
SELECT jsonb_build_object(
  'stage', 'S6 policy and privilege preflight',
  'read_only', true,
  'policies', policy_inventory.value,
  'table_privileges', table_privileges.value,
  'column_privileges', column_privileges.value
) AS s6_policy_privilege_preflight
FROM policy_inventory
CROSS JOIN table_privileges
CROSS JOIN column_privileges;
