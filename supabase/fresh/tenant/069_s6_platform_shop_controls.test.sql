-- Owner-run rollback-only checks for package 069.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $test$
DECLARE
  v_platform_admin uuid;
  v_shop_admin uuid;
  v_shop_id uuid;
  v_shop public.shops%rowtype;
  v_note jsonb;
  v_access jsonb;
  v_result jsonb;
  v_write_denied boolean := false;
  v_profile jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this smoke test as the reviewed database owner role with RLS bypass.';
  END IF;
  SELECT id INTO v_platform_admin FROM public.profiles
  WHERE role = 'super_admin' AND is_active AND deleted_at IS NULL AND shop_id IS NULL
  ORDER BY id LIMIT 1;
  SELECT id, shop_id INTO v_shop_admin, v_shop_id FROM public.profiles
  WHERE role = 'admin' AND is_active AND deleted_at IS NULL AND shop_id IS NOT NULL
  ORDER BY id LIMIT 1;
  IF v_platform_admin IS NULL OR v_shop_admin IS NULL OR v_shop_id IS NULL THEN
    RAISE EXCEPTION 'An active platform Super Admin and active Shop Admin are required.';
  END IF;
  SELECT * INTO v_shop FROM public.shops WHERE id = v_shop_id FOR UPDATE;
  IF v_shop.status <> 'active' THEN
    RAISE EXCEPTION 'Choose an Admin assigned to an active shop for this test.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_platform_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_platform_admin::text,'role','service_role'
  )::text,true);
  v_note := public.platform_admin_private_note(v_platform_admin,v_shop_admin,'S6 private note smoke');
  IF v_note->>'note' IS DISTINCT FROM 'S6 private note smoke' THEN
    RAISE EXCEPTION 'Platform private-note write/read failed.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_shop_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_shop_admin::text,'role','authenticated'
  )::text,true);
  v_profile := public.current_shop_profile();
  IF v_profile->>'name' IS DISTINCT FROM v_shop.name
     OR v_profile ? 'id' THEN
    RAISE EXCEPTION 'Shop users must receive their shop identity without an exposed shop ID.';
  END IF;
  v_access := public.current_shop_access();
  IF v_access->>'platform' IS DISTINCT FROM 'false'
     OR v_access->>'locked' IS DISTINCT FROM 'false'
     OR v_access->>'read_only' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Active shop access metadata is invalid.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_platform_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_platform_admin::text,'role','service_role'
  )::text,true);
  v_result := public.platform_manage_shop(
    v_platform_admin,v_shop_id,v_shop.name,v_shop.phone,v_shop.address,coalesce(v_shop.logo_path,''),
    'suspended',v_shop.admin_limit,v_shop.staff_limit
  );
  IF v_result->>'status' IS DISTINCT FROM 'suspended' THEN
    RAISE EXCEPTION 'Platform shop suspension failed.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_shop_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_shop_admin::text,'role','authenticated'
  )::text,true);
  IF tenant_private.current_shop_id() IS NOT NULL THEN
    RAISE EXCEPTION 'A suspended shop user must lose business-data scope immediately.';
  END IF;
  v_access := public.current_shop_access();
  IF v_access->>'locked' IS DISTINCT FROM 'true'
     OR v_access->>'read_only' IS DISTINCT FROM 'false'
     OR v_access->>'shop_id' IS NOT NULL THEN
    RAISE EXCEPTION 'Suspended-shop access must be locked without exposing a shop ID.';
  END IF;
  IF public.current_shop_profile() IS NOT NULL THEN
    RAISE EXCEPTION 'Suspended shop users must not receive shop profile data.';
  END IF;
  BEGIN
    UPDATE public.return_policy_settings
    SET return_window_days = return_window_days
    WHERE shop_id = v_shop_id AND id = 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_write_denied := true;
  END;
  IF NOT v_write_denied THEN
    RAISE EXCEPTION 'A suspended shop write was not blocked.';
  END IF;

  RAISE NOTICE 'PASS: platform note and shop controls; active shop identity; immediate suspended-shop access denial.';
END
$test$;

ROLLBACK;
