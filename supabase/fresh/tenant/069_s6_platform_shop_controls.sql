-- S6 package 069: platform-only shop controls, suspension enforcement, limits,
-- and private Admin notes. Does not alter any applied RLS policy definition.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $preflight$
BEGIN
  IF to_regclass('public.shops') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.shop_settings') IS NULL
     OR to_regclass('public.admin_private_notes') IS NULL
     OR to_regclass('public.shop_provisioning_operations') IS NULL
     OR to_regclass('public.return_policy_settings') IS NULL
     OR to_regclass('public.audit_logs') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.is_platform_admin()') IS NULL
     OR to_regprocedure('public.manage_users_profile_update(uuid,uuid,text,text,text,text,text[],boolean,uuid)') IS NULL THEN
    RAISE EXCEPTION 'S6 packages 062, 064, 066, and 067 must be present before package 069.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops'
      AND column_name = 'logo_path' AND data_type = 'text'
  ) THEN
    RAISE EXCEPTION 'The reviewed shop identity logo_path column is missing.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops'
      AND column_name IN ('admin_limit','staff_limit')
  ) OR to_regprocedure('public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)') IS NOT NULL
     OR to_regprocedure('public.platform_admin_private_note(uuid,uuid,text)') IS NOT NULL
  OR to_regprocedure('public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)') IS NOT NULL
  OR to_regprocedure('public.current_shop_access()') IS NOT NULL
  OR to_regprocedure('public.current_shop_profile()') IS NOT NULL THEN
    RAISE EXCEPTION 'Package 069 objects already exist; inspect before applying.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'profiles_shop_isolation'
  ) THEN
    RAISE EXCEPTION 'Reviewed S4 profile shop-isolation policy is not present; do not apply package 069.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE NOT tgisinternal AND tgname IN ('inactive_shop_write_guard','shop_profile_limit_guard')
  ) THEN
    RAISE EXCEPTION 'Package 069 triggers already exist; inspect before applying.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.shop_provisioning_operations'::regclass
      AND conname = 'shop_provisioning_operations_status_check'
      AND contype = 'c'
  ) OR to_regclass('public.shop_provisioning_operations_open_idx') IS NULL THEN
    RAISE EXCEPTION 'Package 066 provisioning status guard or index is missing.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shops WHERE status = 'provisioning')
     OR EXISTS (
       SELECT 1 FROM public.shop_provisioning_operations
       WHERE status NOT IN ('completed','compensated','failed')
     ) THEN
    RAISE EXCEPTION 'Incomplete shop provisioning exists; reconcile it before package 069.';
  END IF;
END
$preflight$;

LOCK TABLE public.shops, public.profiles, public.shop_provisioning_operations
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.shops
  ADD COLUMN admin_limit integer NOT NULL DEFAULT 10
    CHECK (admin_limit BETWEEN 1 AND 50),
  ADD COLUMN staff_limit integer NOT NULL DEFAULT 100
    CHECK (staff_limit BETWEEN 1 AND 500);

ALTER TABLE public.shop_provisioning_operations
  ADD COLUMN auth_email text
    CHECK (auth_email IS NULL OR length(auth_email) <= 254);

ALTER TABLE public.shop_provisioning_operations
  DROP CONSTRAINT shop_provisioning_operations_status_check,
  ADD CONSTRAINT shop_provisioning_operations_status_check
    CHECK (status IN (
      'pending_auth','auth_creating','auth_created','finalizing','completed',
      'compensation_pending','compensating','compensation_failed','compensated','failed'
    ));

DROP INDEX public.shop_provisioning_operations_open_idx;
CREATE INDEX shop_provisioning_operations_open_idx
  ON public.shop_provisioning_operations (status, created_at)
  WHERE status IN (
    'pending_auth','auth_creating','auth_created','finalizing',
    'compensation_pending','compensating','compensation_failed'
  );

CREATE FUNCTION public.current_shop_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_profile public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_locked boolean;
BEGIN
  SELECT profile.* INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid() AND profile.is_active AND profile.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active profile is required.';
  END IF;
  IF v_profile.role = 'super_admin' AND v_profile.shop_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('platform',true,'locked',false,'read_only',false);
  END IF;
  SELECT shop.* INTO v_shop
  FROM public.shops AS shop
  WHERE shop.id = v_profile.shop_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('platform',false,'locked',true,'read_only',false);
  END IF;
  v_locked := v_shop.status <> 'active';
  RETURN pg_catalog.jsonb_build_object(
    'platform',false,
    'locked',v_locked,
    'read_only',false
  );
END
$function$;

CREATE FUNCTION public.current_shop_profile()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'name',shop.name,
    'phone',shop.phone,
    'address',shop.address,
    'logo_path',shop.logo_path
  )
  FROM public.shops AS shop
  WHERE shop.id = tenant_private.current_shop_id()
  LIMIT 1;
$function$;

CREATE FUNCTION tenant_private.reject_inactive_shop_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, tenant_private
AS $function$
DECLARE
  v_shop_id uuid;
  v_shop_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_shop_id := OLD.shop_id;
  ELSE
    v_shop_id := NEW.shop_id;
  END IF;

  SELECT shop.status INTO v_shop_status
  FROM public.shops AS shop
  WHERE shop.id = v_shop_id
  FOR SHARE;
  IF FOUND AND v_shop_status <> 'active' THEN
    RAISE EXCEPTION USING errcode = '42501',
      message = 'This shop is not active and cannot perform business operations.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$;

DO $install_write_guards$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT relation.relname
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN information_schema.columns AS column_row
      ON column_row.table_schema = namespace.nspname
      AND column_row.table_name = relation.relname
      AND column_row.column_name = 'shop_id'
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r','p')
      AND relation.relname NOT IN ('shops','shop_provisioning_operations')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
        WHERE inheritance.inhrelid = relation.oid
      )
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER inactive_shop_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION tenant_private.reject_inactive_shop_write()',
      v_table.relname
    );
  END LOOP;
END
$install_write_guards$;

CREATE FUNCTION tenant_private.enforce_shop_profile_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, tenant_private
AS $function$
DECLARE
  v_admin_limit integer;
  v_staff_limit integer;
  v_role_count bigint;
  v_limit integer;
BEGIN
  IF NEW.role = 'super_admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.shop_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '23514', message = 'Shop profiles require a shop assignment.';
  END IF;

  SELECT shop.admin_limit, shop.staff_limit
    INTO v_admin_limit, v_staff_limit
  FROM public.shops AS shop
  WHERE shop.id = NEW.shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '23503', message = 'The assigned shop does not exist.';
  END IF;

  IF NEW.role = 'admin' THEN
    v_limit := v_admin_limit;
  ELSE
    v_limit := v_staff_limit;
  END IF;
  SELECT count(*) INTO v_role_count
  FROM public.profiles AS profile
  WHERE profile.shop_id = NEW.shop_id
    AND profile.id IS DISTINCT FROM NEW.id
    AND (
      (NEW.role = 'admin' AND profile.role = 'admin')
      OR (NEW.role <> 'admin' AND profile.role NOT IN ('admin','super_admin'))
    );
  IF v_role_count >= v_limit THEN
    RAISE EXCEPTION USING errcode = 'P0001',
      message = CASE WHEN NEW.role = 'admin'
        THEN 'The shop Admin limit has been reached.'
        ELSE 'The shop staff limit has been reached.'
      END;
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER shop_profile_limit_guard
BEFORE INSERT OR UPDATE OF role, shop_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION tenant_private.enforce_shop_profile_limits();

CREATE FUNCTION public.platform_manage_shop(
  p_actor_id uuid,
  p_shop_id uuid,
  p_name text,
  p_phone text,
  p_address text,
  p_logo_path text,
  p_status text,
  p_admin_limit integer,
  p_staff_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, tenant_private
AS $function$
DECLARE
  v_actor public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_before jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Service-role access is required.';
  END IF;
  SELECT profile.* INTO v_actor FROM public.profiles AS profile
  WHERE profile.id = p_actor_id AND profile.role = 'super_admin'
    AND profile.is_active AND profile.deleted_at IS NULL AND profile.shop_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active platform Super Admin is required.';
  END IF;
  IF p_name IS NULL OR pg_catalog.btrim(p_name) = '' OR pg_catalog.length(p_name) > 120
     OR p_phone IS NULL OR pg_catalog.length(p_phone) > 40
     OR p_address IS NULL OR pg_catalog.length(p_address) > 240
     OR p_logo_path IS NULL OR pg_catalog.length(p_logo_path) > 4096
     OR p_status IS NULL OR p_status NOT IN ('active','suspended','deleted')
     OR p_admin_limit IS NULL OR p_admin_limit NOT BETWEEN 1 AND 50
     OR p_staff_limit IS NULL OR p_staff_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Shop settings contain invalid values.';
  END IF;

  SELECT shop.* INTO v_shop FROM public.shops AS shop
  WHERE shop.id = p_shop_id FOR UPDATE;
  IF NOT FOUND OR v_shop.status = 'provisioning' THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'The shop is unavailable for editing.';
  END IF;
  IF v_shop.status = 'deleted' AND p_status <> 'deleted' THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'A deleted shop cannot be reactivated.';
  END IF;
  v_before := pg_catalog.jsonb_build_object(
    'name',v_shop.name,'phone',v_shop.phone,'address',v_shop.address,'logo_path',v_shop.logo_path,
    'status',v_shop.status,
    'admin_limit',v_shop.admin_limit,'staff_limit',v_shop.staff_limit
  );
  UPDATE public.shops
  SET name = pg_catalog.btrim(p_name),
      phone = p_phone,
      address = p_address,
      logo_path = NULLIF(p_logo_path,''),
      status = p_status,
      admin_limit = p_admin_limit,
      staff_limit = p_staff_limit,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_shop_id
  RETURNING * INTO v_shop;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, details, shop_id)
  VALUES (p_actor_id,'update','shop',p_shop_id,
    pg_catalog.jsonb_build_object('before',v_before,'after',pg_catalog.jsonb_build_object(
      'name',v_shop.name,'phone',v_shop.phone,'address',v_shop.address,'logo_path',v_shop.logo_path,
      'status',v_shop.status,
      'admin_limit',v_shop.admin_limit,'staff_limit',v_shop.staff_limit
    )),p_shop_id);
  RETURN pg_catalog.jsonb_build_object(
    'id',v_shop.id,'name',v_shop.name,'status',v_shop.status,
    'admin_limit',v_shop.admin_limit,'staff_limit',v_shop.staff_limit
  );
END
$function$;

CREATE FUNCTION public.platform_admin_private_note(
  p_actor_id uuid,
  p_admin_profile_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor public.profiles%rowtype;
  v_admin public.profiles%rowtype;
  v_note text;
  v_updated_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Service-role access is required.';
  END IF;
  SELECT profile.* INTO v_actor FROM public.profiles AS profile
  WHERE profile.id = p_actor_id AND profile.role = 'super_admin'
    AND profile.is_active AND profile.deleted_at IS NULL AND profile.shop_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active platform Super Admin is required.';
  END IF;
  SELECT profile.* INTO v_admin FROM public.profiles AS profile
  WHERE profile.id = p_admin_profile_id AND profile.role = 'admin'
    AND profile.deleted_at IS NULL AND profile.shop_id IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'Admin profile not found.';
  END IF;
  IF p_note IS NOT NULL THEN
    IF pg_catalog.length(p_note) > 2000 THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'Admin note must be 2000 characters or fewer.';
    END IF;
    INSERT INTO public.admin_private_notes (admin_profile_id,note,updated_by,updated_at)
    VALUES (p_admin_profile_id,p_note,p_actor_id,pg_catalog.clock_timestamp())
    ON CONFLICT (admin_profile_id) DO UPDATE
      SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
    INSERT INTO public.audit_logs (actor_id,action,entity,entity_id,details,shop_id)
    VALUES (p_actor_id,'update','admin_private_note',p_admin_profile_id,
      pg_catalog.jsonb_build_object('note_length',pg_catalog.length(p_note)),v_admin.shop_id);
  END IF;
  SELECT notes.note, notes.updated_at INTO v_note,v_updated_at
  FROM public.admin_private_notes AS notes
  WHERE notes.admin_profile_id = p_admin_profile_id;
  RETURN pg_catalog.jsonb_build_object(
    'admin_profile_id',p_admin_profile_id,
    'note',coalesce(v_note,''),
    'updated_at',v_updated_at
  );
END
$function$;

CREATE FUNCTION public.finalize_shop_provisioning(
  p_operation_id uuid,
  p_actor_id uuid,
  p_auth_user_id uuid,
  p_request_fingerprint text,
  p_shop_name text,
  p_phone text,
  p_address text,
  p_admin_full_name text,
  p_admin_username text,
  p_admin_email text,
  p_admin_permissions text[],
  p_admin_limit integer,
  p_staff_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor public.profiles%rowtype;
  v_operation public.shop_provisioning_operations%rowtype;
  v_shop_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Service-role access is required.';
  END IF;
  SELECT profile.* INTO v_actor FROM public.profiles AS profile
  WHERE profile.id = p_actor_id AND profile.role = 'super_admin'
    AND profile.is_active AND profile.deleted_at IS NULL AND profile.shop_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active platform Super Admin is required.';
  END IF;
  SELECT operation.* INTO v_operation
  FROM public.shop_provisioning_operations AS operation
  WHERE operation.operation_id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.requested_by <> p_actor_id
     OR v_operation.request_fingerprint <> p_request_fingerprint
     OR v_operation.auth_user_id <> p_auth_user_id
     OR v_operation.auth_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_admin_email)) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Provisioning operation identity did not match.';
  END IF;
  IF v_operation.status = 'completed' AND v_operation.shop_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('shop_id',v_operation.shop_id,'status','completed');
  END IF;
  IF v_operation.status <> 'finalizing' THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'Provisioning operation is not ready to finalize.';
  END IF;
  IF p_shop_name IS NULL OR pg_catalog.btrim(p_shop_name) = ''
     OR pg_catalog.length(p_shop_name) > 120
     OR p_admin_full_name IS NULL OR pg_catalog.btrim(p_admin_full_name) = ''
     OR p_admin_username IS NULL OR pg_catalog.btrim(p_admin_username) = ''
     OR pg_catalog.length(p_admin_username) > 80
     OR pg_catalog.length(p_admin_full_name) > 120
     OR p_admin_email IS NULL OR p_admin_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR pg_catalog.length(p_phone) > 40
     OR pg_catalog.length(p_address) > 240
     OR p_admin_permissions IS NULL
     OR p_admin_limit IS NULL OR p_admin_limit NOT BETWEEN 1 AND 50
     OR p_staff_limit IS NULL OR p_staff_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Provisioning data is invalid.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_admin_permissions) AS permission_row(permission)
    WHERE permission_row.permission IS NULL OR permission_row.permission NOT IN (
      'pos','products','categories','suppliers','customers','sales_history',
      'purchase_history','purchases','expenses','stock_inventory','reports','manage_users',
      'settings','pos_print_sale','pos_print_payment'
    )
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Admin permissions contain an invalid key.';
  END IF;

  UPDATE public.shop_provisioning_operations
  SET status = 'finalizing', attempt_count = attempt_count + 1,
      updated_at = pg_catalog.clock_timestamp()
  WHERE operation_id = p_operation_id;

  PERFORM pg_catalog.pg_advisory_xact_lock(202610290002);
  IF EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE pg_catalog.lower(profile.username) = pg_catalog.lower(pg_catalog.btrim(p_admin_username))
       OR pg_catalog.lower(profile.email) = pg_catalog.lower(pg_catalog.btrim(p_admin_email))
  ) THEN
    RAISE EXCEPTION USING errcode = '23505', message = 'Username or email is already in use.';
  END IF;

  INSERT INTO public.shops (
    name,phone,address,status,created_by,admin_limit,staff_limit
  )
  VALUES (
    pg_catalog.btrim(p_shop_name),coalesce(p_phone,''),coalesce(p_address,''),
    'provisioning',p_actor_id,p_admin_limit,p_staff_limit
  )
  RETURNING id INTO v_shop_id;
  INSERT INTO public.shop_settings (shop_id) VALUES (v_shop_id);
  INSERT INTO public.return_policy_settings (
    shop_id,id,return_window_days,minimum_restock_shelf_life_days
  ) VALUES (v_shop_id,1,7,90);
  INSERT INTO public.profiles (
    id,full_name,username,email,role,permissions,is_active,deleted_at,created_by,shop_id
  ) VALUES (
    p_auth_user_id,pg_catalog.btrim(p_admin_full_name),pg_catalog.btrim(p_admin_username),
    pg_catalog.lower(pg_catalog.btrim(p_admin_email)),'admin',p_admin_permissions,
    true,NULL,p_actor_id,v_shop_id
  );
  UPDATE public.shops
  SET status = 'active', updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_shop_id;
  UPDATE public.shop_provisioning_operations
  SET shop_id = v_shop_id,status = 'completed',completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp(),last_error_code = NULL
  WHERE operation_id = p_operation_id;
  INSERT INTO public.audit_logs (actor_id,action,entity,entity_id,details,shop_id)
  VALUES (p_actor_id,'provision','shop',v_shop_id,
    pg_catalog.jsonb_build_object('admin_profile_id',p_auth_user_id,'status','active'),v_shop_id);
  RETURN pg_catalog.jsonb_build_object('shop_id',v_shop_id,'status','completed');
END
$function$;

REVOKE ALL ON FUNCTION public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.current_shop_access() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_shop_access() TO authenticated;
REVOKE ALL ON FUNCTION public.current_shop_profile() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_shop_profile() TO authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_private_note(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_private_note(uuid,uuid,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)
  TO service_role;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops'
      AND column_name = 'admin_limit' AND data_type = 'integer'
  ) OR to_regprocedure('public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)') IS NULL
    OR to_regprocedure('public.platform_admin_private_note(uuid,uuid,text)') IS NULL
    OR to_regprocedure('public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)') IS NULL
    OR to_regprocedure('public.current_shop_access()') IS NULL
    OR to_regprocedure('public.current_shop_profile()') IS NULL
    OR pg_catalog.has_function_privilege('anon','public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)','EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated','public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role','public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer)','EXECUTE')
    OR pg_catalog.has_function_privilege('anon','public.platform_admin_private_note(uuid,uuid,text)','EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated','public.platform_admin_private_note(uuid,uuid,text)','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role','public.platform_admin_private_note(uuid,uuid,text)','EXECUTE')
    OR pg_catalog.has_function_privilege('anon','public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)','EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated','public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role','public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer)','EXECUTE')
    OR pg_catalog.has_function_privilege('anon','public.current_shop_access()','EXECUTE')
    OR pg_catalog.has_function_privilege('service_role','public.current_shop_access()','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated','public.current_shop_access()','EXECUTE')
    OR pg_catalog.has_function_privilege('anon','public.current_shop_profile()','EXECUTE')
    OR pg_catalog.has_function_privilege('service_role','public.current_shop_profile()','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated','public.current_shop_profile()','EXECUTE')
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgname = 'shop_profile_limit_guard' AND NOT tgisinternal
    ) THEN
    RAISE EXCEPTION 'Package 069 postflight verification failed.';
  END IF;
END
$postflight$;

COMMIT;
