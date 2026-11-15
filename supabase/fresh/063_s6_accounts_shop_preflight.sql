-- S6 accounts/shop preflight. Read-only; no row identifiers or account PII.
WITH relation_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', relation.relname,
    'rls_enabled', relation.relrowsecurity,
    'rls_forced', relation.relforcerowsecurity
  ) ORDER BY relation.relname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND relation.relname IN (
      'profiles', 'shops', 'audit_logs', 'trash_bin_events',
      'shop_settings', 'admin_private_notes', 'shop_provisioning_operations'
    )
),
column_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', column_row.table_name,
    'column', column_row.column_name,
    'type', column_row.data_type,
    'nullable', column_row.is_nullable,
    'default', column_row.column_default
  ) ORDER BY column_row.table_name, column_row.ordinal_position), '[]'::jsonb) AS value
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name IN (
      'profiles', 'shops', 'audit_logs', 'trash_bin_events',
      'shop_settings', 'admin_private_notes', 'shop_provisioning_operations'
    )
),
profile_counts AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'role', grouped.role,
    'active', grouped.is_active,
    'deleted', grouped.deleted,
    'shop_assigned', grouped.shop_assigned,
    'count', grouped.row_count
  ) ORDER BY grouped.role, grouped.is_active, grouped.deleted, grouped.shop_assigned), '[]'::jsonb) AS value
  FROM (
    SELECT
      profile.role,
      profile.is_active,
      profile.deleted_at IS NOT NULL AS deleted,
      profile.shop_id IS NOT NULL AS shop_assigned,
      count(*) AS row_count
    FROM public.profiles AS profile
    GROUP BY profile.role, profile.is_active,
      profile.deleted_at IS NOT NULL, profile.shop_id IS NOT NULL
  ) AS grouped
),
shop_counts AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'status', grouped.status,
    'count', grouped.row_count
  ) ORDER BY grouped.status), '[]'::jsonb) AS value
  FROM (
    SELECT shop.status, count(*) AS row_count
    FROM public.shops AS shop
    GROUP BY shop.status
  ) AS grouped
),
constraint_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', relation.relname,
    'name', constraint_row.conname,
    'type', constraint_row.contype,
    'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)
  ) ORDER BY relation.relname, constraint_row.conname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_constraint AS constraint_row
  JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname IN (
      'profiles', 'shops', 'audit_logs', 'trash_bin_events',
      'shop_settings', 'admin_private_notes', 'shop_provisioning_operations'
    )
),
policy_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', policy.tablename,
    'name', policy.policyname,
    'command', policy.cmd,
    'permissive', policy.permissive,
    'roles', policy.roles,
    'using', policy.qual,
    'with_check', policy.with_check
  ) ORDER BY policy.tablename, policy.policyname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename IN (
      'profiles', 'shops', 'audit_logs', 'trash_bin_events',
      'shop_settings', 'admin_private_notes', 'shop_provisioning_operations'
    )
),
function_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signature', namespace.nspname || '.' || procedure.proname || '('
      || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')',
    'security_definer', procedure.prosecdef,
    'configuration', procedure.proconfig,
    'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
    'public_execute', EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) AS privilege
      WHERE privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ),
    'anon_execute', has_function_privilege('anon', procedure.oid, 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', procedure.oid, 'EXECUTE'),
    'service_role_execute', has_function_privilege('service_role', procedure.oid, 'EXECUTE'),
    'definition', pg_catalog.pg_get_functiondef(procedure.oid)
  ) ORDER BY namespace.nspname, procedure.proname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE procedure.prokind = 'f'
    AND (
      (namespace.nspname = 'public' AND procedure.proname IN (
        'manage_users_team_member_access',
        'manage_users_current_active_profile_role',
        'trash_bin_events_list',
        'is_admin',
        'has_any_permission',
        'is_platform_admin'
      ))
      OR (namespace.nspname = 'tenant_private'
        AND procedure.proname IN ('current_shop_id', 'assign_profile_shop_id'))
    )
),
trigger_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', relation.relname,
    'name', trigger_row.tgname,
    'enabled', trigger_row.tgenabled,
    'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
  ) ORDER BY relation.relname, trigger_row.tgname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE NOT trigger_row.tgisinternal
    AND namespace.nspname = 'public'
    AND relation.relname IN ('profiles', 'shops', 'audit_logs', 'trash_bin_events')
),
acl_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', grant_row.table_name,
    'grantee', grant_row.grantee,
    'privilege', grant_row.privilege_type,
    'grantable', grant_row.is_grantable
  ) ORDER BY grant_row.table_name, grant_row.grantee, grant_row.privilege_type), '[]'::jsonb) AS value
  FROM information_schema.role_table_grants AS grant_row
  WHERE grant_row.table_schema = 'public'
    AND grant_row.table_name IN (
      'profiles', 'shops', 'audit_logs', 'trash_bin_events',
      'shop_settings', 'admin_private_notes', 'shop_provisioning_operations'
    )
    AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
)
SELECT jsonb_build_object(
  'stage', 'S6 accounts/shop preflight 063',
  'read_only', true,
  'relations', relation_inventory.value,
  'columns', column_inventory.value,
  'profile_counts', profile_counts.value,
  'shop_counts', shop_counts.value,
  'constraints', constraint_inventory.value,
  'policies', policy_inventory.value,
  'functions', function_inventory.value,
  'triggers', trigger_inventory.value,
  'table_privileges', acl_inventory.value
) AS s6_accounts_shop_preflight
FROM relation_inventory
CROSS JOIN column_inventory
CROSS JOIN profile_counts
CROSS JOIN shop_counts
CROSS JOIN constraint_inventory
CROSS JOIN policy_inventory
CROSS JOIN function_inventory
CROSS JOIN trigger_inventory
CROSS JOIN acl_inventory;
