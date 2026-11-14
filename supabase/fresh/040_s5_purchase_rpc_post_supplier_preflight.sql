-- Read-only preflight for purchase Batch 040 after supplier Batch 039.
-- Returns function bodies/security metadata, schema definitions, and aggregate counts only.
-- Run in Supabase SQL Editor; do not proceed to a purchase migration until this output is reviewed.
-- The stock-batch purchase link is through purchase_items; stock_batches has no purchase_id.
-- Query 050 supersedes this purchase-only preflight for the consolidated S5 review.
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
        FROM aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
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
    CASE WHEN routine.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_function_identity_arguments(routine.oid)
    END AS identity_arguments,
    routine.prosecdef AS security_definer,
    routine.proconfig AS function_settings,
    routine.proacl AS function_acl,
    CASE WHEN routine.oid IS NULL THEN NULL
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
    ('shops'),
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
        'is_validated', constraint_row.convalidated,
        'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)
      ) ORDER BY constraint_row.conname)
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = table_class.oid
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
      JOIN pg_catalog.pg_class index_class ON index_class.oid = index_info.indexrelid
      WHERE index_info.indrelid = table_class.oid
    ), '[]'::jsonb) AS indexes
  FROM expected_tables expected
  LEFT JOIN pg_catalog.pg_class table_class
    ON table_class.oid = to_regclass('public.' || expected.table_name)
),
table_rows AS (
  SELECT 'purchase_number_state' AS table_name, shop_id FROM public.purchase_number_state
  UNION ALL
  SELECT 'purchases', shop_id FROM public.purchases
  UNION ALL
  SELECT 'purchase_items', shop_id FROM public.purchase_items
  UNION ALL
  SELECT 'suppliers', shop_id FROM public.suppliers
  UNION ALL
  SELECT 'stock_batches', shop_id FROM public.stock_batches
  UNION ALL
  SELECT 'stock_movements', shop_id FROM public.stock_movements
  UNION ALL
  SELECT 'supplier_ledger', shop_id FROM public.supplier_ledger
),
table_coverage AS (
  SELECT
    expected.table_name,
    count(row_data.table_name)::bigint AS row_count,
    count(*) FILTER (
      WHERE row_data.table_name IS NOT NULL AND row_data.shop_id IS NULL
    )::bigint AS null_shop_id_count,
    count(DISTINCT row_data.shop_id)::bigint AS distinct_shop_count
  FROM unnest(ARRAY[
    'purchase_number_state',
    'purchases',
    'purchase_items',
    'suppliers',
    'stock_batches',
    'stock_movements',
    'supplier_ledger'
  ]::text[]) AS expected(table_name)
  LEFT JOIN table_rows row_data ON row_data.table_name = expected.table_name
  GROUP BY expected.table_name
),
shop_summary AS (
  SELECT jsonb_build_object(
    'shop_count', (SELECT count(*)::bigint FROM public.shops),
    'purchase_counter_row_count', (SELECT count(*)::bigint FROM public.purchase_number_state),
    'shops_missing_purchase_counter_count', (
      SELECT count(*)::bigint
      FROM public.shops shop
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.purchase_number_state counter
        WHERE counter.shop_id = shop.id
      )
    )
  ) AS summary
),
counter_summary AS (
  SELECT jsonb_build_object(
    'row_count', count(*)::bigint,
    'null_shop_id_count', count(*) FILTER (WHERE shop_id IS NULL)::bigint,
    'non_one_id_count', count(*) FILTER (WHERE id <> 1)::bigint,
    'distinct_shop_count', count(DISTINCT shop_id)::bigint,
    'duplicate_shop_counter_groups', (
      SELECT count(*)::bigint
      FROM (
        SELECT shop_id
        FROM public.purchase_number_state
        WHERE shop_id IS NOT NULL
        GROUP BY shop_id
        HAVING count(*) > 1
      ) duplicate_counters
    ),
    'max_last_number', max(last_number)
  ) AS summary
  FROM public.purchase_number_state
),
purchase_number_summary AS (
  SELECT jsonb_build_object(
    'purchase_count', count(*)::bigint,
    'null_shop_id_count', count(*) FILTER (WHERE shop_id IS NULL)::bigint,
    'null_pr_no_count', count(*) FILTER (WHERE pr_no IS NULL)::bigint,
    'unparseable_pr_no_count', count(*) FILTER (
      WHERE pr_no IS NOT NULL AND pr_no !~ '^PR-[0-9]+$'
    )::bigint,
    'distinct_shop_count', count(DISTINCT shop_id)::bigint,
    'max_numeric_pr_no', max(substring(pr_no FROM '^PR-([0-9]+)$')::numeric)
  ) AS summary
  FROM public.purchases
),
per_shop_number_summary AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'shop_ordinal', shop_ordinal,
    'purchase_count', purchase_count,
    'null_pr_no_count', null_pr_no_count,
    'unparseable_pr_no_count', unparseable_pr_no_count,
    'max_numeric_pr_no', max_numeric_pr_no,
    'counter_row_count', counter_row_count,
    'max_last_number', max_last_number
  ) ORDER BY shop_ordinal), '[]'::jsonb) AS summary
  FROM (
    SELECT
      row_number() OVER (ORDER BY shop.id)::integer AS shop_ordinal,
      count(DISTINCT purchase.id)::bigint AS purchase_count,
      count(DISTINCT purchase.id) FILTER (WHERE purchase.pr_no IS NULL)::bigint AS null_pr_no_count,
      count(DISTINCT purchase.id) FILTER (
        WHERE purchase.pr_no IS NOT NULL AND purchase.pr_no !~ '^PR-[0-9]+$'
      )::bigint AS unparseable_pr_no_count,
      max(substring(purchase.pr_no FROM '^PR-([0-9]+)$')::numeric) AS max_numeric_pr_no,
      count(DISTINCT counter.id)::bigint AS counter_row_count,
      max(counter.last_number) AS max_last_number
    FROM public.shops shop
    LEFT JOIN public.purchases purchase ON purchase.shop_id = shop.id
    LEFT JOIN public.purchase_number_state counter ON counter.shop_id = shop.id
    GROUP BY shop.id
  ) per_shop
),
purchase_number_collisions AS (
  SELECT jsonb_build_object(
    'duplicate_pr_no_groups_within_shop', (
      SELECT count(*)::bigint
      FROM (
        SELECT shop_id, pr_no
        FROM public.purchases
        WHERE shop_id IS NOT NULL AND pr_no IS NOT NULL
        GROUP BY shop_id, pr_no
        HAVING count(*) > 1
      ) duplicate_numbers
    ),
    'pr_no_values_shared_across_shops', (
      SELECT count(*)::bigint
      FROM (
        SELECT pr_no
        FROM public.purchases
        WHERE shop_id IS NOT NULL AND pr_no IS NOT NULL
        GROUP BY pr_no
        HAVING count(DISTINCT shop_id) > 1
      ) shared_numbers
    )
  ) AS summary
),
supplier_summary AS (
  SELECT jsonb_build_object(
    'supplier_count', count(*)::bigint,
    'null_shop_id_count', count(*) FILTER (WHERE supplier.shop_id IS NULL)::bigint,
    'distinct_shop_count', count(DISTINCT supplier.shop_id)::bigint,
    'unassigned_suppliers_with_purchases', (
      SELECT count(DISTINCT supplier_row.id)::bigint
      FROM public.suppliers supplier_row
      JOIN public.purchases purchase ON purchase.supplier_id = supplier_row.id
      WHERE supplier_row.shop_id IS NULL
    ),
    'purchase_supplier_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.purchases purchase
      JOIN public.suppliers supplier_row ON supplier_row.id = purchase.supplier_id
      WHERE purchase.shop_id IS DISTINCT FROM supplier_row.shop_id
    ),
    'batch_supplier_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.stock_batches batch
      JOIN public.suppliers supplier_row ON supplier_row.id = batch.supplier_id
      WHERE batch.shop_id IS DISTINCT FROM supplier_row.shop_id
    ),
    'ledger_supplier_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.supplier_ledger ledger
      JOIN public.suppliers supplier_row ON supplier_row.id = ledger.supplier_id
      WHERE ledger.shop_id IS DISTINCT FROM supplier_row.shop_id
    )
  ) AS summary
  FROM public.suppliers supplier
),
purchase_reference_mismatches AS (
  SELECT jsonb_build_object(
    'purchase_items_parent_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.purchase_items item
      JOIN public.purchases purchase ON purchase.id = item.purchase_id
      WHERE item.shop_id IS DISTINCT FROM purchase.shop_id
    ),
    'purchase_supplier_reference_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.purchases purchase
      JOIN public.suppliers supplier ON supplier.id = purchase.supplier_id
      WHERE purchase.shop_id IS DISTINCT FROM supplier.shop_id
    ),
    'purchase_stock_batch_reference_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.purchase_items item
      JOIN public.stock_batches batch ON batch.id = item.stock_batch_id
      JOIN public.purchases purchase ON purchase.id = item.purchase_id
      WHERE batch.shop_id IS DISTINCT FROM purchase.shop_id
    ),
    'supplier_ledger_purchase_reference_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.supplier_ledger ledger
      JOIN public.purchases purchase ON purchase.id = ledger.purchase_id
      WHERE ledger.shop_id IS DISTINCT FROM purchase.shop_id
    )
  ) AS summary
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
  'tables', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'table_found', table_found,
      'shop_id_nullable', shop_id_nullable,
      'rls_enabled', rls_enabled,
      'rls_forced', rls_forced,
      'columns', columns,
      'constraints', constraints,
      'indexes', indexes
    ) ORDER BY table_name), '[]'::jsonb)
    FROM table_summary
  ),
  'shop_summary', (SELECT summary FROM shop_summary),
  'table_coverage', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'row_count', row_count,
      'null_shop_id_count', null_shop_id_count,
      'distinct_shop_count', distinct_shop_count
    ) ORDER BY table_name), '[]'::jsonb)
    FROM table_coverage
  ),
  'purchase_number_state', (SELECT summary FROM counter_summary),
  'purchase_number_summary', (SELECT summary FROM purchase_number_summary),
  'per_shop_number_summary', (SELECT summary FROM per_shop_number_summary),
  'purchase_number_collisions', (SELECT summary FROM purchase_number_collisions),
  'supplier_summary_after_batch_039', (SELECT summary FROM supplier_summary),
  'purchase_reference_mismatches', (SELECT summary FROM purchase_reference_mismatches)
) AS s5_purchase_batch040_preflight;
