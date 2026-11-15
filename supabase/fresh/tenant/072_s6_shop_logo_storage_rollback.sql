-- Owner-run rollback; refuses to remove the bucket while any logo objects remain.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage tables are required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'shop-logos')
     OR (
       SELECT count(*) FROM pg_catalog.pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname IN (
           'shop_logos_platform_insert',
           'shop_logos_platform_update',
           'shop_logos_platform_delete'
         )
     ) <> 3 THEN
    RAISE EXCEPTION 'Package 072 bucket or policy state is incomplete; inspect before rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'shop-logos') THEN
    RAISE EXCEPTION 'Remove or preserve shop logo objects before rolling back package 072.';
  END IF;
END;
$preflight$;

DROP POLICY IF EXISTS shop_logos_platform_insert ON storage.objects;
DROP POLICY IF EXISTS shop_logos_platform_update ON storage.objects;
DROP POLICY IF EXISTS shop_logos_platform_delete ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'shop-logos';

COMMIT;
