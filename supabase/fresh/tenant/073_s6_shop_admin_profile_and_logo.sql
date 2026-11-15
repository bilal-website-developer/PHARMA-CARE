-- S6 package 073: tenant-scoped Shop Admin profile editing and logo writes.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $preflight$
BEGIN
  IF to_regclass('public.shops') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('storage.objects') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL
     OR to_regprocedure('public.current_shop_profile()') IS NULL
     OR to_regprocedure('public.is_platform_admin()') IS NULL
     OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'S6 packages 062, 069, and 072 must be present before package 073.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'shop-logos' AND public = true
      AND file_size_limit = 2097152
      AND allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[]
  ) THEN
    RAISE EXCEPTION 'The reviewed public shop-logos bucket is not ready.';
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
    RAISE EXCEPTION 'Package 072 platform logo policies are incomplete; inspect before continuing.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
      AND (roles @> ARRAY['authenticated']::name[] OR roles @> ARRAY['public']::name[])
      AND policyname NOT IN (
        'shop_logos_platform_insert',
        'shop_logos_platform_update',
        'shop_logos_platform_delete'
      )
  ) THEN
    RAISE EXCEPTION 'Unreviewed authenticated/public Storage write policies exist; inspect before applying package 073.';
  END IF;
  IF to_regclass('public.shop_logo_upload_paths') IS NOT NULL
     OR to_regprocedure('public.can_manage_current_shop_logo(text)') IS NOT NULL
     OR to_regprocedure('public.prepare_current_shop_logo_upload(text)') IS NOT NULL
     OR to_regprocedure('public.update_current_shop_profile(text,text,text,text)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname IN (
           'shop_logos_shop_admin_insert',
           'shop_logos_shop_admin_update',
           'shop_logos_shop_admin_delete'
         )
     ) THEN
    RAISE EXCEPTION 'Package 073 objects already exist; inspect before applying.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage'
      AND relation.relname = 'objects'
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS must be enabled on storage.objects.';
  END IF;
END
$preflight$;

CREATE TABLE public.shop_logo_upload_paths (
  object_name text PRIMARY KEY
    CHECK (object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE public.shop_logo_upload_paths ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_logo_upload_paths FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER inactive_shop_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.shop_logo_upload_paths
FOR EACH ROW EXECUTE FUNCTION tenant_private.reject_inactive_shop_write();

INSERT INTO public.shop_logo_upload_paths (object_name, shop_id)
SELECT matched.path, shop.id
FROM public.shops AS shop
CROSS JOIN LATERAL (
  SELECT (pg_catalog.regexp_match(
    shop.logo_path,
    '/storage/v1/object/public/shop-logos/([^?#]+)$'
  ))[1] AS path
) AS matched
JOIN storage.objects AS object
  ON object.bucket_id = 'shop-logos'
  AND object.name = matched.path
WHERE shop.logo_path IS NOT NULL
  AND matched.path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
ON CONFLICT (object_name) DO NOTHING;

CREATE FUNCTION public.can_manage_current_shop_logo(p_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, tenant_private
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND tenant_private.current_shop_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
        AND profile.deleted_at IS NULL
        AND profile.shop_id = tenant_private.current_shop_id()
        AND public.has_any_permission(ARRAY['settings']::text[])
    )
    AND EXISTS (
      SELECT 1
      FROM public.shop_logo_upload_paths AS upload_path
      WHERE upload_path.object_name = p_object_name
        AND upload_path.shop_id = tenant_private.current_shop_id()
    );
$function$;

CREATE FUNCTION public.prepare_current_shop_logo_upload(p_extension text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, tenant_private
AS $function$
DECLARE
  v_shop_id uuid;
  v_object_name text;
BEGIN
  IF auth.uid() IS NULL
     OR p_extension IS NULL
     OR p_extension NOT IN ('png','jpg','webp') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Choose a supported shop logo format.';
  END IF;

  SELECT profile.shop_id INTO v_shop_id
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.role = 'admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND profile.shop_id = tenant_private.current_shop_id()
    AND public.has_any_permission(ARRAY['settings']::text[]);
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active Shop Admin with Settings access is required.';
  END IF;

  v_object_name := auth.uid()::text || '/' || pg_catalog.gen_random_uuid()::text || '.' || p_extension;
  INSERT INTO public.shop_logo_upload_paths (object_name, shop_id, created_by)
  VALUES (v_object_name, v_shop_id, auth.uid());
  RETURN v_object_name;
END
$function$;

CREATE FUNCTION public.update_current_shop_profile(
  p_name text,
  p_phone text,
  p_address text,
  p_logo_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, tenant_private, storage
AS $function$
DECLARE
  v_shop_id uuid;
  v_current_name text;
  v_current_phone text;
  v_current_address text;
  v_current_logo_path text;
  v_new_logo_path text := nullif(pg_catalog.btrim(p_logo_path), '');
  v_object_name text;
  v_match text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An authenticated Shop Admin is required.';
  END IF;

  SELECT profile.shop_id INTO v_shop_id
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.role = 'admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND profile.shop_id = tenant_private.current_shop_id()
    AND public.has_any_permission(ARRAY['settings']::text[]);
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active Shop Admin with Settings access is required.';
  END IF;
  IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 120
     OR pg_catalog.length(coalesce(p_phone, '')) > 40
     OR pg_catalog.length(coalesce(p_address, '')) > 240 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Shop name, phone, or address is invalid.';
  END IF;

  SELECT shop.name, shop.phone, shop.address, shop.logo_path
    INTO v_current_name, v_current_phone, v_current_address, v_current_logo_path
  FROM public.shops AS shop
  WHERE shop.id = v_shop_id AND shop.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'The current shop is not active.';
  END IF;

  IF v_new_logo_path IS NOT NULL AND v_new_logo_path IS DISTINCT FROM v_current_logo_path THEN
    v_match := pg_catalog.regexp_match(
      v_new_logo_path,
      '/storage/v1/object/public/shop-logos/([^?#]+)$'
    );
    v_object_name := v_match[1];
    IF v_object_name IS NULL
       OR v_object_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
       OR NOT EXISTS (
         SELECT 1
         FROM public.shop_logo_upload_paths AS upload_path
         JOIN storage.objects AS object
           ON object.bucket_id = 'shop-logos'
          AND object.name = upload_path.object_name
         WHERE upload_path.object_name = v_object_name
           AND upload_path.shop_id = v_shop_id
           AND upload_path.created_by = auth.uid()
       ) THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'Upload the new logo for this shop before saving it.';
    END IF;
  END IF;

  IF v_current_logo_path IS NOT NULL AND v_current_logo_path IS DISTINCT FROM v_new_logo_path THEN
    v_match := pg_catalog.regexp_match(
      v_current_logo_path,
      '/storage/v1/object/public/shop-logos/([^?#]+)$'
    );
    v_object_name := v_match[1];
    IF v_object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
       AND EXISTS (
         SELECT 1 FROM storage.objects AS object
         WHERE object.bucket_id = 'shop-logos' AND object.name = v_object_name
       ) THEN
      INSERT INTO public.shop_logo_upload_paths (object_name, shop_id)
      VALUES (v_object_name, v_shop_id)
      ON CONFLICT (object_name) DO NOTHING;
    END IF;
  END IF;

  UPDATE public.shops AS shop
  SET name = pg_catalog.btrim(p_name),
      phone = pg_catalog.btrim(coalesce(p_phone, '')),
      address = pg_catalog.btrim(coalesce(p_address, '')),
      logo_path = v_new_logo_path
  WHERE shop.id = v_shop_id;

  RETURN pg_catalog.jsonb_build_object(
    'name', pg_catalog.btrim(p_name),
    'phone', coalesce(nullif(pg_catalog.btrim(coalesce(p_phone, '')), ''), ''),
    'address', coalesce(nullif(pg_catalog.btrim(coalesce(p_address, '')), ''), ''),
    'logo_path', coalesce(v_new_logo_path, '')
  );
END
$function$;

REVOKE ALL ON FUNCTION public.can_manage_current_shop_logo(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.prepare_current_shop_logo_upload(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_current_shop_profile(text,text,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_current_shop_logo(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_current_shop_logo_upload(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_current_shop_profile(text,text,text,text) TO authenticated;

CREATE POLICY shop_logos_shop_admin_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'shop-logos'
  AND public.can_manage_current_shop_logo(name)
);

CREATE POLICY shop_logos_shop_admin_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'shop-logos'
  AND public.can_manage_current_shop_logo(name)
)
WITH CHECK (
  bucket_id = 'shop-logos'
  AND public.can_manage_current_shop_logo(name)
);

CREATE POLICY shop_logos_shop_admin_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'shop-logos'
  AND public.can_manage_current_shop_logo(name)
);

DO $postflight$
BEGIN
  IF to_regprocedure('public.can_manage_current_shop_logo(text)') IS NULL
     OR to_regprocedure('public.prepare_current_shop_logo_upload(text)') IS NULL
     OR to_regprocedure('public.update_current_shop_profile(text,text,text,text)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger_row
       WHERE NOT trigger_row.tgisinternal
         AND trigger_row.tgname = 'inactive_shop_write_guard'
         AND trigger_row.tgrelid = 'public.shop_logo_upload_paths'::regclass
         AND trigger_row.tgfoid = to_regprocedure('tenant_private.reject_inactive_shop_write()')::oid
         AND trigger_row.tgenabled IN ('O', 'A')
     )
     OR pg_catalog.has_function_privilege('authenticated', 'public.prepare_current_shop_logo_upload(text)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('authenticated', 'public.update_current_shop_profile(text,text,text,text)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('anon', 'public.prepare_current_shop_logo_upload(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.update_current_shop_profile(text,text,text,text)', 'EXECUTE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_logo_upload_paths', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_logo_upload_paths', 'INSERT')
     OR (
       SELECT count(*) FROM pg_catalog.pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname IN (
           'shop_logos_platform_insert',
           'shop_logos_platform_update',
           'shop_logos_platform_delete',
           'shop_logos_shop_admin_insert',
           'shop_logos_shop_admin_update',
           'shop_logos_shop_admin_delete'
         )
     ) <> 6
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname = 'shop_logos_shop_admin_insert'
         AND cmd = 'INSERT'
         AND position('can_manage_current_shop_logo' IN coalesce(with_check, '')) > 0
     ) THEN
    RAISE EXCEPTION 'S6 package 073 postflight failed.';
  END IF;
END
$postflight$;

COMMIT;
