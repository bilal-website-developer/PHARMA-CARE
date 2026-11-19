-- Read-only preflight for 202611190001_admin_settings_controls.sql.
WITH prerequisites AS (
  SELECT
    to_regclass('public.shop_settings') IS NOT NULL AS shop_settings,
    to_regclass('public.shop_receipt_qr_settings') IS NOT NULL AS receipt_qr_settings,
    to_regclass('public.sale_receipt_links') IS NOT NULL AS receipt_links,
    to_regclass('public.shop_logo_upload_paths') IS NOT NULL AS shop_logo_paths,
    to_regclass('public.audit_logs') IS NOT NULL AS audit_logs,
    to_regprocedure('public.update_current_shop_settings(jsonb)') IS NOT NULL AS scoped_settings_rpc,
    to_regprocedure('public.update_current_shop_profile(text,text,text,text)') IS NOT NULL AS shop_profile_rpc,
    to_regprocedure('public.can_manage_current_shop_logo(text)') IS NOT NULL AS logo_guard,
    to_regprocedure('public.prepare_current_shop_logo_upload(text)') IS NOT NULL AS logo_upload_rpc,
    to_regprocedure('public.has_any_permission(text[])') IS NOT NULL AS permission_helper,
    to_regprocedure('tenant_private.current_shop_id()') IS NOT NULL AS tenant_helper,
    to_regprocedure('public.is_platform_admin()') IS NOT NULL AS platform_helper,
    to_regprocedure('public.update_current_shop_settings_v2(jsonb)') IS NULL AS v2_not_installed,
    to_regprocedure('public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb)') IS NULL AS platform_update_not_installed
)
SELECT 'prerequisites' AS check_name,
       CASE WHEN shop_settings AND receipt_qr_settings AND receipt_links AND shop_logo_paths
                  AND audit_logs AND scoped_settings_rpc AND shop_profile_rpc AND logo_guard
                  AND logo_upload_rpc AND permission_helper AND tenant_helper AND platform_helper
                  AND v2_not_installed AND platform_update_not_installed
            THEN 'READY' ELSE 'STOP' END AS result,
       pg_catalog.to_jsonb(prerequisites) AS details
FROM prerequisites
UNION ALL
SELECT 'permission_constraint',
       CASE WHEN count(*) = 1
                  AND coalesce(bool_and(constraint_row.convalidated), false)
                  AND coalesce(bool_and(
                    pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''pos''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''products''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''categories''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''suppliers''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''customers''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''sales_history''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''purchase_history''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''purchases''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''expenses''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''stock_inventory''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''reports''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''manage_users''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''settings''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''pos_print_sale''%'
                    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''pos_print_payment''%'
                  ), false)
            THEN 'READY' ELSE 'STOP' END,
       pg_catalog.jsonb_build_object(
         'matching_constraints', count(*),
         'validated_constraints', count(*) FILTER (WHERE constraint_row.convalidated),
         'existing_s6_permission_keys_present',
           coalesce(bool_and(
             pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''pos''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''products''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''categories''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''suppliers''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''customers''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''sales_history''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''purchase_history''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''purchases''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''expenses''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''stock_inventory''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''reports''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''manage_users''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''settings''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''pos_print_sale''%'
             AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''pos_print_payment''%'
           ), false)
       )
FROM pg_catalog.pg_constraint AS constraint_row
WHERE constraint_row.conrelid = 'public.profiles'::regclass
  AND constraint_row.conname = 'profiles_permissions_valid'
  AND constraint_row.contype = 'c'
UNION ALL
SELECT 'shop_settings_rows',
       CASE WHEN count(*) = (SELECT count(*) FROM public.shops) THEN 'READY' ELSE 'STOP' END,
       pg_catalog.jsonb_build_object(
         'settings_rows', count(*),
         'shops', (SELECT count(*) FROM public.shops)
       )
FROM public.shop_settings
UNION ALL
SELECT 'admin_backfill',
       'READY',
       pg_catalog.jsonb_build_object(
         'admins_with_settings_access', count(*) FILTER (
           WHERE profile.permissions @> ARRAY['settings']::text[]
         ),
         'admins_to_receive_section_grants', count(*) FILTER (
           WHERE profile.permissions @> ARRAY['settings']::text[]
             AND NOT profile.permissions @> ARRAY['settings_shop_profile']::text[]
         )
       )
FROM public.profiles AS profile
WHERE profile.role = 'admin'
UNION ALL
SELECT 'existing_memo_visibility',
       CASE WHEN count(*) FILTER (
         WHERE pg_catalog.jsonb_typeof(settings.settings #> '{memo,showBatchExpiry}') <> 'boolean'
       ) = 0 THEN 'READY' ELSE 'STOP' END,
       pg_catalog.jsonb_build_object(
         'settings_rows', count(*),
         'invalid_legacy_flags', count(*) FILTER (
           WHERE pg_catalog.jsonb_typeof(settings.settings #> '{memo,showBatchExpiry}') <> 'boolean'
         )
       )
FROM public.shop_settings AS settings;
