-- Read-only review of customer_accounts_summary() and the tenant protections
-- on the customer/ledger tables. Returns metadata, function definitions, and
-- aggregate counts only; it does not return customer or ledger records.
WITH expected_routines(schema_name, routine_name) AS (
  VALUES
    ('public', 'customer_accounts_summary'),
    ('public', 'has_any_permission'),
    ('tenant_private', 'current_shop_id')
),
routine_inventory AS (
  SELECT
    expected.schema_name,
    expected.routine_name,
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
    routine.proowner AS function_owner_oid,
    owner_role.rolname AS function_owner,
    owner_role.rolsuper AS owner_is_superuser,
    owner_role.rolbypassrls AS owner_can_bypass_rls,
    CASE WHEN routine.oid IS NULL OR to_regrole('anon') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('anon'), routine.oid, 'EXECUTE')
    END AS anon_can_execute,
    CASE WHEN routine.oid IS NULL OR to_regrole('authenticated') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('authenticated'), routine.oid, 'EXECUTE')
    END AS authenticated_can_execute,
    CASE WHEN routine.oid IS NULL THEN NULL
      ELSE EXISTS (
        SELECT 1
        FROM aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
    END AS public_can_execute,
    CASE WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_functiondef(routine.oid)
    END AS function_definition,
    CASE WHEN routine.oid IS NULL THEN NULL
      ELSE position(
        'tenant_private.current_shop_id()'
        IN lower(pg_catalog.pg_get_functiondef(routine.oid))
      ) > 0
    END AS current_shop_helper_marker_present,
    CASE WHEN routine.oid IS NULL THEN NULL
      ELSE position(
        'tenant_private.is_current_shop('
        IN lower(pg_catalog.pg_get_functiondef(routine.oid))
      ) > 0
    END AS is_current_shop_marker_present,
    CASE WHEN routine.oid IS NULL THEN NULL
      ELSE position(
        'shop_id'
        IN lower(pg_catalog.pg_get_functiondef(routine.oid))
      ) > 0
    END AS shop_id_text_present
  FROM expected_routines expected
  LEFT JOIN pg_catalog.pg_namespace routine_schema
    ON routine_schema.nspname = expected.schema_name
  LEFT JOIN pg_catalog.pg_proc routine
    ON routine.pronamespace = routine_schema.oid
   AND routine.proname = expected.routine_name
   AND routine.prokind = 'f'
  LEFT JOIN pg_catalog.pg_roles owner_role
    ON owner_role.oid = routine.proowner
),
summary_function AS (
  SELECT *
  FROM routine_inventory
  WHERE schema_name = 'public'
    AND routine_name = 'customer_accounts_summary'
),
expected_relations(relation_name) AS (
  VALUES
    ('customers'),
    ('khata_entries'),
    ('profiles'),
    ('sales')
),
relation_inventory AS (
  SELECT
    expected.relation_name,
    relation.oid,
    relation.relkind,
    relation.relrowsecurity AS rls_enabled,
    relation.relforcerowsecurity AS rls_forced,
    relation.relowner AS table_owner_oid,
    table_owner.rolname AS table_owner,
    table_owner.rolsuper AS table_owner_is_superuser,
    table_owner.rolbypassrls AS table_owner_can_bypass_rls,
    CASE WHEN relation.oid IS NULL OR to_regrole('anon') IS NULL THEN NULL
      ELSE has_table_privilege(to_regrole('anon'), relation.oid, 'SELECT')
    END AS anon_can_select,
    CASE WHEN relation.oid IS NULL OR to_regrole('authenticated') IS NULL THEN NULL
      ELSE has_table_privilege(to_regrole('authenticated'), relation.oid, 'SELECT')
    END AS authenticated_can_select,
    CASE WHEN relation.oid IS NULL THEN NULL
      ELSE EXISTS (
        SELECT 1
        FROM aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'SELECT'
      )
    END AS public_can_select,
    CASE WHEN relation.oid IS NULL THEN NULL
      ELSE EXISTS (
        SELECT 1
        FROM information_schema.columns column_info
        WHERE column_info.table_schema = 'public'
          AND column_info.table_name = expected.relation_name
          AND column_info.column_name = 'shop_id'
      )
    END AS shop_id_column_exists,
    CASE WHEN relation.oid IS NULL THEN NULL
      ELSE relation.relowner = (SELECT function_owner_oid FROM summary_function)
    END AS summary_function_owner_matches_table_owner,
    CASE WHEN relation.oid IS NULL THEN NULL
      WHEN NOT coalesce(relation.relrowsecurity, false) THEN NULL
      WHEN NOT coalesce((SELECT security_definer FROM summary_function), false) THEN false
      ELSE coalesce((SELECT owner_is_superuser OR owner_can_bypass_rls
                     FROM summary_function), false)
        OR (
          relation.relowner = (SELECT function_owner_oid FROM summary_function)
          AND NOT relation.relforcerowsecurity
        )
    END AS summary_function_owner_context_bypasses_rls,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'column_name', column_info.column_name,
        'data_type', column_info.data_type,
        'is_nullable', column_info.is_nullable
      ) ORDER BY column_info.ordinal_position)
      FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public'
        AND column_info.table_name = expected.relation_name
    ), '[]'::jsonb) AS columns,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'constraint_name', constraint_row.conname,
        'constraint_type', constraint_row.contype,
        'is_validated', constraint_row.convalidated,
        'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)
      ) ORDER BY constraint_row.conname)
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = relation.oid
    ), '[]'::jsonb) AS constraints,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'index_name', index_class.relname,
        'is_unique', index_info.indisunique,
        'is_primary', index_info.indisprimary,
        'is_valid', index_info.indisvalid,
        'definition', pg_catalog.pg_get_indexdef(index_class.oid)
      ) ORDER BY index_class.relname)
      FROM pg_catalog.pg_index index_info
      JOIN pg_catalog.pg_class index_class
        ON index_class.oid = index_info.indexrelid
      WHERE index_info.indrelid = relation.oid
    ), '[]'::jsonb) AS indexes,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'policy_name', policy.policyname,
        'permissive', policy.permissive,
        'roles', policy.roles,
        'command', policy.cmd,
        'using_expression', policy.qual,
        'with_check_expression', policy.with_check
      ) ORDER BY policy.policyname)
      FROM pg_catalog.pg_policies policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = expected.relation_name
    ), '[]'::jsonb) AS policies
  FROM expected_relations expected
  LEFT JOIN pg_catalog.pg_class relation
    ON relation.oid = to_regclass('public.' || expected.relation_name)
  LEFT JOIN pg_catalog.pg_roles table_owner
    ON table_owner.oid = relation.relowner
),
ownership_counts AS (
  SELECT jsonb_build_object(
    'customers', (
      SELECT jsonb_build_object(
        'row_count', count(*)::bigint,
        'null_or_missing_shop_id_count', count(*) FILTER (
          WHERE to_jsonb(customer_row)->>'shop_id' IS NULL
        )::bigint,
        'distinct_shop_count', count(
          DISTINCT to_jsonb(customer_row)->>'shop_id'
        )::bigint
      )
      FROM public.customers customer_row
    ),
    'khata_entries', (
      SELECT jsonb_build_object(
        'row_count', count(*)::bigint,
        'null_or_missing_shop_id_count', count(*) FILTER (
          WHERE to_jsonb(entry_row)->>'shop_id' IS NULL
        )::bigint,
        'distinct_shop_count', count(
          DISTINCT to_jsonb(entry_row)->>'shop_id'
        )::bigint
      )
      FROM public.khata_entries entry_row
    )
  ) AS summary
),
reference_counts AS (
  SELECT jsonb_build_object(
    'khata_customer_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.khata_entries entry
      JOIN public.customers customer ON customer.id = entry.customer_id
      WHERE to_jsonb(entry)->>'shop_id'
        IS DISTINCT FROM to_jsonb(customer)->>'shop_id'
    ),
    'khata_sale_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.khata_entries entry
      JOIN public.sales sale ON sale.id = entry.sale_id
      WHERE entry.sale_id IS NOT NULL
        AND to_jsonb(entry)->>'shop_id'
          IS DISTINCT FROM to_jsonb(sale)->>'shop_id'
    ),
    'khata_entries_with_missing_sale_count', (
      SELECT count(*)::bigint
      FROM public.khata_entries entry
      LEFT JOIN public.sales sale ON sale.id = entry.sale_id
      WHERE entry.sale_id IS NOT NULL
        AND sale.id IS NULL
    )
  ) AS summary
)
SELECT jsonb_build_object(
  'routines', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema_name', schema_name,
      'routine_name', routine_name,
      'routine_found', oid IS NOT NULL,
      'identity_arguments', identity_arguments,
      'result_type', result_type,
      'security_definer', security_definer,
      'function_settings', function_settings,
      'function_acl', function_acl,
      'function_owner', function_owner,
      'owner_is_superuser', owner_is_superuser,
      'owner_can_bypass_rls', owner_can_bypass_rls,
      'anon_can_execute', anon_can_execute,
      'authenticated_can_execute', authenticated_can_execute,
      'public_can_execute', public_can_execute,
      'current_shop_helper_marker_present', current_shop_helper_marker_present,
      'is_current_shop_marker_present', is_current_shop_marker_present,
      'shop_id_text_present', shop_id_text_present,
      'function_definition', function_definition
    ) ORDER BY schema_name, routine_name, identity_arguments), '[]'::jsonb)
    FROM routine_inventory
  ),
  'relations', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'relation_name', relation_name,
      'relation_found', oid IS NOT NULL,
      'relation_kind', relkind,
      'rls_enabled', rls_enabled,
      'rls_forced', rls_forced,
      'table_owner', table_owner,
      'table_owner_is_superuser', table_owner_is_superuser,
      'table_owner_can_bypass_rls', table_owner_can_bypass_rls,
      'anon_can_select', anon_can_select,
      'authenticated_can_select', authenticated_can_select,
      'public_can_select', public_can_select,
      'shop_id_column_exists', shop_id_column_exists,
      'summary_function_owner_matches_table_owner', summary_function_owner_matches_table_owner,
      'summary_function_owner_context_bypasses_rls', summary_function_owner_context_bypasses_rls,
      'columns', columns,
      'constraints', constraints,
      'indexes', indexes,
      'policies', policies
    ) ORDER BY relation_name), '[]'::jsonb)
    FROM relation_inventory
  ),
  'ownership_counts', (SELECT summary FROM ownership_counts),
  'reference_counts', (SELECT summary FROM reference_counts)
) AS s5_customer_accounts_scope_review;
