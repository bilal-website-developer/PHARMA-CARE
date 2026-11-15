-- S6 package 062: rollback-only helper and policy checks.
-- Runs as the database owner; output contains statuses only, no profile identifiers.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $test$
DECLARE
  v_admin_id uuid;
  v_super_admin_id uuid;
  v_shop_id uuid;
  v_permissions text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this smoke test as the reviewed database owner role with RLS bypass.';
  END IF;

  SELECT profile.id, profile.shop_id, profile.permissions
  INTO v_admin_id, v_shop_id, v_permissions
  FROM public.profiles AS profile
  JOIN public.shops AS shop ON shop.id = profile.shop_id
  WHERE profile.role = 'admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND shop.status = 'active'
  ORDER BY profile.id
  LIMIT 1;
  SELECT profile.id
  INTO v_super_admin_id
  FROM public.profiles AS profile
  WHERE profile.role = 'super_admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND profile.shop_id IS NULL
  ORDER BY profile.id
  LIMIT 1;

  IF v_admin_id IS NULL OR v_shop_id IS NULL OR v_super_admin_id IS NULL THEN
    RAISE EXCEPTION 'Active Shop Admin and platform Super Admin smoke fixtures are required.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text,
    true
  );
  IF tenant_private.current_shop_id() IS DISTINCT FROM v_shop_id
     OR public.is_admin() IS DISTINCT FROM true
     OR public.is_staff() IS DISTINCT FROM true
     OR public.is_platform_admin() IS DISTINCT FROM false
     OR public.has_any_permission(ARRAY[]::text[]) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Shop Admin helper semantics failed.';
  END IF;
  IF cardinality(COALESCE(v_permissions, ARRAY[]::text[])) > 0
     AND public.has_any_permission(v_permissions) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Explicit Shop Admin permission was not honored.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin_id::text, 'role', 'authenticated')::text,
    true
  );
  IF tenant_private.current_shop_id() IS NOT NULL
     OR public.is_admin() IS DISTINCT FROM false
     OR public.is_staff() IS DISTINCT FROM false
     OR public.is_platform_admin() IS DISTINCT FROM true
     OR public.has_any_permission(ARRAY['pos']::text[]) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Super Admin was granted shop-business access by a protected helper.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname IN (
        'read own profile or admin reads all',
        'admin can add profiles',
        'admin can edit profiles',
        'admin can delete profiles'
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles read own profile or assigned team'
      AND cmd = 'SELECT'
      AND permissive = 'PERMISSIVE'
      AND qual LIKE '%created_by = auth.uid()%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_shop_isolation'
      AND cmd = 'ALL'
      AND permissive = 'RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION 'Profile policy scope did not match the reviewed creator-scoped policy.';
  END IF;

  IF has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated profile table DML is unexpectedly granted.';
  END IF;
END;
$test$;

ROLLBACK;

SELECT
  'PASS' AS status,
  'Shop Admin explicit permission and platform-only Super Admin helper behavior' AS check_name,
  'Profile creator-scope policies and service-only profile writes' AS policy_check;
