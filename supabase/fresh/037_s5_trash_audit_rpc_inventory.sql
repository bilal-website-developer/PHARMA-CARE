-- Read-only inventory of Trash Bin, audit, and profile-purge routines.
-- Returns function definitions and aggregate event counts, not event or shop IDs.
WITH expected_routines(routine_name) AS (
  VALUES
    ('capture_trash_bin_event'),
    ('trash_bin_events_list'),
    ('restore_trash_supplier'),
    ('restore_trash_medicine'),
    ('trash_bin_permanently_delete'),
    ('trash_bin_finalize_profile_purge')
),
routine_definitions AS (
  SELECT
    expected.routine_name AS expected_name,
    routine.oid,
    CASE WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_function_identity_arguments(routine.oid)
    END AS identity_arguments,
    CASE WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_function_result(routine.oid)
    END AS result_type,
    routine.prosecdef AS security_definer,
    routine.proconfig AS function_settings,
    routine.proacl AS function_acl,
    CASE
      WHEN to_regrole('anon') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('anon'), routine.oid, 'EXECUTE')
    END AS anon_can_execute,
    CASE
      WHEN to_regrole('authenticated') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('authenticated'), routine.oid, 'EXECUTE')
    END AS authenticated_can_execute,
    CASE
      WHEN to_regrole('service_role') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('service_role'), routine.oid, 'EXECUTE')
    END AS service_role_can_execute,
    CASE
      WHEN routine.oid IS NULL THEN NULL
      ELSE EXISTS (
        SELECT 1
        FROM aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) privilege
        WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
      )
    END AS public_can_execute,
    CASE WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_functiondef(routine.oid)
    END AS function_definition
  FROM expected_routines expected
  LEFT JOIN pg_catalog.pg_proc routine
    ON routine.proname = expected.routine_name
   AND routine.pronamespace = 'public'::regnamespace
   AND routine.prokind = 'f'
),
routine_summary AS (
  SELECT
    expected_name,
    count(oid)::bigint AS routine_count,
    coalesce(jsonb_agg(jsonb_build_object(
      'identity_arguments', identity_arguments,
      'result_type', result_type,
      'security_definer', security_definer,
      'function_settings', function_settings,
      'function_acl', function_acl,
      'anon_can_execute', anon_can_execute,
      'authenticated_can_execute', authenticated_can_execute,
      'service_role_can_execute', service_role_can_execute,
      'public_can_execute', public_can_execute,
      'shop_helper_present', position(
        'tenant_private.current_shop_id()' IN lower(function_definition)
      ) > 0,
      'function_definition', function_definition
    ) ORDER BY identity_arguments) FILTER (WHERE oid IS NOT NULL), '[]'::jsonb) AS definitions
  FROM routine_definitions
  GROUP BY expected_name
),
expected_tables(table_name) AS (
  VALUES
    ('trash_bin_events'),
    ('profiles'),
    ('medicines'),
    ('suppliers'),
    ('purchases'),
    ('audit_logs'),
    ('stock_batches')
),
table_summary AS (
  SELECT
    expected.table_name,
    table_class.oid IS NOT NULL AS table_found,
    coalesce(table_class.relrowsecurity, false) AS rls_enabled,
    coalesce(table_class.relforcerowsecurity, false) AS rls_forced,
    (
      SELECT column_info.is_nullable
      FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public'
        AND column_info.table_name = expected.table_name
        AND column_info.column_name = 'shop_id'
    ) AS shop_id_nullable,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'column_name', column_info.column_name,
        'data_type', column_info.data_type,
        'is_nullable', column_info.is_nullable
      ) ORDER BY column_info.ordinal_position)
      FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public'
        AND column_info.table_name = expected.table_name
    ), '[]'::jsonb) AS columns,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'constraint_name', constraint_row.conname,
        'constraint_type', constraint_row.contype,
        'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)
      ) ORDER BY constraint_row.conname)
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = table_class.oid
    ), '[]'::jsonb) AS constraints,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'policy_name', policy.policyname,
        'command', policy.cmd,
        'roles', policy.roles,
        'using', policy.qual,
        'with_check', policy.with_check
      ) ORDER BY policy.policyname)
      FROM pg_catalog.pg_policies policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = expected.table_name
    ), '[]'::jsonb) AS policies
  FROM expected_tables expected
  LEFT JOIN pg_catalog.pg_class table_class
    ON table_class.oid = to_regclass('public.' || expected.table_name)
),
trash_event_summary AS (
  SELECT jsonb_build_object(
    'event_count', count(*)::bigint,
    'null_shop_id_count', count(*) FILTER (
      WHERE to_jsonb(event_row)->>'shop_id' IS NULL
    )::bigint,
    'distinct_shop_count', count(DISTINCT to_jsonb(event_row)->>'shop_id')::bigint,
    'event_type_action_counts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'entity_type', event_group.entity_type,
        'action', event_group.action,
        'event_count', event_group.event_count
      ) ORDER BY event_group.entity_type, event_group.action)
      FROM (
        SELECT entity_type, action, count(*)::bigint AS event_count
        FROM public.trash_bin_events
        GROUP BY entity_type, action
      ) event_group
    ), '[]'::jsonb)
  ) AS summary
  FROM public.trash_bin_events event_row
),
trigger_inventory AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table_name', table_class.relname,
    'trigger_name', trigger_row.tgname,
    'enabled_state', trigger_row.tgenabled,
    'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
  ) ORDER BY table_class.relname, trigger_row.tgname), '[]'::jsonb) AS triggers
  FROM pg_catalog.pg_trigger trigger_row
  JOIN pg_catalog.pg_class table_class ON table_class.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace table_schema ON table_schema.oid = table_class.relnamespace
  WHERE table_schema.nspname = 'public'
    AND NOT trigger_row.tgisinternal
    AND table_class.relname IN ('medicines', 'suppliers', 'purchases')
)
SELECT jsonb_build_object(
  'routines', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'expected_name', expected_name,
      'routine_count', routine_count,
      'definitions', definitions
    ) ORDER BY expected_name), '[]'::jsonb)
    FROM routine_summary
  ),
  'tables', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'table_found', table_found,
      'shop_id_nullable', shop_id_nullable,
      'rls_enabled', rls_enabled,
      'rls_forced', rls_forced,
      'columns', columns,
      'constraints', constraints,
      'policies', policies
    ) ORDER BY table_name), '[]'::jsonb)
    FROM table_summary
  ),
  'trash_event_data_summary', (SELECT summary FROM trash_event_summary),
  'triggers', (SELECT triggers FROM trigger_inventory)
) AS s5_trash_audit_rpc_inventory;
