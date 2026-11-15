WITH policy_check AS (
  SELECT
    count(*) FILTER (
      WHERE policyname = 'shop_logos_platform_insert'
        AND cmd = 'INSERT'
        AND position('is_platform_admin' IN coalesce(with_check,'')) > 0
    ) AS platform_insert,
    count(*) FILTER (
      WHERE policyname = 'shop_logos_platform_update'
        AND cmd = 'UPDATE'
        AND position('is_platform_admin' IN coalesce(qual,'')) > 0
        AND position('is_platform_admin' IN coalesce(with_check,'')) > 0
    ) AS platform_update,
    count(*) FILTER (
      WHERE policyname = 'shop_logos_platform_delete'
        AND cmd = 'DELETE'
        AND position('is_platform_admin' IN coalesce(qual,'')) > 0
    ) AS platform_delete,
    count(*) FILTER (
      WHERE policyname = 'shop_logos_shop_admin_insert'
        AND cmd = 'INSERT'
        AND position('can_manage_current_shop_logo' IN coalesce(with_check,'')) > 0
    ) AS shop_admin_insert,
    count(*) FILTER (
      WHERE policyname = 'shop_logos_shop_admin_update'
        AND cmd = 'UPDATE'
        AND position('can_manage_current_shop_logo' IN coalesce(qual,'')) > 0
        AND position('can_manage_current_shop_logo' IN coalesce(with_check,'')) > 0
    ) AS shop_admin_update,
    count(*) FILTER (
      WHERE policyname = 'shop_logos_shop_admin_delete'
        AND cmd = 'DELETE'
        AND position('can_manage_current_shop_logo' IN coalesce(qual,'')) > 0
    ) AS shop_admin_delete,
    count(*) FILTER (
      WHERE cmd IN ('INSERT','UPDATE','DELETE','ALL')
        AND (roles @> ARRAY['authenticated']::name[] OR roles @> ARRAY['public']::name[])
    ) AS all_write_policies
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
),
checks AS (
  SELECT
    EXISTS (
      SELECT 1 FROM storage.buckets
      WHERE id = 'shop-logos'
        AND public = true
        AND file_size_limit = 2097152
        AND allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[]
    ) AS bucket_ready,
    to_regclass('public.shop_logo_upload_paths') IS NOT NULL AS upload_path_table_exists,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE NOT trigger_row.tgisinternal
        AND trigger_row.tgname = 'inactive_shop_write_guard'
        AND trigger_row.tgrelid = 'public.shop_logo_upload_paths'::regclass
        AND trigger_row.tgfoid = to_regprocedure('tenant_private.reject_inactive_shop_write()')::oid
        AND trigger_row.tgenabled IN ('O', 'A')
    ) AS shop_logo_path_inactive_write_guard,
    to_regprocedure('public.can_manage_current_shop_logo(text)') IS NOT NULL AS scope_helper_exists,
    to_regprocedure('public.prepare_current_shop_logo_upload(text)') IS NOT NULL AS upload_rpc_exists,
    to_regprocedure('public.update_current_shop_profile(text,text,text,text)') IS NOT NULL AS profile_rpc_exists,
    coalesce(pg_catalog.has_function_privilege(
      'authenticated','public.prepare_current_shop_logo_upload(text)','EXECUTE'
    ),false) AS authenticated_upload_rpc,
    coalesce(pg_catalog.has_function_privilege(
      'authenticated','public.update_current_shop_profile(text,text,text,text)','EXECUTE'
    ),false) AS authenticated_profile_rpc,
    NOT coalesce(pg_catalog.has_function_privilege(
      'anon','public.prepare_current_shop_logo_upload(text)','EXECUTE'
    ),false) AS anon_upload_denied,
    NOT coalesce(pg_catalog.has_function_privilege(
      'anon','public.update_current_shop_profile(text,text,text,text)','EXECUTE'
    ),false) AS anon_profile_denied,
    NOT coalesce(pg_catalog.has_table_privilege(
      'authenticated','public.shop_logo_upload_paths','SELECT'
    ),false) AS upload_paths_hidden
),
result AS (
  SELECT
    checks.*,
    policy_check.platform_insert = 1 AS platform_insert_policy,
    policy_check.platform_update = 1 AS platform_update_policy,
    policy_check.platform_delete = 1 AS platform_delete_policy,
    policy_check.shop_admin_insert = 1 AS shop_admin_insert_policy,
    policy_check.shop_admin_update = 1 AS shop_admin_update_policy,
    policy_check.shop_admin_delete = 1 AS shop_admin_delete_policy,
    policy_check.all_write_policies = 6 AS no_unreviewed_logo_write_policies
  FROM checks
  CROSS JOIN policy_check
)
SELECT jsonb_build_object(
  'stage', 'S6 package 073 Shop Admin profile and logo final check',
  'checks', to_jsonb(result),
  'status', CASE
    WHEN bucket_ready
      AND upload_path_table_exists
      AND shop_logo_path_inactive_write_guard
      AND scope_helper_exists
      AND upload_rpc_exists
      AND profile_rpc_exists
      AND authenticated_upload_rpc
      AND authenticated_profile_rpc
      AND anon_upload_denied
      AND anon_profile_denied
      AND upload_paths_hidden
      AND platform_insert_policy
      AND platform_update_policy
      AND platform_delete_policy
      AND shop_admin_insert_policy
      AND shop_admin_update_policy
      AND shop_admin_delete_policy
      AND no_unreviewed_logo_write_policies
    THEN 'PASS'
    ELSE 'FAIL'
  END
)
FROM result;
