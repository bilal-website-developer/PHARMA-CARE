-- Read-only S5 review of the live purchase RPCs before any tenant-scope changes.
-- Returns function bodies, grants/security metadata, and the relevant table schema.
WITH expected_routines(routine_name) AS (
  VALUES
    ('post_purchase'),
    ('purchase_catalog'),
    ('purchase_history'),
    ('purchase_detail'),
    ('void_purchase')
),
routine_definitions AS (
  SELECT
    expected.routine_name AS expected_name,
    routine.oid,
    CASE
      WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_function_identity_arguments(routine.oid)
    END AS identity_arguments,
    CASE
      WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_function_result(routine.oid)
    END AS result_type,
    routine.prosecdef AS security_definer,
    routine.proconfig AS function_settings,
    routine.proacl AS function_acl,
    CASE
      WHEN routine.oid IS NULL OR to_regrole('anon') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('anon'), routine.oid, 'EXECUTE')
    END AS anon_can_execute,
    CASE
      WHEN routine.oid IS NULL OR to_regrole('authenticated') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('authenticated'), routine.oid, 'EXECUTE')
    END AS authenticated_can_execute,
    CASE
      WHEN routine.oid IS NULL THEN NULL
      ELSE EXISTS (
        SELECT 1
        FROM aclexplode(coalesce(
          routine.proacl,
          acldefault('f', routine.proowner)
        )) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
    END AS public_can_execute,
    CASE
      WHEN routine.oid IS NULL THEN NULL
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
    count(oid) AS routine_count,
    coalesce(jsonb_agg(jsonb_build_object(
      'identity_arguments', identity_arguments,
      'result_type', result_type,
      'security_definer', security_definer,
      'function_settings', function_settings,
      'function_acl', function_acl,
      'anon_can_execute', anon_can_execute,
      'authenticated_can_execute', authenticated_can_execute,
      'public_can_execute', public_can_execute,
      'shop_helper_present', position(
        'tenant_private.current_shop_id()' IN lower(function_definition)
      ) > 0,
      'shop_filter_marker_present', position(
        'shop_id = v_shop_id' IN lower(function_definition)
      ) > 0,
      'function_definition', function_definition
    ) ORDER BY identity_arguments) FILTER (WHERE oid IS NOT NULL), '[]'::jsonb) AS definitions
  FROM routine_definitions
  GROUP BY expected_name
),
expected_helpers(schema_name, routine_name, identity_arguments) AS (
  VALUES
    ('tenant_private', 'current_shop_id', ''),
    ('public', 'has_any_permission', 'perms text[]'),
    ('public', 'can_view_cost', '')
),
helper_definitions AS (
  SELECT
    expected.schema_name,
    expected.routine_name,
    routine.oid,
    CASE
      WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_function_identity_arguments(routine.oid)
    END AS identity_arguments,
    routine.prosecdef AS security_definer,
    routine.proconfig AS function_settings,
    routine.proacl AS function_acl,
    CASE
      WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_functiondef(routine.oid)
    END AS function_definition
  FROM expected_helpers expected
  LEFT JOIN pg_catalog.pg_proc routine
    ON routine.proname = expected.routine_name
   AND routine.pronamespace = to_regnamespace(expected.schema_name)
   AND routine.prokind = 'f'
   AND pg_catalog.pg_get_function_identity_arguments(routine.oid) = expected.identity_arguments
),
expected_tables(table_name) AS (
  VALUES
    ('profiles'),
    ('purchase_number_state'),
    ('purchases'),
    ('purchase_items'),
    ('suppliers'),
    ('medicines'),
    ('medicine_units'),
    ('stock_batches'),
    ('stock_movements'),
    ('supplier_ledger'),
    ('audit_logs')
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
        'is_nullable', column_info.is_nullable,
        'is_generated', column_info.is_generated
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
    ), '[]'::jsonb) AS constraints
  FROM expected_tables expected
  LEFT JOIN pg_catalog.pg_class table_class
    ON table_class.oid = to_regclass('public.' || expected.table_name)
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
  'helpers', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema_name', schema_name,
      'routine_name', routine_name,
      'routine_found', oid IS NOT NULL,
      'identity_arguments', identity_arguments,
      'security_definer', security_definer,
      'function_settings', function_settings,
      'function_acl', function_acl,
      'function_definition', function_definition
    ) ORDER BY schema_name, routine_name), '[]'::jsonb)
    FROM helper_definitions
  ),
  'tenant_tables', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'table_found', table_found,
      'shop_id_nullable', shop_id_nullable,
      'rls_enabled', rls_enabled,
      'rls_forced', rls_forced,
      'columns', columns,
      'constraints', constraints
    ) ORDER BY table_name), '[]'::jsonb)
    FROM table_summary
  )
) AS s5_purchase_rpc_definitions;
