-- Read-only S6 package 069 metadata/grant check. Returns no shop IDs or PII.
WITH shop_tables AS (
  SELECT relation.oid
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r','p')
    AND relation.relname NOT IN ('shops','shop_provisioning_operations')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
      WHERE inheritance.inhrelid = relation.oid
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = namespace.nspname
        AND column_row.table_name = relation.relname
        AND column_row.column_name = 'shop_id'
    )
),
trigger_state AS (
  SELECT
    (SELECT count(*) FROM shop_tables) AS expected_write_guards,
    (
      SELECT count(*) FROM pg_catalog.pg_trigger AS trigger_row
      WHERE NOT trigger_row.tgisinternal
        AND trigger_row.tgname = 'inactive_shop_write_guard'
        AND trigger_row.tgrelid IN (SELECT oid FROM shop_tables)
    ) AS installed_write_guards,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE NOT tgisinternal AND tgname = 'shop_profile_limit_guard'
        AND tgrelid = 'public.profiles'::regclass
    ) AS profile_limit_guard_present
),
provisioning_state AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.shop_provisioning_operations'::regclass
        AND conname = 'shop_provisioning_operations_status_check'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%auth_creating%'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%compensating%'
    ) AS recovery_states_present,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'shop_provisioning_operations'
        AND column_name = 'auth_email' AND data_type = 'text'
    ) AS auth_email_recovery_field_present
),
checks AS (
  SELECT
    to_regprocedure('public.current_shop_access()') IS NOT NULL AS shop_access_present,
    to_regprocedure('public.current_shop_profile()') IS NOT NULL AS shop_profile_present,
    to_regprocedure('public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)') IS NOT NULL AS shop_control_present,
    to_regprocedure('public.platform_admin_private_note(uuid,uuid,text)') IS NOT NULL AS private_note_present,
    to_regprocedure('public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)') IS NOT NULL AS provisioning_finalizer_present,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'profiles'
        AND policyname = 'profiles_shop_isolation'
    ) AS reviewed_s4_policy_present,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'shops'
        AND column_name = 'admin_limit' AND data_type = 'integer'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'shops'
        AND column_name = 'staff_limit' AND data_type = 'integer'
    ) AS shop_limits_present
)
SELECT jsonb_build_object(
  'stage', 'S6 package 069 aggregate final check',
  'status', CASE
    WHEN checks.shop_access_present AND checks.shop_profile_present
      AND checks.shop_control_present AND checks.private_note_present
      AND checks.provisioning_finalizer_present AND checks.reviewed_s4_policy_present
      AND checks.shop_limits_present
      AND provisioning_state.recovery_states_present
      AND provisioning_state.auth_email_recovery_field_present
      AND trigger_state.profile_limit_guard_present
      AND trigger_state.expected_write_guards > 0
      AND trigger_state.expected_write_guards = trigger_state.installed_write_guards
      AND pg_catalog.has_function_privilege('authenticated','public.current_shop_access()','EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon','public.current_shop_access()','EXECUTE')
      AND pg_catalog.has_function_privilege('authenticated','public.current_shop_profile()','EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon','public.current_shop_profile()','EXECUTE')
      AND pg_catalog.has_function_privilege('service_role','public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)','EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated','public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)','EXECUTE')
      AND pg_catalog.has_function_privilege('service_role','public.platform_admin_private_note(uuid,uuid,text)','EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated','public.platform_admin_private_note(uuid,uuid,text)','EXECUTE')
      AND pg_catalog.has_function_privilege('service_role','public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)','EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated','public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)','EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END,
  'checks', jsonb_build_object(
    'access_and_identity_functions', checks.shop_access_present AND checks.shop_profile_present,
    'platform_shop_and_private_note_functions', checks.shop_control_present AND checks.private_note_present,
    'provisioning_finalizer', checks.provisioning_finalizer_present,
    'shop_limits_present', checks.shop_limits_present,
    'provisioning_recovery_states', provisioning_state.recovery_states_present,
    'auth_email_recovery_field', provisioning_state.auth_email_recovery_field_present,
    'profile_limit_guard', trigger_state.profile_limit_guard_present,
    'shop_write_guards', jsonb_build_object(
      'expected', trigger_state.expected_write_guards,
      'installed', trigger_state.installed_write_guards
    ),
    'reviewed_s4_profile_policy_present', checks.reviewed_s4_policy_present,
    'authenticated_identity_rpc_grants', pg_catalog.has_function_privilege('authenticated','public.current_shop_access()','EXECUTE')
      AND pg_catalog.has_function_privilege('authenticated','public.current_shop_profile()','EXECUTE'),
    'platform_mutation_service_role_only',
      pg_catalog.has_function_privilege('service_role','public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)','EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated','public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)','EXECUTE')
      AND pg_catalog.has_function_privilege('service_role','public.platform_admin_private_note(uuid,uuid,text)','EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated','public.platform_admin_private_note(uuid,uuid,text)','EXECUTE')
      AND pg_catalog.has_function_privilege('service_role','public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)','EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated','public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)','EXECUTE')
  )
)
FROM checks
CROSS JOIN provisioning_state
CROSS JOIN trigger_state;
