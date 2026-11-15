WITH bucket_check AS (
  SELECT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'shop-logos'
      AND public = true
      AND file_size_limit = 2097152
      AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ) AS bucket_ready
),
policy_check AS (
  SELECT
    count(*) FILTER (WHERE policyname = 'shop_logos_platform_insert' AND cmd = 'INSERT'
      AND roles @> ARRAY['authenticated']::name[]
      AND position('is_platform_admin' IN coalesce(with_check, '')) > 0
      AND position('shop-logos' IN coalesce(with_check, '')) > 0) AS insert_policy,
    count(*) FILTER (WHERE policyname = 'shop_logos_platform_update' AND cmd = 'UPDATE'
      AND roles @> ARRAY['authenticated']::name[]
      AND position('is_platform_admin' IN coalesce(qual, '')) > 0
      AND position('shop-logos' IN coalesce(qual, '')) > 0
      AND position('is_platform_admin' IN coalesce(with_check, '')) > 0
      AND position('shop-logos' IN coalesce(with_check, '')) > 0) AS update_policy,
    count(*) FILTER (WHERE policyname = 'shop_logos_platform_delete' AND cmd = 'DELETE'
      AND roles @> ARRAY['authenticated']::name[]
      AND position('is_platform_admin' IN coalesce(qual, '')) > 0
      AND position('shop-logos' IN coalesce(qual, '')) > 0) AS delete_policy
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
),
conflicting_write_policy_check AS (
  SELECT count(*) AS conflicting_write_policies
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND (
      roles @> ARRAY['authenticated']::name[]
      OR roles @> ARRAY['public']::name[]
    )
    AND policyname NOT IN (
      'shop_logos_platform_insert',
      'shop_logos_platform_update',
      'shop_logos_platform_delete'
    )
)
SELECT jsonb_build_object(
  'stage', 'S6 package 072 shop logo storage final check',
  'checks', jsonb_build_object(
    'public_logo_bucket', bucket_ready,
    'super_admin_only_insert', insert_policy = 1,
    'super_admin_only_update', update_policy = 1,
    'super_admin_only_delete', delete_policy = 1,
    'no_conflicting_write_policies', conflicting_write_policies = 0
  ),
  'status', CASE
    WHEN bucket_ready AND insert_policy = 1 AND update_policy = 1 AND delete_policy = 1
      AND conflicting_write_policies = 0 THEN 'PASS'
    ELSE 'FAIL'
  END
)
FROM bucket_check, policy_check, conflicting_write_policy_check;
