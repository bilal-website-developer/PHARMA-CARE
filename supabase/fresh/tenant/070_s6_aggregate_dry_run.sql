-- Read-only S6 gate for package 069. Returns no shop IDs, profile data, or PII.
WITH state AS (
  SELECT
    to_regclass('public.shops') IS NOT NULL AS shops_present,
    to_regclass('public.profiles') IS NOT NULL AS profiles_present,
    to_regclass('public.shop_settings') IS NOT NULL AS settings_present,
    to_regclass('public.admin_private_notes') IS NOT NULL AS private_notes_present,
    to_regclass('public.shop_provisioning_operations') IS NOT NULL AS provisioning_ledger_present,
    to_regclass('public.return_policy_settings') IS NOT NULL AS return_policy_present,
    to_regclass('public.audit_logs') IS NOT NULL AS audit_logs_present,
    to_regprocedure('tenant_private.current_shop_id()') IS NOT NULL AS shop_helper_present,
    to_regprocedure('public.is_platform_admin()') IS NOT NULL AS platform_helper_present,
    to_regprocedure('public.manage_users_profile_update(uuid,uuid,text,text,text,text,text[],boolean,uuid)')
      IS NOT NULL AS guarded_profile_update_present,
    to_regprocedure('public.current_shop_settings()') IS NOT NULL AS settings_reader_present,
    to_regprocedure('public.update_current_shop_settings(jsonb)') IS NOT NULL AS settings_writer_present,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'profiles'
        AND policyname = 'profiles_shop_isolation'
    ) AS reviewed_profile_policy_present,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'shops'
        AND column_name = 'logo_path' AND data_type = 'text'
    ) AS shop_logo_column_present,
    to_regprocedure('public.current_shop_access()') IS NOT NULL
      OR to_regprocedure('public.current_shop_profile()') IS NOT NULL
      OR to_regprocedure('public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)') IS NOT NULL
      OR to_regprocedure('public.platform_admin_private_note(uuid,uuid,text)') IS NOT NULL
      OR to_regprocedure('public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)') IS NOT NULL
      AS package_069_already_present
)
SELECT jsonb_build_object(
  'stage', 'S6 package 069 aggregate dry run',
  'status', CASE
    WHEN shops_present AND profiles_present AND settings_present
      AND private_notes_present AND provisioning_ledger_present
      AND return_policy_present AND audit_logs_present
      AND shop_helper_present AND platform_helper_present
      AND guarded_profile_update_present AND settings_reader_present AND settings_writer_present
      AND reviewed_profile_policy_present AND shop_logo_column_present
      AND NOT package_069_already_present
    THEN 'READY' ELSE 'STOP' END,
  'checks', jsonb_build_object(
    'shops_present', shops_present,
    'profiles_present', profiles_present,
    'shop_settings_present', settings_present,
    'private_notes_present', private_notes_present,
    'provisioning_ledger_present', provisioning_ledger_present,
    'return_policy_settings_present', return_policy_present,
    'audit_logs_present', audit_logs_present,
    'current_shop_helper_present', shop_helper_present,
    'platform_admin_helper_present', platform_helper_present,
    'package_064_profile_guard_present', guarded_profile_update_present,
    'package_068_settings_functions_present', settings_reader_present AND settings_writer_present,
    'reviewed_s4_profile_policy_present', reviewed_profile_policy_present,
    'shop_logo_column_present', shop_logo_column_present,
    'package_069_absent', NOT package_069_already_present
  )
)
FROM state;
