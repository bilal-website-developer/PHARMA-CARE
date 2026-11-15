-- Final metadata and grant check for S6 package 067.
WITH shop_settings_state AS (
  SELECT
    relation.relrowsecurity AS rls_enabled,
    pg_catalog.has_table_privilege('service_role', 'public.shop_settings', 'SELECT')
      AND pg_catalog.has_table_privilege('service_role', 'public.shop_settings', 'INSERT')
      AND pg_catalog.has_table_privilege('service_role', 'public.shop_settings', 'UPDATE')
      AND pg_catalog.has_table_privilege('service_role', 'public.shop_settings', 'DELETE')
      AS service_role_dml,
    NOT (
      pg_catalog.has_table_privilege('anon', 'public.shop_settings', 'SELECT')
      OR pg_catalog.has_table_privilege('anon', 'public.shop_settings', 'INSERT')
      OR pg_catalog.has_table_privilege('anon', 'public.shop_settings', 'UPDATE')
      OR pg_catalog.has_table_privilege('anon', 'public.shop_settings', 'DELETE')
    ) AS anon_dml_revoked,
    NOT (
      pg_catalog.has_table_privilege('authenticated', 'public.shop_settings', 'SELECT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.shop_settings', 'INSERT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.shop_settings', 'UPDATE')
      OR pg_catalog.has_table_privilege('authenticated', 'public.shop_settings', 'DELETE')
    ) AS authenticated_dml_revoked,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shop_settings'
        AND column_name = 'settings'
        AND data_type = 'jsonb'
    ) AS settings_jsonb_present,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shop_settings'
        AND column_name IN ('store_name', 'phone', 'address', 'logo_path')
    ) AS identity_columns_present
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = to_regclass('public.shop_settings')
),
private_notes_state AS (
  SELECT
    relation.relrowsecurity AS rls_enabled,
    pg_catalog.has_table_privilege('service_role', 'public.admin_private_notes', 'SELECT')
      AND pg_catalog.has_table_privilege('service_role', 'public.admin_private_notes', 'INSERT')
      AND pg_catalog.has_table_privilege('service_role', 'public.admin_private_notes', 'UPDATE')
      AND pg_catalog.has_table_privilege('service_role', 'public.admin_private_notes', 'DELETE')
      AS service_role_dml,
    NOT (
      pg_catalog.has_table_privilege('anon', 'public.admin_private_notes', 'SELECT')
      OR pg_catalog.has_table_privilege('anon', 'public.admin_private_notes', 'INSERT')
      OR pg_catalog.has_table_privilege('anon', 'public.admin_private_notes', 'UPDATE')
      OR pg_catalog.has_table_privilege('anon', 'public.admin_private_notes', 'DELETE')
    ) AS anon_dml_revoked,
    NOT (
      pg_catalog.has_table_privilege('authenticated', 'public.admin_private_notes', 'SELECT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.admin_private_notes', 'INSERT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.admin_private_notes', 'UPDATE')
      OR pg_catalog.has_table_privilege('authenticated', 'public.admin_private_notes', 'DELETE')
    ) AS authenticated_dml_revoked,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'admin_private_notes'
        AND column_name = 'admin_profile_id'
        AND data_type = 'uuid'
    ) AS admin_profile_key_present
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = to_regclass('public.admin_private_notes')
),
coverage AS (
  SELECT
    (SELECT count(*) FROM public.shops) AS shop_count,
    (SELECT count(*) FROM public.shop_settings) AS settings_count
)
SELECT jsonb_build_object(
  'stage', 'S6 package 067 settings/private-notes schema final check',
  'status', CASE
    WHEN coalesce((SELECT rls_enabled FROM shop_settings_state), false)
      AND coalesce((SELECT service_role_dml FROM shop_settings_state), false)
      AND coalesce((SELECT anon_dml_revoked FROM shop_settings_state), false)
      AND coalesce((SELECT authenticated_dml_revoked FROM shop_settings_state), false)
      AND coalesce((SELECT settings_jsonb_present FROM shop_settings_state), false)
      AND NOT coalesce((SELECT identity_columns_present FROM shop_settings_state), true)
      AND coalesce((SELECT rls_enabled FROM private_notes_state), false)
      AND coalesce((SELECT service_role_dml FROM private_notes_state), false)
      AND coalesce((SELECT anon_dml_revoked FROM private_notes_state), false)
      AND coalesce((SELECT authenticated_dml_revoked FROM private_notes_state), false)
      AND coalesce((SELECT admin_profile_key_present FROM private_notes_state), false)
      AND (SELECT shop_count = settings_count FROM coverage)
    THEN 'PASS' ELSE 'FAIL' END,
  'shop_settings_rls_enabled', (SELECT rls_enabled FROM shop_settings_state),
  'shop_settings_service_role_dml', (SELECT service_role_dml FROM shop_settings_state),
  'shop_settings_anon_dml_revoked', (SELECT anon_dml_revoked FROM shop_settings_state),
  'shop_settings_authenticated_dml_revoked', (SELECT authenticated_dml_revoked FROM shop_settings_state),
  'shop_settings_settings_jsonb_present', (SELECT settings_jsonb_present FROM shop_settings_state),
  'shop_settings_identity_columns_present', (SELECT identity_columns_present FROM shop_settings_state),
  'private_notes_rls_enabled', (SELECT rls_enabled FROM private_notes_state),
  'private_notes_service_role_dml', (SELECT service_role_dml FROM private_notes_state),
  'private_notes_anon_dml_revoked', (SELECT anon_dml_revoked FROM private_notes_state),
  'private_notes_authenticated_dml_revoked', (SELECT authenticated_dml_revoked FROM private_notes_state),
  'private_notes_admin_profile_key_present', (SELECT admin_profile_key_present FROM private_notes_state),
  'shop_count', (SELECT shop_count FROM coverage),
  'settings_count', (SELECT settings_count FROM coverage)
) AS s6_settings_private_notes_schema_final_check;
