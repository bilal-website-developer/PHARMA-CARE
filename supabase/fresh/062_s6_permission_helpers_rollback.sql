-- S6 package 062 rollback. Run only after reviewing the matching smoke result.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this rollback as the reviewed database owner role with RLS bypass.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.is_admin()'::regprocedure)
  INTO v_definition;
  IF position('profile.role = ''admin''' IN lower(v_definition)) = 0
     OR position('tenant_private.current_shop_id()' IN lower(v_definition)) = 0 THEN
    RAISE EXCEPTION 'is_admin() no longer matches package 062; rollback stopped.';
  END IF;
  SELECT pg_catalog.pg_get_functiondef('public.has_any_permission(text[])'::regprocedure)
  INTO v_definition;
  IF position('profile.permissions && coalesce(perms, array[]::text[])' IN lower(v_definition)) = 0
     OR position('profile.role in' IN lower(v_definition)) > 0 THEN
    RAISE EXCEPTION 'has_any_permission(text[]) no longer matches package 062; rollback stopped.';
  END IF;
  SELECT pg_catalog.pg_get_functiondef('public.is_staff()'::regprocedure)
  INTO v_definition;
  IF position('profile.shop_id = tenant_private.current_shop_id()' IN lower(v_definition)) = 0
     OR position('profile.role in (''admin'', ''manager'', ''cashier'', ''accountant'')' IN lower(v_definition)) = 0 THEN
    RAISE EXCEPTION 'is_staff() no longer matches package 062; rollback stopped.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE permissions @> ARRAY['settings']::text[]
  ) THEN
    RAISE EXCEPTION 'Profiles now use the settings permission; preserve it and do not roll back package 062.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_permissions_valid'
      AND contype = 'c'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%''settings''%'
  ) THEN
    RAISE EXCEPTION 'The package 062 permission constraint is missing or changed.';
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
  ) THEN
    RAISE EXCEPTION 'A legacy profile policy was recreated; review before rollback.';
  END IF;

  IF to_regprocedure('public.is_platform_admin()') IS NULL THEN
    RAISE EXCEPTION 'is_platform_admin() is missing; package 062 may have been changed.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_active
      AND deleted_at IS NULL
      AND role IN ('admin', 'super_admin')
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_any_permission(perms text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.is_active
      AND profile.deleted_at IS NULL
      AND (
        profile.role IN ('admin', 'super_admin')
        OR profile.permissions && perms
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_active
      AND deleted_at IS NULL
  );
$function$;

DROP FUNCTION public.is_platform_admin();

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
      'pos_print_sale',
      'pos_print_payment'
    ]::text[]
    AND (
      NOT (permissions && ARRAY['pos_print_sale', 'pos_print_payment']::text[])
      OR permissions @> ARRAY['pos']::text[]
    )
  );

CREATE POLICY "read own profile or admin reads all"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "admin can add profiles"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "admin can edit profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "admin can delete profiles"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (is_admin());

COMMIT;
