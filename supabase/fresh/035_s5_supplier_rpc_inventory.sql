-- Read-only inventory of supplier write RPCs and supplier ownership references.
-- Returns function definitions and aggregate counts, not supplier records or IDs.
WITH expected_routines(routine_name) AS (
  VALUES
    ('save_supplier'),
    ('deactivate_supplier'),
    ('activate_supplier')
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
    ('profiles'),
    ('shops'),
    ('suppliers'),
    ('purchases'),
    ('stock_batches'),
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
supplier_summary AS (
  SELECT jsonb_build_object(
    'supplier_count', count(*)::bigint,
    'null_shop_id_count', count(*) FILTER (WHERE supplier.shop_id IS NULL)::bigint,
    'null_shop_active_count', count(*) FILTER (
      WHERE supplier.shop_id IS NULL AND supplier.is_active
    )::bigint,
    'null_shop_inactive_count', count(*) FILTER (
      WHERE supplier.shop_id IS NULL AND NOT supplier.is_active
    )::bigint,
    'distinct_shop_count', count(DISTINCT supplier.shop_id)::bigint,
    'null_shop_suppliers_with_purchase_references', (
      SELECT count(DISTINCT supplier.id)::bigint
      FROM public.suppliers supplier
      JOIN public.purchases purchase ON purchase.supplier_id = supplier.id
      WHERE supplier.shop_id IS NULL
    ),
    'null_shop_suppliers_with_batch_references', (
      SELECT count(DISTINCT supplier.id)::bigint
      FROM public.suppliers supplier
      JOIN public.stock_batches batch ON batch.supplier_id = supplier.id
      WHERE supplier.shop_id IS NULL
    ),
    'null_shop_suppliers_with_ledger_references', (
      SELECT count(DISTINCT supplier.id)::bigint
      FROM public.suppliers supplier
      JOIN public.supplier_ledger ledger ON ledger.supplier_id = supplier.id
      WHERE supplier.shop_id IS NULL
    ),
    'purchase_supplier_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.purchases purchase
      JOIN public.suppliers supplier ON supplier.id = purchase.supplier_id
      WHERE purchase.shop_id IS DISTINCT FROM supplier.shop_id
    ),
    'batch_supplier_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.stock_batches batch
      JOIN public.suppliers supplier ON supplier.id = batch.supplier_id
      WHERE batch.shop_id IS DISTINCT FROM supplier.shop_id
    ),
    'ledger_supplier_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.supplier_ledger ledger
      JOIN public.suppliers supplier ON supplier.id = ledger.supplier_id
      WHERE ledger.shop_id IS DISTINCT FROM supplier.shop_id
    )
  ) AS summary
  FROM public.suppliers supplier
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
  'supplier_data_summary', (SELECT summary FROM supplier_summary)
) AS s5_supplier_rpc_inventory;
