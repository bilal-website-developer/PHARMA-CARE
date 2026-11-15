-- Read-only smoke check for S6 package 066.
DO $smoke$
DECLARE
  v_status_definition text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO v_status_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.shops'::regclass
    AND constraint_row.conname = 'shops_status_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;

  IF v_status_definition IS NULL
     OR position('active' IN lower(v_status_definition)) = 0
     OR position('suspended' IN lower(v_status_definition)) = 0
     OR position('provisioning' IN lower(v_status_definition)) = 0
     OR position('deleted' IN lower(v_status_definition)) = 0 THEN
    RAISE EXCEPTION 'Shop lifecycle status constraint is missing an expected value.';
  END IF;

  IF to_regclass('public.shop_provisioning_operations') IS NULL
     OR NOT (
       SELECT relation.relrowsecurity
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = 'public.shop_provisioning_operations'::regclass
     )
     OR pg_catalog.has_table_privilege('anon', 'public.shop_provisioning_operations', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.shop_provisioning_operations', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.shop_provisioning_operations', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.shop_provisioning_operations', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_provisioning_operations', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_provisioning_operations', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_provisioning_operations', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_provisioning_operations', 'DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.shop_provisioning_operations', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.shop_provisioning_operations', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.shop_provisioning_operations', 'UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.shop_provisioning_operations', 'DELETE') THEN
    RAISE EXCEPTION 'Provisioning ledger RLS or grants differ from package 066.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shops'
      AND column_name = 'created_by'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'shops.created_by is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shop_provisioning_operations'
      AND column_name = 'requested_by'
      AND data_type = 'uuid'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'A required provisioning actor column is missing.';
  END IF;
END
$smoke$;

SELECT jsonb_build_object(
  'stage', 'S6 package 066 shop provisioning schema smoke test',
  'status', 'PASS',
  'read_only', true,
  'shop_statuses', ARRAY['active', 'suspended', 'provisioning', 'deleted'],
  'provisioning_ledger_rls_enabled', true,
  'ledger_client_privileges_revoked', true,
  'ledger_service_role_dml', true
) AS s6_shop_provisioning_schema_smoke;
