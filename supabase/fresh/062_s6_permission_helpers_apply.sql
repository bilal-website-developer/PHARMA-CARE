-- S6 package 062: explicit shop permissions and creator-scoped profile reads.
-- Owner-run only. Review 060/061 results and run the matching smoke test next.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_definition text;
  v_constraint text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this package as the reviewed database owner role with RLS bypass.';
  END IF;

  IF to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL
     OR to_regprocedure('public.is_staff()') IS NULL THEN
    RAISE EXCEPTION 'A required S3/S6 helper is missing; rerun preflights 060/061.';
  END IF;
  IF to_regprocedure('public.is_platform_admin()') IS NOT NULL THEN
    RAISE EXCEPTION 'is_platform_admin() already exists; review its definition before applying.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.is_admin()'::regprocedure)
  INTO v_definition;
  IF position('role in (''admin'', ''super_admin'')' IN lower(v_definition)) = 0
     OR NOT (
       SELECT procedure.prosecdef
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = 'public.is_admin()'::regprocedure
     )
     OR NOT has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_admin() differs from the reviewed live definition or grants.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.has_any_permission(text[])'::regprocedure)
  INTO v_definition;
  IF position('p.role in (''admin'', ''super_admin'')' IN lower(v_definition)) = 0
     OR position('p.permissions && perms' IN lower(v_definition)) = 0
     OR NOT (
       SELECT procedure.prosecdef
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = 'public.has_any_permission(text[])'::regprocedure
     )
     OR NOT has_function_privilege('authenticated', 'public.has_any_permission(text[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.has_any_permission(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'has_any_permission(text[]) differs from the reviewed live definition or grants.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.is_staff()'::regprocedure)
  INTO v_definition;
  IF position('is_active' IN lower(v_definition)) = 0
     OR position('deleted_at' IN lower(v_definition)) = 0
     OR position('current_shop_id' IN lower(v_definition)) > 0
     OR NOT (
       SELECT procedure.prosecdef
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = 'public.is_staff()'::regprocedure
     )
     OR NOT has_function_privilege('authenticated', 'public.is_staff()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.is_staff()', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_staff() differs from the reviewed live definition or grants.';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
  INTO v_constraint
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::regclass
    AND constraint_row.conname = 'profiles_permissions_valid'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF v_constraint IS NULL
     OR position('''pos_print_sale''' IN lower(v_constraint)) = 0
     OR position('''pos_print_payment''' IN lower(v_constraint)) = 0
     OR position('''manage_users''' IN lower(v_constraint)) = 0
     OR position('''settings''' IN lower(v_constraint)) > 0 THEN
    RAISE EXCEPTION 'profiles_permissions_valid differs from the reviewed 14-key constraint.';
  END IF;

  IF NOT EXISTS (
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
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'read own profile or admin reads all'
      AND cmd = 'SELECT'
      AND permissive = 'PERMISSIVE'
      AND qual = '((id = auth.uid()) OR is_admin())'
  ) THEN
    RAISE EXCEPTION 'Profile read policies differ from the reviewed 061 result.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'admin can add profiles' AND cmd = 'INSERT'
      AND with_check = 'is_admin()'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'admin can edit profiles' AND cmd = 'UPDATE'
      AND qual = 'is_admin()' AND with_check = 'is_admin()'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'admin can delete profiles' AND cmd = 'DELETE'
      AND qual = 'is_admin()'
  ) THEN
    RAISE EXCEPTION 'Profile write policies differ from the reviewed 061 result.';
  END IF;

  IF has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR EXISTS (
       SELECT 1 FROM information_schema.column_privileges
       WHERE table_schema = 'public'
         AND table_name = 'profiles'
         AND grantee = 'authenticated'
         AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
     )
     OR NOT has_table_privilege('service_role', 'public.profiles', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.profiles', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.profiles', 'DELETE') THEN
    RAISE EXCEPTION 'Profile table ACLs changed; review 061 before applying.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.deleted_at IS NULL
      AND profile.role = 'admin'
      AND profile.shop_id = tenant_private.current_shop_id()
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_any_permission(perms text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.deleted_at IS NULL
      AND profile.shop_id = tenant_private.current_shop_id()
      AND profile.permissions && COALESCE(perms, ARRAY[]::text[])
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.deleted_at IS NULL
      AND profile.role IN ('admin', 'manager', 'cashier', 'accountant')
      AND profile.shop_id = tenant_private.current_shop_id()
  );
$function$;

CREATE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.deleted_at IS NULL
      AND profile.role = 'super_admin'
      AND profile.shop_id IS NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_permissions_valid;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_permissions_valid
  CHECK (
    permissions <@ ARRAY[
      'pos',
      'products',
      'categories',
      'suppliers',
      'customers',
      'sales_history',
      'purchase_history',
      'purchases',
      'expenses',
      'stock_inventory',
      'reports',
      'manage_users',
      'settings',
      'pos_print_sale',
      'pos_print_payment'
    ]::text[]
    AND (
      NOT (permissions && ARRAY['pos_print_sale', 'pos_print_payment']::text[])
      OR permissions @> ARRAY['pos']::text[]
    )
  );

DROP POLICY "read own profile or admin reads all" ON public.profiles;
DROP POLICY "admin can add profiles" ON public.profiles;
DROP POLICY "admin can edit profiles" ON public.profiles;
DROP POLICY "admin can delete profiles" ON public.profiles;

COMMIT;
