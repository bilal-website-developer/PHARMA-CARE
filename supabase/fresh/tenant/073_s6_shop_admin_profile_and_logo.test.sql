-- Owner-run rollback-only checks for package 073. Requires an active Shop Admin
-- with Settings access and an active non-Admin profile in the same shop.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $test$
DECLARE
  v_admin_id uuid;
  v_staff_id uuid;
  v_shop_id uuid;
  v_profile jsonb;
  v_upload_path text;
  v_denied boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this smoke test as the reviewed database-owner role with RLS bypass.';
  END IF;

  SELECT profile.id, profile.shop_id INTO v_admin_id, v_shop_id
  FROM public.profiles AS profile
  JOIN public.shops AS shop ON shop.id = profile.shop_id
  WHERE profile.role = 'admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND profile.permissions @> ARRAY['settings']::text[]
    AND shop.status = 'active'
  ORDER BY profile.id
  LIMIT 1;
  SELECT profile.id INTO v_staff_id
  FROM public.profiles AS profile
  WHERE profile.shop_id = v_shop_id
    AND profile.role <> 'admin'
    AND profile.role <> 'super_admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL
  ORDER BY profile.id
  LIMIT 1;
  IF v_admin_id IS NULL OR v_staff_id IS NULL OR v_shop_id IS NULL THEN
    RAISE EXCEPTION 'An active Shop Admin with Settings access and same-shop staff profile are required.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_admin_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_admin_id::text,'role','authenticated'
  )::text,true);

  v_profile := public.current_shop_profile();
  IF v_profile IS NULL OR v_profile ? 'id' THEN
    RAISE EXCEPTION 'Current Shop Profile must remain available without exposing its shop ID.';
  END IF;
  v_upload_path := public.prepare_current_shop_logo_upload('png');
  IF NOT public.can_manage_current_shop_logo(v_upload_path)
     OR public.can_manage_current_shop_logo('00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000.png') THEN
    RAISE EXCEPTION 'Shop Admin logo upload scope check failed.';
  END IF;

  v_profile := public.update_current_shop_profile(
    v_profile->>'name',
    v_profile->>'phone',
    v_profile->>'address',
    coalesce(v_profile->>'logo_path','')
  );
  IF v_profile->>'name' IS NULL OR v_profile ? 'id' THEN
    RAISE EXCEPTION 'Shop Admin profile update or shop-ID privacy check failed.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_staff_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_staff_id::text,'role','authenticated'
  )::text,true);
  IF public.can_manage_current_shop_logo(v_upload_path) THEN
    RAISE EXCEPTION 'Non-Admin shop staff received logo write access.';
  END IF;
  BEGIN
    PERFORM public.update_current_shop_profile(
      'Unauthorized profile update',
      '',
      '',
      ''
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'Non-Admin shop staff were able to update the shop profile.';
  END IF;

  RAISE NOTICE 'PASS: Shop Admin profile update and shop-scoped logo upload authorization; no shop ID exposed.';
END
$test$;

ROLLBACK;
