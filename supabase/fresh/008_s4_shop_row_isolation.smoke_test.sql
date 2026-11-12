-- Read-only S4 stage-1 check. A passing result verifies policy metadata and
-- shop-ID concealment; it does not replace two-shop/API negative tests.
WITH expected_tables(table_name) AS (
  VALUES
    ('profiles'),
    ('audit_logs'),
    ('brands'),
    ('categories'),
    ('customers'),
    ('khata_entries'),
    ('medicine_units'),
    ('medicines'),
    ('print_requests'),
    ('purchase_items'),
    ('purchase_number_state'),
    ('purchases'),
    ('return_policy_settings'),
    ('sale_item_batch_allocations'),
    ('sale_items'),
    ('sale_payments'),
    ('sale_return_items'),
    ('sale_returns'),
    ('sales'),
    ('stock_batches'),
    ('stock_movements'),
    ('supplier_ledger'),
    ('suppliers'),
    ('trash_bin_events')
),
table_checks AS (
  SELECT
    expected.table_name,
    relation.relrowsecurity AS rls_enabled,
    policy.polname IS NOT NULL
      AND NOT policy.polpermissive
      AND policy.polcmd = '*'
      AND policy.polroles = ARRAY[(
        SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
      )] AS isolation_policy_correct,
    NOT has_column_privilege(
      'authenticated',
      format('public.%I', expected.table_name),
      'shop_id',
      'SELECT'
    ) AND NOT has_column_privilege(
      'anon',
      format('public.%I', expected.table_name),
      'shop_id',
      'SELECT'
    ) AS shop_id_hidden
  FROM expected_tables AS expected
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.oid = to_regclass(format('public.%I', expected.table_name))
  LEFT JOIN pg_catalog.pg_policy AS policy
    ON policy.polrelid = relation.oid
   AND policy.polname = expected.table_name || '_shop_isolation'
),
checks AS (
  SELECT
    count(*) = 24 AS expected_table_count,
    coalesce(bool_and(rls_enabled), false) AS all_tables_rls_enabled,
    coalesce(bool_and(isolation_policy_correct), false) AS all_isolation_policies_correct,
    coalesce(bool_and(shop_id_hidden), false) AS shop_id_hidden_from_api_roles,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy
      WHERE polrelid = to_regclass('public.profiles')
        AND polname = 'profiles_shop_isolation'
        AND NOT polpermissive
        AND polcmd = '*'
        AND position('super_admin' IN coalesce(pg_catalog.pg_get_expr(polqual, polrelid), '')) > 0
        AND position('auth.uid()' IN coalesce(pg_catalog.pg_get_expr(polqual, polrelid), '')) > 0
        AND position('super_admin' IN coalesce(pg_catalog.pg_get_expr(polwithcheck, polrelid), '')) > 0
        AND position('auth.uid()' IN coalesce(pg_catalog.pg_get_expr(polwithcheck, polrelid), '')) > 0
    ) AS super_admin_own_profile_preserved,
    NOT EXISTS (
      SELECT 1
      FROM (VALUES ('audit_logs'), ('trash_bin_events')) AS platform_tables(table_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = to_regclass(format('public.%I', platform_tables.table_name))
          AND policy.polname = platform_tables.table_name || '_shop_isolation'
          AND position('tenant_private.is_current_shop' IN coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')) > 0
          AND position('shop_id' IN coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')) > 0
          AND position('actor_id' IN coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')) > 0
          AND position('super_admin' IN coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')) > 0
          AND position('auth.uid()' IN coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')) > 0
          AND position('tenant_private.is_current_shop' IN coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')) > 0
          AND position('shop_id' IN coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')) > 0
          AND position('actor_id' IN coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')) > 0
          AND position('super_admin' IN coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')) > 0
          AND position('auth.uid()' IN coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')) > 0
      )
    ) AS platform_actor_events_scoped,
    NOT has_function_privilege(
      'authenticated',
      'tenant_private.current_shop_id()',
      'EXECUTE'
    ) AND has_function_privilege(
      'authenticated',
      'tenant_private.is_current_shop(uuid)',
      'EXECUTE'
    ) AS non_disclosing_helper_grants_correct,
    NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relname NOT IN ('shops', 'user_favorites', 'user_sidebar_preferences')
        AND relation.relname NOT IN (SELECT table_name FROM expected_tables)
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('v', 'm')
    ) AS no_unreviewed_public_relations
  FROM table_checks
)
SELECT jsonb_build_object(
  'checks', to_jsonb(checks),
  'all_passed', checks.expected_table_count
    AND checks.all_tables_rls_enabled
    AND checks.all_isolation_policies_correct
    AND checks.shop_id_hidden_from_api_roles
    AND checks.super_admin_own_profile_preserved
    AND checks.platform_actor_events_scoped
    AND checks.non_disclosing_helper_grants_correct
    AND checks.no_unreviewed_public_relations
) AS s4_row_isolation_smoke_test
FROM checks;
