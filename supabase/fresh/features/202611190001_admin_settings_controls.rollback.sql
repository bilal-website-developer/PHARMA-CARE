-- Owner-run rollback for 202611190001_admin_settings_controls.sql.
-- Roll back the frontend and manage-users function before running this file.

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this rollback as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regprocedure('public.update_current_shop_settings_v2(jsonb)') IS NULL
     OR to_regprocedure('public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Settings controls functions are missing; inspect before rollback.';
  END IF;
END
$preflight$;

DROP TRIGGER admin_shop_profile_section_guard ON public.shops;
DROP TRIGGER admin_receipt_qr_settings_section_guard ON public.shop_receipt_qr_settings;
DROP TRIGGER admin_receipt_qr_revoke_section_guard ON public.sale_receipt_links;

DROP FUNCTION public.update_current_shop_settings_v2(jsonb);
DROP FUNCTION public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb);
DROP FUNCTION tenant_private.validate_shop_settings_payload(jsonb);
DROP FUNCTION tenant_private.enforce_admin_settings_section_guard();

CREATE OR REPLACE FUNCTION public.can_manage_current_shop_logo(p_object_name text)
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

CREATE OR REPLACE FUNCTION public.prepare_current_shop_logo_upload(p_extension text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, tenant_private
AS $function$
DECLARE
  v_shop_id uuid;
  v_object_name text;
BEGIN
  IF auth.uid() IS NULL OR p_extension IS NULL OR p_extension NOT IN ('png','jpg','webp') THEN
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

REVOKE ALL ON FUNCTION public.update_current_shop_settings_v2(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_current_shop_settings(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.can_manage_current_shop_logo(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.prepare_current_shop_logo_upload(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_current_shop_logo(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_current_shop_logo_upload(text) TO authenticated;

UPDATE public.shop_settings AS settings
SET settings = pg_catalog.jsonb_set(
  settings.settings #- '{memo,showBatchNumber}' #- '{memo,showExpiryDate}',
  '{memo,showBatchExpiry}',
  pg_catalog.to_jsonb(
    coalesce((settings.settings #>> '{memo,showBatchNumber}')::boolean, false)
    AND coalesce((settings.settings #>> '{memo,showExpiryDate}')::boolean, false)
  ),
  true
);

ALTER TABLE public.shop_settings
  ALTER COLUMN settings SET DEFAULT '{
    "billingTemplate": "pharmacy-memo",
    "receiptFormat": "thermal80",
    "maxDiscountPaisa": 20000,
    "roleDiscountPercentCap": {"admin": 30, "manager": 15, "cashier": 10, "accountant": 0},
    "expiryWarningDays": 90,
    "memo": {
      "notes": [
        "Items will be return with cash memo within 15 days.",
        "Inhaler / loose tablets / lotion / fridge items/cosmetics items will not be returned.",
        "Without sign and stamp bill will not be valid"
      ],
      "terminalName": "SERVER-PC",
      "showBatchExpiry": true,
      "roundNet": "none",
      "printTax": false,
      "duplicateLabel": true,
      "autoPrint": false,
      "numberDigits": 6,
      "printLogo": true
    }
  }'::jsonb;

UPDATE public.profiles AS profile
SET permissions = ARRAY(
  SELECT permission
  FROM pg_catalog.unnest(coalesce(profile.permissions, ARRAY[]::text[])) AS expanded(permission)
  WHERE permission <> ALL(ARRAY[
    'settings_shop_profile', 'settings_receipt_memo', 'settings_receipt_qr',
    'settings_operations', 'settings_demo_data', 'settings_whatsapp_templates'
  ]::text[])
)
WHERE profile.role = 'admin';

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

NOTIFY pgrst, 'reload schema';
