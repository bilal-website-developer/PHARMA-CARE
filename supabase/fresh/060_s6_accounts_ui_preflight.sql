-- S6 Accounts/UI preflight. Read-only catalog and aggregate checks; no identifiers or account PII.
WITH relation_inventory AS (
  SELECT
    namespace.nspname,
    relation.relname,
    relation.relkind,
    relation.relrowsecurity,
    relation.relforcerowsecurity
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE
    (namespace.nspname = 'public' AND relation.relname IN (
      'profiles', 'shops', 'audit_logs', 'trash_bin_events',
      'shop_settings', 'admin_private_notes', 'shop_provisioning_operations'
    ))
),
profile_counts AS (
  SELECT jsonb_build_object(
    'by_role_activity_shop_assignment_and_deletion',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'role', grouped.role,
          'is_active', grouped.is_active,
          'shop_assigned', grouped.shop_assigned,
          'deleted', grouped.deleted,
          'count', grouped.row_count
        ) ORDER BY grouped.role, grouped.is_active, grouped.shop_assigned, grouped.deleted)
        FROM (
          SELECT
            profile.role,
            profile.is_active,
            (to_jsonb(profile)->>'shop_id') IS NOT NULL AS shop_assigned,
            (to_jsonb(profile)->>'deleted_at') IS NOT NULL AS deleted,
            count(*) AS row_count
          FROM public.profiles AS profile
          GROUP BY profile.role, profile.is_active,
            (to_jsonb(profile)->>'shop_id') IS NOT NULL,
            (to_jsonb(profile)->>'deleted_at') IS NOT NULL
        ) AS grouped
      ), '[]'::jsonb),
    'permissions_by_role',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'role', grouped.role,
          'permission', grouped.permission_key,
          'profile_count', grouped.profile_count
        ) ORDER BY grouped.role, grouped.permission_key)
        FROM (
          SELECT profile.role, permission.permission_key, count(*) AS profile_count
          FROM public.profiles AS profile
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(to_jsonb(profile)->'permissions') = 'array'
                THEN to_jsonb(profile)->'permissions'
              ELSE '[]'::jsonb
            END
          ) AS permission(permission_key)
          GROUP BY profile.role, permission.permission_key
        ) AS grouped
      ), '[]'::jsonb),
    'created_by_attribution',
      jsonb_build_object(
        'attributed_profile_count',
          count(*) FILTER (WHERE (to_jsonb(profile)->>'created_by') IS NOT NULL),
        'unassigned_profile_count',
          count(*) FILTER (WHERE (to_jsonb(profile)->>'created_by') IS NULL)
      ),
    'global_admin_counts',
      jsonb_build_object(
        'active_super_admins',
          count(*) FILTER (WHERE profile.role = 'super_admin'
            AND profile.is_active AND profile.deleted_at IS NULL),
        'all_non_deleted_super_admins',
          count(*) FILTER (WHERE profile.role = 'super_admin'
            AND profile.deleted_at IS NULL)
      )
  ) AS summary
  FROM public.profiles AS profile
),
shop_status_counts AS (
  SELECT jsonb_agg(jsonb_build_object(
    'status', grouped.status,
    'count', grouped.row_count
  ) ORDER BY grouped.status) AS value
  FROM (
    SELECT COALESCE(to_jsonb(shop)->>'status', 'unknown') AS status, count(*) AS row_count
    FROM public.shops AS shop
    GROUP BY COALESCE(to_jsonb(shop)->>'status', 'unknown')
  ) AS grouped
),
active_admin_distribution AS (
  SELECT jsonb_build_object(
    'shops_with_zero_active_admins',
      count(*) FILTER (WHERE active_admin_count = 0),
    'shops_with_one_active_admin',
      count(*) FILTER (WHERE active_admin_count = 1),
    'shops_with_multiple_active_admins',
      count(*) FILTER (WHERE active_admin_count > 1)
  ) AS value
  FROM (
    SELECT shop.id,
      count(profile.id) FILTER (
        WHERE profile.role = 'admin'
          AND profile.is_active
          AND profile.deleted_at IS NULL
      ) AS active_admin_count
    FROM public.shops AS shop
    LEFT JOIN public.profiles AS profile ON profile.shop_id = shop.id
    GROUP BY shop.id
  ) AS per_shop
),
auth_linkage AS (
  SELECT jsonb_build_object(
    'profiles_without_auth_user',
      (SELECT count(*) FROM public.profiles AS profile
       LEFT JOIN auth.users AS auth_user ON auth_user.id = profile.id
       WHERE auth_user.id IS NULL),
    'auth_users_without_profile',
      (SELECT count(*) FROM auth.users AS auth_user
       LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
       WHERE profile.id IS NULL)
  ) AS value
),
function_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signature', namespace.nspname || '.' || procedure.proname || '('
      || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')',
    'security_definer', procedure.prosecdef,
    'configuration', procedure.proconfig,
    'anon_execute', has_function_privilege('anon', procedure.oid, 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', procedure.oid, 'EXECUTE'),
    'service_role_execute', has_function_privilege('service_role', procedure.oid, 'EXECUTE'),
    'definition', pg_catalog.pg_get_functiondef(procedure.oid)
  ) ORDER BY namespace.nspname, procedure.proname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE procedure.prokind IN ('f', 'p')
    AND (
      (namespace.nspname = 'public' AND procedure.proname IN (
        'is_admin', 'has_any_permission', 'is_staff',
        'manage_users_current_active_profile_role',
        'manage_users_team_member_access', 'trash_bin_events_list'
      ))
      OR (namespace.nspname = 'tenant_private'
        AND procedure.proname IN ('current_shop_id', 'is_current_shop'))
    )
),
helper_callers AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signature', namespace.nspname || '.' || procedure.proname || '('
      || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')',
    'security_definer', procedure.prosecdef,
    'uses_is_admin', strpos(lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'is_admin(') > 0,
    'uses_has_any_permission',
      strpos(lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'has_any_permission(') > 0,
    'uses_is_staff', strpos(lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'is_staff(') > 0,
    'uses_current_shop_id',
      strpos(lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'current_shop_id(') > 0
  ) ORDER BY namespace.nspname, procedure.proname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname IN ('public', 'tenant_private')
    AND procedure.prokind IN ('f', 'p')
    AND procedure.proname NOT IN (
      'is_admin', 'has_any_permission', 'is_staff',
      'current_shop_id', 'is_current_shop'
    )
    AND (
      strpos(lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'is_admin(') > 0
      OR strpos(lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'has_any_permission(') > 0
      OR strpos(lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'is_staff(') > 0
      OR strpos(lower(pg_catalog.pg_get_functiondef(procedure.oid)), 'current_shop_id(') > 0
    )
),
profile_permission_constraints AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', constraint_row.conname,
    'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)
  ) ORDER BY constraint_row.conname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::regclass
    AND constraint_row.contype = 'c'
    AND (
      constraint_row.conname ILIKE '%permission%'
      OR pg_catalog.pg_get_constraintdef(constraint_row.oid) ILIKE '%permissions%'
    )
),
policy_inventory AS (
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
    AND tablename IN (
      'profiles', 'shops', 'audit_logs', 'trash_bin_events',
      'shop_settings', 'admin_private_notes', 'shop_provisioning_operations'
    )
),
column_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', table_name,
    'column', column_name,
    'type', data_type,
    'nullable', is_nullable,
    'default', column_default
  ) ORDER BY table_name, ordinal_position), '[]'::jsonb) AS value
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (
      'profiles', 'shops', 'audit_logs', 'trash_bin_events',
      'shop_settings', 'admin_private_notes', 'shop_provisioning_operations'
    )
),
trigger_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', relation.relname,
    'name', trigger_row.tgname,
    'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
  ) ORDER BY relation.relname, trigger_row.tgname), '[]'::jsonb) AS value
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE NOT trigger_row.tgisinternal
    AND namespace.nspname = 'public'
    AND relation.relname IN ('profiles', 'shops', 'audit_logs', 'trash_bin_events')
)
SELECT jsonb_build_object(
  'stage', 'S6 accounts and UI preflight',
  'read_only', true,
  'relations', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', nspname,
      'name', relname,
      'kind', relkind,
      'rls_enabled', relrowsecurity,
      'rls_forced', relforcerowsecurity
    ) ORDER BY nspname, relname), '[]'::jsonb)
    FROM relation_inventory
  ),
  'columns', column_inventory.value,
  'shops', (
    SELECT jsonb_build_object(
      'total', count(*),
      'developer_shop_count', count(*) FILTER (WHERE lower(btrim(name)) = 'developer shop')
    )
    FROM public.shops
  ),
  'shop_counts_by_status', shop_status_counts.value,
  'admin_distribution_by_shop', active_admin_distribution.value,
  'profile_counts', profile_counts.summary,
  'auth_profile_linkage_counts', auth_linkage.value,
  'permission_constraints', profile_permission_constraints.value,
  'policies', policy_inventory.value,
  'functions', function_inventory.value,
  'protected_helper_callers', helper_callers.value,
  'triggers', trigger_inventory.value
) AS s6_accounts_ui_preflight
FROM column_inventory
CROSS JOIN shop_status_counts
CROSS JOIN active_admin_distribution
CROSS JOIN profile_counts
CROSS JOIN auth_linkage
CROSS JOIN profile_permission_constraints
CROSS JOIN policy_inventory
CROSS JOIN function_inventory
CROSS JOIN helper_callers
CROSS JOIN trigger_inventory;
