-- Read-only preflight for the remaining S5 groups: purchases, print, Trash/audit, and stock alerts.
-- Execute all four SELECT statements as one preflight stage. Each returns one JSON cell.
-- Results contain definitions/metadata and aggregate counts only; no customer or event rows.
-- Static scope markers in statement D are triage signals, not proof; review candidates before applying SQL.

-- 050A: purchase RPCs, numbering, supplier ownership, and purchase reference integrity.
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
      'current_shop_helper_present', position(
        'tenant_private.current_shop_id()' IN lower(function_definition)
      ) > 0,
      'function_definition', function_definition
    ) ORDER BY identity_arguments) FILTER (WHERE oid IS NOT NULL), '[]'::jsonb) AS definitions
  FROM routine_definitions
  GROUP BY expected_name
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
    'shops_missing_counter_count', (
      SELECT count(*)::bigint
      FROM public.shops shop
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.purchase_number_state counter
        WHERE counter.shop_id = shop.id
      )
    ),
    'max_last_number', max(last_number)
  ) AS summary
  FROM public.purchase_number_state
),
purchase_summary AS (
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
per_shop_summary AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'shop_ordinal', shop_ordinal,
    'purchase_count', purchase_count,
    'max_numeric_pr_no', max_numeric_pr_no,
    'counter_row_count', counter_row_count,
    'max_last_number', max_last_number
  ) ORDER BY shop_ordinal), '[]'::jsonb) AS summary
  FROM (
    SELECT
      row_number() OVER (ORDER BY shop.id)::integer AS shop_ordinal,
      count(DISTINCT purchase.id)::bigint AS purchase_count,
      max(substring(purchase.pr_no FROM '^PR-([0-9]+)$')::numeric) AS max_numeric_pr_no,
      count(DISTINCT counter.id)::bigint AS counter_row_count,
      max(counter.last_number) AS max_last_number
    FROM public.shops shop
    LEFT JOIN public.purchases purchase ON purchase.shop_id = shop.id
    LEFT JOIN public.purchase_number_state counter ON counter.shop_id = shop.id
    GROUP BY shop.id
  ) shop_data
),
number_collisions AS (
  SELECT jsonb_build_object(
    'duplicate_pr_no_groups_within_shop', (
      SELECT count(*)::bigint
      FROM (
        SELECT shop_id, pr_no
        FROM public.purchases
        WHERE shop_id IS NOT NULL AND pr_no IS NOT NULL
        GROUP BY shop_id, pr_no
        HAVING count(*) > 1
      ) duplicates
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
reference_summary AS (
  SELECT jsonb_build_object(
    'purchase_items_parent_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.purchase_items item
      JOIN public.purchases purchase ON purchase.id = item.purchase_id
      WHERE item.shop_id IS DISTINCT FROM purchase.shop_id
    ),
    'purchase_supplier_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.purchases purchase
      JOIN public.suppliers supplier ON supplier.id = purchase.supplier_id
      WHERE purchase.shop_id IS DISTINCT FROM supplier.shop_id
    ),
    'purchase_item_batch_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.purchase_items item
      JOIN public.stock_batches batch ON batch.id = item.stock_batch_id
      JOIN public.purchases purchase ON purchase.id = item.purchase_id
      WHERE batch.shop_id IS DISTINCT FROM purchase.shop_id
    ),
    'receipt_movement_shop_mismatch_count', (
      SELECT count(*)::bigint
      FROM public.stock_movements movement
      JOIN public.purchases purchase
        ON purchase.id = movement.reference_id
       AND movement.movement_type = 'RECEIPT'
      JOIN public.stock_batches batch ON batch.id = movement.batch_id
      WHERE movement.shop_id IS DISTINCT FROM purchase.shop_id
         OR batch.shop_id IS DISTINCT FROM purchase.shop_id
    ),
    'supplier_ledger_purchase_shop_mismatch_count', (
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
  'purchase_number_state', (SELECT summary FROM counter_summary),
  'purchase_summary', (SELECT summary FROM purchase_summary),
  'per_shop_purchase_summary', (SELECT summary FROM per_shop_summary),
  'number_collisions', (SELECT summary FROM number_collisions),
  'supplier_summary_after_batch_039', (SELECT summary FROM supplier_summary),
  'reference_summary', (SELECT summary FROM reference_summary)
) AS s5_purchase_preflight;

-- 050B: print RPCs, print-related schema, and aggregate request ownership.
WITH expected_routines(routine_name) AS (
  VALUES
    ('request_print'),
    ('decide_print_request'),
    ('pending_print_count'),
    ('mark_printed_request'),
    ('list_print_requests'),
    ('modify_print_request')
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
      'current_shop_helper_present', position(
        'tenant_private.current_shop_id()' IN lower(function_definition)
      ) > 0,
      'function_definition', function_definition
    ) ORDER BY identity_arguments) FILTER (WHERE oid IS NOT NULL), '[]'::jsonb) AS definitions
  FROM routine_definitions
  GROUP BY expected_name
),
expected_tables(table_name) AS (
  VALUES
    ('print_requests'),
    ('profiles'),
    ('shops'),
    ('sales'),
    ('sale_payments'),
    ('customers'),
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
print_request_summary AS (
  SELECT jsonb_build_object(
    'request_count', count(*)::bigint,
    'pending_count', count(*) FILTER (WHERE status = 'pending')::bigint,
    'null_shop_id_count', count(*) FILTER (
      WHERE to_jsonb(request_row)->>'shop_id' IS NULL
    )::bigint,
    'distinct_shop_count', count(DISTINCT to_jsonb(request_row)->>'shop_id')::bigint
  ) AS summary
  FROM public.print_requests request_row
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
      'indexes', indexes
    ) ORDER BY table_name), '[]'::jsonb)
    FROM table_summary
  ),
  'print_request_summary', (SELECT summary FROM print_request_summary)
) AS s5_print_preflight;

-- 050C: Trash/audit RPCs, profile-purge boundary, event aggregates, and attribution triggers.
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
    CASE WHEN routine.oid IS NULL OR to_regrole('anon') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('anon'), routine.oid, 'EXECUTE')
    END AS anon_can_execute,
    CASE WHEN routine.oid IS NULL OR to_regrole('authenticated') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('authenticated'), routine.oid, 'EXECUTE')
    END AS authenticated_can_execute,
    CASE WHEN routine.oid IS NULL OR to_regrole('service_role') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('service_role'), routine.oid, 'EXECUTE')
    END AS service_role_can_execute,
    CASE WHEN routine.oid IS NULL THEN NULL
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
      'current_shop_helper_present', position(
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
    ('audit_logs'),
    ('profiles'),
    ('shops'),
    ('medicines'),
    ('suppliers'),
    ('purchases'),
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
event_summary AS (
  SELECT jsonb_build_object(
    'event_count', count(*)::bigint,
    'null_shop_id_count', count(*) FILTER (
      WHERE to_jsonb(event_row)->>'shop_id' IS NULL
    )::bigint,
    'distinct_shop_count', count(DISTINCT to_jsonb(event_row)->>'shop_id')::bigint,
    'counts_by_entity_action', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'entity_type', grouped.entity_type,
        'action', grouped.action,
        'event_count', grouped.event_count
      ) ORDER BY grouped.entity_type, grouped.action)
      FROM (
        SELECT entity_type, action, count(*)::bigint AS event_count
        FROM public.trash_bin_events
        GROUP BY entity_type, action
      ) grouped
    ), '[]'::jsonb)
  ) AS summary
  FROM public.trash_bin_events event_row
),
trigger_summary AS (
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
    AND table_class.relname IN ('trash_bin_events', 'audit_logs', 'medicines', 'suppliers', 'purchases')
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
      'indexes', indexes
    ) ORDER BY table_name), '[]'::jsonb)
    FROM table_summary
  ),
  'trash_event_summary', (SELECT summary FROM event_summary),
  'attribution_triggers', (SELECT triggers FROM trigger_summary)
) AS s5_trash_audit_preflight;

-- 050D: stock-alert routines plus a catalog of other SECURITY DEFINER public routines.
WITH expected_routines(routine_name) AS (
  VALUES
    ('stock_alerts_summary'),
    ('stock_alerts_list')
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
expected_tables(table_name) AS (
  VALUES
    ('profiles'),
    ('shops'),
    ('medicines'),
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
catalog_routines AS (
  SELECT
    routine.oid,
    routine.proname AS routine_name,
    pg_catalog.pg_get_function_identity_arguments(routine.oid) AS identity_arguments,
    pg_catalog.pg_get_function_result(routine.oid) AS result_type,
    routine.prosecdef AS security_definer,
    routine.proconfig AS function_settings,
    routine.proacl AS function_acl,
    has_function_privilege(to_regrole('anon'), routine.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege(to_regrole('authenticated'), routine.oid, 'EXECUTE') AS authenticated_can_execute,
    EXISTS (
      SELECT 1
      FROM aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) privilege
      WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
    ) AS public_can_execute,
    lower(pg_catalog.pg_get_functiondef(routine.oid)) AS definition_lower,
    pg_catalog.pg_get_functiondef(routine.oid) AS function_definition
  FROM pg_catalog.pg_proc routine
  JOIN pg_catalog.pg_namespace routine_schema ON routine_schema.oid = routine.pronamespace
  WHERE routine_schema.nspname = 'public'
    AND routine.prokind = 'f'
    AND routine.prosecdef
),
other_public_routines AS (
  SELECT *
  FROM catalog_routines
  WHERE routine_name NOT IN (
    'post_purchase', 'purchase_catalog', 'purchase_history', 'purchase_detail', 'void_purchase',
    'request_print', 'decide_print_request', 'pending_print_count', 'mark_printed_request',
    'list_print_requests', 'modify_print_request',
    'capture_trash_bin_event', 'trash_bin_events_list', 'restore_trash_supplier',
    'restore_trash_medicine', 'trash_bin_permanently_delete', 'trash_bin_finalize_profile_purge',
    'stock_alerts_summary', 'stock_alerts_list'
  )
),
other_scope_candidates AS (
  SELECT *
  FROM other_public_routines
  WHERE position('tenant_private.current_shop_id()' IN definition_lower) = 0
    AND position('tenant_private.is_current_shop(' IN definition_lower) = 0
    AND position('shop_id' IN definition_lower) = 0
),
alert_data_summary AS (
  SELECT jsonb_build_object(
    'medicine_count', count(*)::bigint,
    'positive_threshold_medicine_count', count(*) FILTER (
      WHERE medicine.min_stock_alert > 0
    )::bigint,
    'null_shop_id_count', count(*) FILTER (
      WHERE medicine.shop_id IS NULL
    )::bigint,
    'distinct_shop_count', count(DISTINCT medicine.shop_id)::bigint
  ) AS summary
  FROM public.medicines medicine
)
SELECT jsonb_build_object(
  'stock_alert_routines', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'routine_name', expected.routine_name,
      'routine_count', (
        SELECT count(*)::bigint
        FROM pg_catalog.pg_proc routine
        WHERE routine.proname = expected.routine_name
          AND routine.pronamespace = 'public'::regnamespace
          AND routine.prokind = 'f'
      ),
      'definitions', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'identity_arguments', pg_catalog.pg_get_function_identity_arguments(routine.oid),
          'result_type', pg_catalog.pg_get_function_result(routine.oid),
          'security_definer', routine.prosecdef,
          'function_settings', routine.proconfig,
          'function_acl', routine.proacl,
          'anon_can_execute', has_function_privilege(to_regrole('anon'), routine.oid, 'EXECUTE'),
          'authenticated_can_execute', has_function_privilege(to_regrole('authenticated'), routine.oid, 'EXECUTE'),
          'public_can_execute', EXISTS (
            SELECT 1
            FROM aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) privilege
            WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
          ),
          'function_definition', pg_catalog.pg_get_functiondef(routine.oid)
        ) ORDER BY pg_catalog.pg_get_function_identity_arguments(routine.oid))
        FROM pg_catalog.pg_proc routine
        WHERE routine.proname = expected.routine_name
          AND routine.pronamespace = 'public'::regnamespace
          AND routine.prokind = 'f'
      ), '[]'::jsonb)
    ) ORDER BY expected.routine_name), '[]'::jsonb)
    FROM expected_routines expected
  ),
  'stock_alert_tables', (
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
  'stock_alert_data_summary', (SELECT summary FROM alert_data_summary),
  'other_public_security_definer_routine_count', (
    SELECT count(*)::bigint FROM other_public_routines
  ),
  'other_public_security_definer_routines', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'routine_name', routine_name,
      'identity_arguments', identity_arguments,
      'result_type', result_type,
      'function_settings', function_settings,
      'function_acl', function_acl,
      'anon_can_execute', anon_can_execute,
      'authenticated_can_execute', authenticated_can_execute,
      'public_can_execute', public_can_execute,
      'current_shop_helper_present', position(
        'tenant_private.current_shop_id()' IN definition_lower
      ) > 0,
      'is_current_shop_helper_present', position(
        'tenant_private.is_current_shop(' IN definition_lower
      ) > 0,
      'shop_id_text_present', position('shop_id' IN definition_lower) > 0,
      'no_recognized_shop_marker', (
        position('tenant_private.current_shop_id()' IN definition_lower) = 0
        AND position('tenant_private.is_current_shop(' IN definition_lower) = 0
        AND position('shop_id' IN definition_lower) = 0
      )
    ) ORDER BY routine_name, identity_arguments), '[]'::jsonb)
    FROM other_public_routines
  ),
  'other_routines_without_recognized_shop_markers', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'routine_name', routine_name,
      'identity_arguments', identity_arguments,
      'result_type', result_type,
      'function_settings', function_settings,
      'function_acl', function_acl,
      'anon_can_execute', anon_can_execute,
      'authenticated_can_execute', authenticated_can_execute,
      'public_can_execute', public_can_execute,
      'scope_review_required', true,
      'function_definition', function_definition
    ) ORDER BY routine_name, identity_arguments), '[]'::jsonb)
    FROM other_scope_candidates
  )
) AS s5_stock_alert_and_catalog_preflight;
