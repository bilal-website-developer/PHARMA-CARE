-- S6 package 065 provisioning preflight. Read-only; excludes shop/user identifiers and PII.
WITH wanted_tables AS (
  SELECT unnest(ARRAY[
    'profiles', 'shops', 'return_policy_settings', 'audit_logs',
    'trash_bin_events', 'shop_settings', 'admin_private_notes',
    'shop_provisioning_operations'
  ]) AS table_name
),
relation_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', relation.relname,
    'rls_enabled', relation.relrowsecurity,
    'rls_forced', relation.relforcerowsecurity
  ) ORDER BY relation.relname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN wanted_tables AS wanted ON wanted.table_name = relation.relname
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
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
  JOIN wanted_tables AS wanted ON wanted.table_name = column_row.table_name
  WHERE column_row.table_schema = 'public'
),
constraint_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', relation.relname,
    'name', constraint_row.conname,
    'type', constraint_row.contype,
    'validated', constraint_row.convalidated,
    'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)
  ) ORDER BY relation.relname, constraint_row.conname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_constraint AS constraint_row
  JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN wanted_tables AS wanted ON wanted.table_name = relation.relname
  WHERE namespace.nspname = 'public'
),
index_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', relation.relname,
    'index', index_relation.relname,
    'definition', pg_catalog.pg_get_indexdef(index_row.indexrelid)
  ) ORDER BY relation.relname, index_relation.relname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_index AS index_row
  JOIN pg_catalog.pg_class AS relation ON relation.oid = index_row.indrelid
  JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN wanted_tables AS wanted ON wanted.table_name = relation.relname
  WHERE namespace.nspname = 'public'
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
  JOIN wanted_tables AS wanted ON wanted.table_name = policy.tablename
  WHERE policy.schemaname = 'public'
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
shop_status_counts AS (
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
return_policy_coverage AS (
  SELECT jsonb_build_object(
    'shop_count', count(DISTINCT shop.id),
    'policy_row_count', count(policy.shop_id),
    'shops_missing_default_policy', count(*) FILTER (WHERE policy.shop_id IS NULL)
  ) AS value
  FROM public.shops AS shop
  LEFT JOIN public.return_policy_settings AS policy
    ON policy.shop_id = shop.id AND policy.id = 1
),
trigger_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', namespace.nspname,
    'table', relation.relname,
    'name', trigger_row.tgname,
    'enabled', trigger_row.tgenabled,
    'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
  ) ORDER BY namespace.nspname, relation.relname, trigger_row.tgname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE NOT trigger_row.tgisinternal
    AND (
      (namespace.nspname = 'public' AND relation.relname IN ('profiles', 'shops'))
      OR (namespace.nspname = 'auth' AND relation.relname = 'users')
    )
),
function_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signature', namespace.nspname || '.' || procedure.proname || '('
      || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')',
    'security_definer', procedure.prosecdef,
    'configuration', procedure.proconfig,
    'public_execute', EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(COALESCE(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) AS privilege
      WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
    ),
    'anon_execute', pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE'),
    'authenticated_execute', pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE'),
    'service_role_execute', pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) ORDER BY namespace.nspname, procedure.proname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE procedure.prokind = 'f'
    AND (
      (namespace.nspname = 'public' AND procedure.proname IN (
        'manage_users_team_member_access',
        'manage_users_profile_update',
        'get_return_policy_settings',
        'update_return_policy_settings',
        'is_platform_admin'
      ))
      OR (namespace.nspname = 'tenant_private' AND procedure.proname = 'current_shop_id')
    )
),
table_privileges AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', grant_row.table_name,
    'grantee', grant_row.grantee,
    'privilege', grant_row.privilege_type,
    'grantable', grant_row.is_grantable
  ) ORDER BY grant_row.table_name, grant_row.grantee, grant_row.privilege_type), '[]'::jsonb) AS value
  FROM information_schema.role_table_grants AS grant_row
  JOIN wanted_tables AS wanted ON wanted.table_name = grant_row.table_name
  WHERE grant_row.table_schema = 'public'
    AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
)
SELECT jsonb_build_object(
  'stage', 'S6 package 065 provisioning preflight',
  'read_only', true,
  'relations', relation_inventory.value,
  'columns', column_inventory.value,
  'constraints', constraint_inventory.value,
  'indexes', index_inventory.value,
  'policies', policy_inventory.value,
  'profile_counts', profile_counts.value,
  'shop_status_counts', shop_status_counts.value,
  'return_policy_coverage', return_policy_coverage.value,
  'triggers', trigger_inventory.value,
  'functions', function_inventory.value,
  'table_privileges', table_privileges.value
)
FROM relation_inventory
CROSS JOIN column_inventory
CROSS JOIN constraint_inventory
CROSS JOIN index_inventory
CROSS JOIN policy_inventory
CROSS JOIN profile_counts
CROSS JOIN shop_status_counts
CROSS JOIN return_policy_coverage
CROSS JOIN trigger_inventory
CROSS JOIN function_inventory
CROSS JOIN table_privileges;
