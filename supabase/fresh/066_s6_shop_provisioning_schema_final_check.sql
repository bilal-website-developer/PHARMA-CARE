-- Final metadata and grant check for S6 package 066.
WITH shop_status AS (
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid) AS definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.shops'::regclass
    AND constraint_row.conname = 'shops_status_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated
),
ledger AS (
  SELECT
    relation.relrowsecurity AS rls_enabled,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shop_provisioning_operations'
        AND column_name = 'operation_id'
        AND data_type = 'uuid'
    ) AS operation_id_present,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shop_provisioning_operations'
        AND column_name = 'request_fingerprint'
        AND data_type = 'text'
    ) AS fingerprint_present,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shop_provisioning_operations'
        AND column_name = 'requested_by'
        AND data_type = 'uuid'
        AND is_nullable = 'NO'
    ) AS requested_by_present,
    (
      pg_catalog.has_table_privilege('service_role', 'public.shop_provisioning_operations', 'SELECT')
      AND pg_catalog.has_table_privilege('service_role', 'public.shop_provisioning_operations', 'INSERT')
      AND pg_catalog.has_table_privilege('service_role', 'public.shop_provisioning_operations', 'UPDATE')
      AND pg_catalog.has_table_privilege('service_role', 'public.shop_provisioning_operations', 'DELETE')
    ) AS service_role_dml,
    NOT (
      pg_catalog.has_table_privilege('anon', 'public.shop_provisioning_operations', 'SELECT')
      OR pg_catalog.has_table_privilege('anon', 'public.shop_provisioning_operations', 'INSERT')
      OR pg_catalog.has_table_privilege('anon', 'public.shop_provisioning_operations', 'UPDATE')
      OR pg_catalog.has_table_privilege('anon', 'public.shop_provisioning_operations', 'DELETE')
    ) AS anon_dml_revoked,
    NOT (
      pg_catalog.has_table_privilege('authenticated', 'public.shop_provisioning_operations', 'SELECT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.shop_provisioning_operations', 'INSERT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.shop_provisioning_operations', 'UPDATE')
      OR pg_catalog.has_table_privilege('authenticated', 'public.shop_provisioning_operations', 'DELETE')
    ) AS authenticated_dml_revoked
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = to_regclass('public.shop_provisioning_operations')
),
shop_creator AS (
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shops'
      AND column_name = 'created_by'
      AND data_type = 'uuid'
  ) AS created_by_present
)
SELECT jsonb_build_object(
  'stage', 'S6 package 066 shop provisioning schema final check',
  'status', CASE
    WHEN (SELECT definition FROM shop_status) LIKE '%active%'
      AND (SELECT definition FROM shop_status) LIKE '%suspended%'
      AND (SELECT definition FROM shop_status) LIKE '%provisioning%'
      AND (SELECT definition FROM shop_status) LIKE '%deleted%'
      AND coalesce((SELECT rls_enabled FROM ledger), false)
      AND coalesce((SELECT operation_id_present FROM ledger), false)
      AND coalesce((SELECT fingerprint_present FROM ledger), false)
      AND coalesce((SELECT requested_by_present FROM ledger), false)
      AND coalesce((SELECT service_role_dml FROM ledger), false)
      AND coalesce((SELECT anon_dml_revoked FROM ledger), false)
      AND coalesce((SELECT authenticated_dml_revoked FROM ledger), false)
      AND coalesce((SELECT created_by_present FROM shop_creator), false)
    THEN 'PASS' ELSE 'FAIL' END,
  'shop_status_constraint', (SELECT definition FROM shop_status),
  'ledger_rls_enabled', (SELECT rls_enabled FROM ledger),
  'ledger_operation_id_present', (SELECT operation_id_present FROM ledger),
  'ledger_fingerprint_present', (SELECT fingerprint_present FROM ledger),
  'ledger_requested_by_present', (SELECT requested_by_present FROM ledger),
  'ledger_service_role_dml', (SELECT service_role_dml FROM ledger),
  'ledger_anon_dml_revoked', (SELECT anon_dml_revoked FROM ledger),
  'ledger_authenticated_dml_revoked', (SELECT authenticated_dml_revoked FROM ledger),
  'shops_created_by_present', (SELECT created_by_present FROM shop_creator)
) AS s6_shop_provisioning_schema_final_check;
