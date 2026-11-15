-- Owner-run rollback for package 073. Preserves the shop-logos bucket,
-- stored image objects, shop profiles, and package 072 Super Admin policies.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.shop_logo_upload_paths') IS NULL
     OR to_regprocedure('public.can_manage_current_shop_logo(text)') IS NULL
     OR to_regprocedure('public.prepare_current_shop_logo_upload(text)') IS NULL
     OR to_regprocedure('public.update_current_shop_profile(text,text,text,text)') IS NULL
     OR (
       SELECT count(*) FROM pg_catalog.pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname IN (
           'shop_logos_shop_admin_insert',
           'shop_logos_shop_admin_update',
           'shop_logos_shop_admin_delete'
         )
     ) <> 3 THEN
    RAISE EXCEPTION 'Package 073 is incomplete; inspect before rollback.';
  END IF;
  IF (
    SELECT count(*) FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
        'shop_logos_platform_insert',
        'shop_logos_platform_update',
        'shop_logos_platform_delete'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Package 072 platform logo policies must remain installed.';
  END IF;
END
$preflight$;

DROP POLICY shop_logos_shop_admin_insert ON storage.objects;
DROP POLICY shop_logos_shop_admin_update ON storage.objects;
DROP POLICY shop_logos_shop_admin_delete ON storage.objects;

REVOKE ALL ON FUNCTION public.can_manage_current_shop_logo(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_current_shop_logo_upload(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_current_shop_profile(text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.can_manage_current_shop_logo(text);
DROP FUNCTION public.prepare_current_shop_logo_upload(text);
DROP FUNCTION public.update_current_shop_profile(text,text,text,text);
DROP TABLE public.shop_logo_upload_paths;

COMMIT;
