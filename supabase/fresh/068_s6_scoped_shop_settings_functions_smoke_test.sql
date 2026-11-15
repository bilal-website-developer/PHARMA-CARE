-- Rollback-only runtime smoke test for S6 package 068.
BEGIN;

DO $smoke$
DECLARE
  v_admin_id uuid;
  v_super_admin_id uuid;
  v_allowed_staff_id uuid;
  v_staff_id uuid;
  v_settings jsonb;
BEGIN
  SELECT profile.id
    INTO v_admin_id
  FROM public.profiles AS profile
  WHERE profile.role = 'admin'
    AND profile.shop_id IS NOT NULL
    AND profile.is_active
    AND profile.deleted_at IS NULL
  ORDER BY profile.id
  LIMIT 1;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Smoke test requires an active Shop Admin.';
  END IF;

  SELECT profile.id
    INTO v_super_admin_id
  FROM public.profiles AS profile
  WHERE profile.role = 'super_admin'
    AND profile.shop_id IS NULL
    AND profile.is_active
    AND profile.deleted_at IS NULL
  ORDER BY profile.id
  LIMIT 1;
  IF v_super_admin_id IS NULL THEN
    RAISE EXCEPTION 'Smoke test requires an active platform Super Admin.';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  v_settings := public.current_shop_settings();
  IF jsonb_typeof(v_settings) <> 'object' THEN
    RAISE EXCEPTION 'Current shop settings did not return a JSON object.';
  END IF;
  PERFORM public.update_current_shop_settings(v_settings);

  BEGIN
    PERFORM public.update_current_shop_settings(
      v_settings || pg_catalog.jsonb_build_object('shopName', 'Not allowed')
    );
    RAISE EXCEPTION USING errcode = 'ZX001', message = 'Expected identity field to be rejected.';
  EXCEPTION
    WHEN sqlstate '22023' THEN NULL;
  END;

  SELECT profile.id
    INTO v_allowed_staff_id
  FROM public.profiles AS profile
  WHERE profile.role IN ('manager', 'cashier', 'accountant')
    AND profile.shop_id = (
      SELECT admin_profile.shop_id
      FROM public.profiles AS admin_profile
      WHERE admin_profile.id = v_admin_id
    )
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND profile.permissions @> ARRAY['settings']::text[]
  ORDER BY profile.id
  LIMIT 1;
  IF v_allowed_staff_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_allowed_staff_id::text, true);
    v_settings := public.current_shop_settings();
    PERFORM public.update_current_shop_settings(v_settings);
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_admin_id::text, true);
  v_settings := public.current_shop_settings();

  SELECT profile.id
    INTO v_staff_id
  FROM public.profiles AS profile
  WHERE profile.role IN ('manager', 'cashier', 'accountant')
    AND profile.shop_id = (
      SELECT admin_profile.shop_id
      FROM public.profiles AS admin_profile
      WHERE admin_profile.id = v_admin_id
    )
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND NOT (profile.permissions @> ARRAY['settings']::text[])
  ORDER BY profile.id
  LIMIT 1;
  IF v_staff_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_staff_id::text, true);
    IF jsonb_typeof(public.current_shop_settings()) <> 'object' THEN
      RAISE EXCEPTION 'Same-shop staff could not read operational settings.';
    END IF;
    BEGIN
      PERFORM public.update_current_shop_settings(v_settings);
      RAISE EXCEPTION USING errcode = 'ZX001', message = 'Expected staff without settings permission to be denied.';
    EXCEPTION
      WHEN sqlstate '42501' THEN NULL;
    END;
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
  BEGIN
    PERFORM public.current_shop_settings();
    RAISE EXCEPTION USING errcode = 'ZX001', message = 'Expected platform Super Admin to have no shop settings access.';
  EXCEPTION
    WHEN sqlstate '42501' THEN NULL;
  END;
END
$smoke$;

SELECT jsonb_build_object(
  'stage', 'S6 package 068 scoped shop-settings smoke test',
  'status', 'PASS',
  'rollback_only', true,
  'admin_read_write', true,
  'identity_fields_rejected', true,
  'settings_granted_staff_case_available', EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.role IN ('manager', 'cashier', 'accountant')
      AND profile.shop_id IN (
        SELECT admin_profile.shop_id
        FROM public.profiles AS admin_profile
        WHERE admin_profile.role = 'admin'
          AND admin_profile.is_active
          AND admin_profile.deleted_at IS NULL
      )
      AND profile.is_active
      AND profile.deleted_at IS NULL
      AND profile.permissions @> ARRAY['settings']::text[]
  ),
  'staff_without_settings_case_available', EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.role IN ('manager', 'cashier', 'accountant')
      AND profile.shop_id IN (
        SELECT admin_profile.shop_id
        FROM public.profiles AS admin_profile
        WHERE admin_profile.role = 'admin'
          AND admin_profile.is_active
          AND admin_profile.deleted_at IS NULL
      )
      AND profile.is_active
      AND profile.deleted_at IS NULL
      AND NOT (profile.permissions @> ARRAY['settings']::text[])
  ),
  'platform_super_admin_denied', true
) AS s6_scoped_shop_settings_smoke;

ROLLBACK;
