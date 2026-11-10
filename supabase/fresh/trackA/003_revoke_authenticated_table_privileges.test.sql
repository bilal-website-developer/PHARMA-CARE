WITH targets AS (
  SELECT
    ARRAY[
      'profiles', 'customers', 'suppliers', 'medicines', 'medicine_units',
      'purchases', 'stock_batches', 'sales', 'sale_items',
      'sale_item_batch_allocations', 'sale_payments', 'purchase_items',
      'stock_movements', 'khata_entries', 'categories', 'brands', 'audit_logs',
      'print_requests', 'purchase_number_state', 'supplier_ledger',
      'trash_bin_events', 'return_policy_settings', 'sale_returns',
      'sale_return_items'
    ]::text[] AS write_locked_tables,
    ARRAY[
      'stock_batches', 'purchases', 'purchase_items', 'sale_items',
      'sale_item_batch_allocations'
    ]::text[] AS cost_tables,
    ARRAY[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]::text[] AS write_privileges,
    ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
      'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]::text[] AS all_table_privileges
),
checks AS (
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM targets t
      CROSS JOIN LATERAL unnest(t.write_locked_tables) AS locked(table_name)
      CROSS JOIN LATERAL unnest(t.write_privileges) AS allowed(privilege)
      WHERE has_table_privilege(
        'authenticated',
        format('public.%I', locked.table_name),
        allowed.privilege
      )
    ) AS authenticated_business_writes_revoked,
    NOT EXISTS (
      SELECT 1
      FROM targets t
      CROSS JOIN LATERAL unnest(t.cost_tables) AS cost_table(table_name)
      CROSS JOIN LATERAL unnest(t.all_table_privileges) AS all_privilege(privilege)
      CROSS JOIN LATERAL (VALUES ('anon'), ('authenticated')) AS role_name(role_name)
      WHERE has_table_privilege(
        role_name.role_name,
        format('public.%I', cost_table.table_name),
        all_privilege.privilege
      )
    ) AS cost_table_access_revoked,
    NOT has_sequence_privilege(
      'authenticated',
      'public.medicine_barcode_seq',
      'SELECT'
    )
    AND NOT has_sequence_privilege(
      'authenticated',
      'public.medicine_barcode_seq',
      'UPDATE'
    )
    AND NOT has_sequence_privilege(
      'authenticated',
      'public.medicine_barcode_seq',
      'USAGE'
    )
    AND NOT has_sequence_privilege(
      'anon',
      'public.medicine_barcode_seq',
      'SELECT'
    )
    AND NOT has_sequence_privilege(
      'anon',
      'public.medicine_barcode_seq',
      'UPDATE'
    )
    AND NOT has_sequence_privilege(
      'anon',
      'public.medicine_barcode_seq',
      'USAGE'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('S', c.relowner))
      ) acl
      WHERE n.nspname = 'public'
        AND c.relname = 'medicine_barcode_seq'
        AND c.relkind = 'S'
        AND acl.grantee = 0
    ) AS barcode_sequence_access_revoked,
    has_table_privilege('authenticated', 'public.profiles', 'SELECT')
      AND has_table_privilege('authenticated', 'public.suppliers', 'SELECT')
      AS profile_supplier_read_preserved,
    has_table_privilege('authenticated', 'public.user_favorites', 'SELECT')
      AND has_table_privilege('authenticated', 'public.user_favorites', 'INSERT')
      AND has_table_privilege('authenticated', 'public.user_favorites', 'UPDATE')
      AND has_table_privilege('authenticated', 'public.user_favorites', 'DELETE')
      AND has_table_privilege('authenticated', 'public.user_sidebar_preferences', 'SELECT')
      AND has_table_privilege('authenticated', 'public.user_sidebar_preferences', 'INSERT')
      AND has_table_privilege('authenticated', 'public.user_sidebar_preferences', 'UPDATE')
      AND has_table_privilege('authenticated', 'public.user_sidebar_preferences', 'DELETE')
      AS own_preference_crud_preserved
)
SELECT jsonb_build_object(
  'checks', jsonb_build_object(
    'authenticated_business_writes_revoked',
      authenticated_business_writes_revoked,
    'cost_table_access_revoked',
      cost_table_access_revoked,
    'barcode_sequence_access_revoked',
      barcode_sequence_access_revoked,
    'profile_supplier_read_preserved',
      profile_supplier_read_preserved,
    'own_preference_crud_preserved',
      own_preference_crud_preserved
  ),
  'all_passed',
    authenticated_business_writes_revoked
    AND cost_table_access_revoked
    AND barcode_sequence_access_revoked
    AND profile_supplier_read_preserved
    AND own_preference_crud_preserved
)::text AS s2_table_privilege_test
FROM checks;
