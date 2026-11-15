-- Owner-run setup for public shop-logo images with Super Admin-only writes.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.is_platform_admin()') IS NULL THEN
    RAISE EXCEPTION 'S6 package 062 public.is_platform_admin() is required.';
  END IF;
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage tables are required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = relation.relnamespace
    WHERE nsp.nspname = 'storage'
      AND relation.relname = 'objects'
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Row-level security must be enabled on storage.objects.';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'shop-logos') THEN
    RAISE EXCEPTION 'The shop-logos bucket already exists; inspect it before applying this package.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
        'shop_logos_platform_insert',
        'shop_logos_platform_update',
        'shop_logos_platform_delete'
      )
  ) THEN
    RAISE EXCEPTION 'A shop-logo storage policy already exists; inspect it before applying this package.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (
        roles @> ARRAY['authenticated']::name[]
        OR roles @> ARRAY['public']::name[]
      )
  ) THEN
    RAISE EXCEPTION 'Existing authenticated or public Storage write policies must be reviewed before applying package 072.';
  END IF;
END;
$preflight$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shop-logos',
  'shop-logos',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
);

CREATE POLICY shop_logos_platform_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'shop-logos'
  AND public.is_platform_admin()
);

CREATE POLICY shop_logos_platform_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'shop-logos'
  AND public.is_platform_admin()
)
WITH CHECK (
  bucket_id = 'shop-logos'
  AND public.is_platform_admin()
);

CREATE POLICY shop_logos_platform_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'shop-logos'
  AND public.is_platform_admin()
);

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'shop-logos'
      AND public = true
      AND file_size_limit = 2097152
      AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
        'shop_logos_platform_insert',
        'shop_logos_platform_update',
        'shop_logos_platform_delete'
      )
  ) <> 3 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
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
  ) THEN
    RAISE EXCEPTION 'S6 shop-logo bucket or Super Admin write policies failed postflight.';
  END IF;
END;
$postflight$;

COMMIT;
