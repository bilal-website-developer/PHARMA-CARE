-- Adds Super Admin-controlled Admin Settings sections and platform shop settings updates.
-- Owner-run only after S6 packages 067/068/073 and Receipt QR package 202611180001 pass.

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this package as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regclass('public.shop_settings') IS NULL
     OR to_regclass('public.shop_receipt_qr_settings') IS NULL
     OR to_regclass('public.sale_receipt_links') IS NULL
     OR to_regclass('public.shop_logo_upload_paths') IS NULL
     OR to_regclass('public.audit_logs') IS NULL
     OR to_regprocedure('public.update_current_shop_settings(jsonb)') IS NULL
     OR to_regprocedure('public.update_current_shop_profile(text,text,text,text)') IS NULL
     OR to_regprocedure('public.can_manage_current_shop_logo(text)') IS NULL
     OR to_regprocedure('public.prepare_current_shop_logo_upload(text)') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.is_platform_admin()') IS NULL THEN
    RAISE EXCEPTION 'Apply S6 packages 067/068/073 and Receipt QR package 202611180001 first.';
  END IF;
  IF to_regprocedure('public.update_current_shop_settings_v2(jsonb)') IS NOT NULL
     OR to_regprocedure('public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('tenant_private.validate_shop_settings_payload(jsonb)') IS NOT NULL
     OR to_regprocedure('tenant_private.enforce_admin_settings_section_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'Settings controls package objects already exist; inspect before applying.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.profiles'::regclass
      AND constraint_row.conname = 'profiles_permissions_valid'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''settings''%'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''pos_print_sale''%'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''pos_print_payment''%'
  ) THEN
    RAISE EXCEPTION 'The expected validated S6 profile permission constraint is missing; inspect before applying.';
  END IF;
END
$preflight$;

UPDATE public.shop_settings AS shop_settings
SET settings = pg_catalog.jsonb_set(
  pg_catalog.jsonb_set(
    shop_settings.settings,
    '{memo,showBatchNumber}',
    coalesce(shop_settings.settings #> '{memo,showBatchExpiry}', 'true'::jsonb),
    true
  ),
  '{memo,showExpiryDate}',
  coalesce(shop_settings.settings #> '{memo,showBatchExpiry}', 'true'::jsonb),
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
      "showBatchNumber": true,
      "showExpiryDate": true,
      "roundNet": "none",
      "printTax": false,
      "duplicateLabel": true,
      "autoPrint": false,
      "numberDigits": 6,
      "printLogo": true
    }
  }'::jsonb;

CREATE FUNCTION tenant_private.validate_shop_settings_payload(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_memo jsonb;
  v_caps jsonb;
  v_number numeric;
  v_max_discount numeric;
  v_expiry_days numeric;
BEGIN
  IF p_settings IS NULL OR pg_catalog.jsonb_typeof(p_settings) <> 'object'
     OR NOT (p_settings ?& ARRAY[
       'billingTemplate', 'receiptFormat', 'maxDiscountPaisa',
       'roleDiscountPercentCap', 'expiryWarningDays', 'memo'
     ]::text[])
     OR p_settings - ARRAY[
       'billingTemplate', 'receiptFormat', 'maxDiscountPaisa',
       'roleDiscountPercentCap', 'expiryWarningDays', 'memo'
     ]::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Settings contain missing or unsupported fields.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_settings->'billingTemplate') <> 'string'
     OR p_settings->>'billingTemplate' NOT IN ('simple', 'classic', 'professional', 'modern', 'pharmacy-memo')
     OR pg_catalog.jsonb_typeof(p_settings->'receiptFormat') <> 'string'
     OR p_settings->>'receiptFormat' NOT IN ('thermal58', 'thermal80', 'a4')
     OR pg_catalog.jsonb_typeof(p_settings->'maxDiscountPaisa') <> 'number'
     OR pg_catalog.jsonb_typeof(p_settings->'expiryWarningDays') <> 'number' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Settings contain invalid template, format, discount, or expiry values.';
  END IF;
  v_max_discount := (p_settings->>'maxDiscountPaisa')::numeric;
  v_expiry_days := (p_settings->>'expiryWarningDays')::numeric;
  IF v_max_discount < 0 OR v_max_discount > 20000 OR pg_catalog.trunc(v_max_discount) <> v_max_discount
     OR v_expiry_days < 1 OR v_expiry_days > 365 OR pg_catalog.trunc(v_expiry_days) <> v_expiry_days THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Discount or expiry settings are outside the approved bounds.';
  END IF;

  v_caps := p_settings->'roleDiscountPercentCap';
  IF pg_catalog.jsonb_typeof(v_caps) <> 'object'
     OR NOT (v_caps ?& ARRAY['admin', 'manager', 'cashier', 'accountant']::text[])
     OR v_caps - ARRAY['admin', 'manager', 'cashier', 'accountant']::text[] <> '{}'::jsonb
     OR pg_catalog.jsonb_typeof(v_caps->'admin') <> 'number'
     OR pg_catalog.jsonb_typeof(v_caps->'manager') <> 'number'
     OR pg_catalog.jsonb_typeof(v_caps->'cashier') <> 'number'
     OR pg_catalog.jsonb_typeof(v_caps->'accountant') <> 'number' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Discount caps exceed the approved role limits.';
  END IF;
  IF (v_caps->>'admin')::numeric NOT BETWEEN 0 AND 30
     OR (v_caps->>'manager')::numeric NOT BETWEEN 0 AND 15
     OR (v_caps->>'cashier')::numeric NOT BETWEEN 0 AND 10
     OR (v_caps->>'accountant')::numeric <> 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Discount caps exceed the approved role limits.';
  END IF;

  v_memo := p_settings->'memo';
  IF pg_catalog.jsonb_typeof(v_memo) <> 'object'
     OR NOT (v_memo ?& ARRAY[
       'notes', 'terminalName', 'showBatchExpiry', 'showBatchNumber', 'showExpiryDate',
       'roundNet', 'printTax', 'duplicateLabel', 'autoPrint', 'numberDigits', 'printLogo'
     ]::text[])
     OR v_memo - ARRAY[
       'notes', 'terminalName', 'showBatchExpiry', 'showBatchNumber', 'showExpiryDate',
       'roundNet', 'printTax', 'duplicateLabel', 'autoPrint', 'numberDigits', 'printLogo'
     ]::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo settings contain missing or unsupported fields.';
  END IF;
  IF pg_catalog.jsonb_typeof(v_memo->'notes') <> 'array' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo notes must be an array.';
  END IF;
  IF pg_catalog.jsonb_array_length(v_memo->'notes') <> 3
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements(v_memo->'notes') AS note(value)
       WHERE pg_catalog.jsonb_typeof(note.value) <> 'string'
         OR pg_catalog.btrim(note.value #>> '{}') = ''
         OR pg_catalog.length(note.value #>> '{}') > 200
     )
     OR pg_catalog.jsonb_typeof(v_memo->'terminalName') <> 'string'
     OR pg_catalog.btrim(v_memo->>'terminalName') = ''
     OR pg_catalog.length(v_memo->>'terminalName') > 80
     OR pg_catalog.jsonb_typeof(v_memo->'showBatchExpiry') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'showBatchNumber') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'showExpiryDate') <> 'boolean'
     OR (v_memo->>'showBatchExpiry')::boolean
        IS DISTINCT FROM ((v_memo->>'showBatchNumber')::boolean AND (v_memo->>'showExpiryDate')::boolean)
     OR pg_catalog.jsonb_typeof(v_memo->'roundNet') <> 'string'
     OR v_memo->>'roundNet' NOT IN ('none', '1', '5', '10')
     OR pg_catalog.jsonb_typeof(v_memo->'printTax') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'duplicateLabel') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'autoPrint') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'printLogo') <> 'boolean'
     OR pg_catalog.jsonb_typeof(v_memo->'numberDigits') <> 'number' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo settings contain invalid values.';
  END IF;
  v_number := (v_memo->>'numberDigits')::numeric;
  IF v_number < 1 OR v_number > 20 OR pg_catalog.trunc(v_number) <> v_number THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Memo number digits must be an integer from 1 to 20.';
  END IF;
  RETURN p_settings;
END
$function$;

CREATE FUNCTION public.update_current_shop_settings_v2(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_shop_id uuid;
  v_actor_role text;
  v_actor_permissions text[];
  v_old_settings jsonb;
  v_new_settings jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An authenticated shop profile is required.';
  END IF;
  v_shop_id := tenant_private.current_shop_id();
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active shop assignment is required.';
  END IF;
  SELECT profile.role, profile.permissions
    INTO v_actor_role, v_actor_permissions
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id AND profile.shop_id = v_shop_id
    AND profile.is_active AND profile.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'manager')
     OR NOT (coalesce(v_actor_permissions, ARRAY[]::text[]) @> ARRAY['settings']::text[]) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Settings permission is required.';
  END IF;

  v_new_settings := tenant_private.validate_shop_settings_payload(p_settings);
  SELECT settings.settings INTO v_old_settings
  FROM public.shop_settings AS settings
  WHERE settings.shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'Shop settings are not initialized.';
  END IF;

  IF v_actor_role = 'admin' THEN
    IF (
      v_new_settings->'billingTemplate' IS DISTINCT FROM v_old_settings->'billingTemplate'
      OR v_new_settings->'receiptFormat' IS DISTINCT FROM v_old_settings->'receiptFormat'
      OR v_new_settings->'memo' IS DISTINCT FROM v_old_settings->'memo'
    ) AND NOT (coalesce(v_actor_permissions, ARRAY[]::text[]) @> ARRAY['settings_receipt_memo']::text[]) THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'Receipt and memo settings access is required.';
    END IF;
    IF (
      v_new_settings->'maxDiscountPaisa' IS DISTINCT FROM v_old_settings->'maxDiscountPaisa'
      OR v_new_settings->'roleDiscountPercentCap' IS DISTINCT FROM v_old_settings->'roleDiscountPercentCap'
      OR v_new_settings->'expiryWarningDays' IS DISTINCT FROM v_old_settings->'expiryWarningDays'
    ) AND NOT (coalesce(v_actor_permissions, ARRAY[]::text[]) @> ARRAY['settings_operations']::text[]) THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'Operational settings access is required.';
    END IF;
  END IF;

  UPDATE public.shop_settings
  SET settings = v_new_settings,
      updated_by = v_actor_id,
      updated_at = pg_catalog.clock_timestamp()
  WHERE shop_id = v_shop_id;
  RETURN v_new_settings;
END
$function$;

CREATE FUNCTION public.platform_update_shop_settings(
  p_actor_id uuid,
  p_shop_id uuid,
  p_settings jsonb,
  p_receipt_qr_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_shop_status text;
  v_settings_before jsonb;
  v_settings_after jsonb;
  v_qr_before public.shop_receipt_qr_settings%ROWTYPE;
  v_qr_after public.shop_receipt_qr_settings%ROWTYPE;
  v_enabled boolean;
  v_lifetime integer;
  v_names boolean;
  v_placement text;
  v_base_url text;
BEGIN
  SELECT profile.* INTO v_actor
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id AND profile.role = 'super_admin'
    AND profile.shop_id IS NULL AND profile.is_active AND profile.deleted_at IS NULL
  FOR UPDATE;
  IF p_actor_id IS NULL OR v_actor.id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active platform Super Admin is required.';
  END IF;
  SELECT shop.status INTO v_shop_status
  FROM public.shops AS shop
  WHERE shop.id = p_shop_id
  FOR UPDATE;
  IF NOT FOUND OR v_shop_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'The target shop is unavailable.';
  END IF;

  v_settings_after := tenant_private.validate_shop_settings_payload(p_settings);
  IF p_receipt_qr_settings IS NULL
     OR pg_catalog.jsonb_typeof(p_receipt_qr_settings) <> 'object'
     OR NOT (p_receipt_qr_settings ?& ARRAY[
       'publicReceiptsEnabled', 'linkLifetimeDays', 'showMedicineNames', 'qrPlacement', 'qrBaseUrl'
     ]::text[])
     OR p_receipt_qr_settings - ARRAY[
       'publicReceiptsEnabled', 'linkLifetimeDays', 'showMedicineNames', 'qrPlacement', 'qrBaseUrl'
     ]::text[] <> '{}'::jsonb
     OR pg_catalog.jsonb_typeof(p_receipt_qr_settings->'publicReceiptsEnabled') <> 'boolean'
     OR pg_catalog.jsonb_typeof(p_receipt_qr_settings->'linkLifetimeDays') <> 'number'
     OR pg_catalog.jsonb_typeof(p_receipt_qr_settings->'showMedicineNames') <> 'boolean'
     OR pg_catalog.jsonb_typeof(p_receipt_qr_settings->'qrPlacement') <> 'string'
     OR pg_catalog.jsonb_typeof(p_receipt_qr_settings->'qrBaseUrl') <> 'string' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Receipt QR settings are invalid.';
  END IF;
  v_enabled := (p_receipt_qr_settings->>'publicReceiptsEnabled')::boolean;
  v_lifetime := (p_receipt_qr_settings->>'linkLifetimeDays')::integer;
  v_names := (p_receipt_qr_settings->>'showMedicineNames')::boolean;
  v_placement := p_receipt_qr_settings->>'qrPlacement';
  v_base_url := pg_catalog.btrim(p_receipt_qr_settings->>'qrBaseUrl');
  IF v_lifetime NOT BETWEEN 1 AND 3650
     OR (v_enabled AND v_base_url = '')
     OR v_placement NOT IN ('footer', 'after_totals', 'below_header')
     OR (v_base_url <> '' AND v_base_url !~ '^https://[^/?#]+/?$')
     OR v_base_url ~ '^https://[^/?#]*@'
     OR v_base_url ~ '[[:space:]]'
     OR pg_catalog.length(v_base_url) > 255 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Receipt QR lifetime, placement, or HTTPS base URL is invalid.';
  END IF;

  SELECT settings.settings INTO v_settings_before
  FROM public.shop_settings AS settings
  WHERE settings.shop_id = p_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'Shop settings are not initialized.';
  END IF;
  SELECT settings.* INTO v_qr_before
  FROM public.shop_receipt_qr_settings AS settings
  WHERE settings.shop_id = p_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.shop_receipt_qr_settings (shop_id)
    VALUES (p_shop_id)
    RETURNING * INTO v_qr_before;
  END IF;

  UPDATE public.shop_settings AS settings
  SET settings = v_settings_after,
      updated_by = p_actor_id,
      updated_at = pg_catalog.clock_timestamp()
  WHERE settings.shop_id = p_shop_id;
  INSERT INTO public.shop_receipt_qr_settings (
    shop_id, public_receipts_enabled, link_lifetime_days, show_medicine_names,
    qr_placement, qr_base_url, updated_by, updated_at
  ) VALUES (
    p_shop_id, v_enabled, v_lifetime, v_names, v_placement, v_base_url,
    p_actor_id, pg_catalog.clock_timestamp()
  )
  ON CONFLICT (shop_id) DO UPDATE SET
    public_receipts_enabled = EXCLUDED.public_receipts_enabled,
    link_lifetime_days = EXCLUDED.link_lifetime_days,
    show_medicine_names = EXCLUDED.show_medicine_names,
    qr_placement = EXCLUDED.qr_placement,
    qr_base_url = EXCLUDED.qr_base_url,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_qr_after;

  INSERT INTO public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  VALUES (
    p_shop_id, p_actor_id, 'PLATFORM_SHOP_SETTINGS_UPDATED', 'shop_settings', p_shop_id,
    pg_catalog.jsonb_build_object(
      'before', pg_catalog.jsonb_build_object(
        'settings', v_settings_before,
        'receiptQrSettings', pg_catalog.to_jsonb(v_qr_before)
      ),
      'after', pg_catalog.jsonb_build_object(
        'settings', v_settings_after,
        'receiptQrSettings', pg_catalog.to_jsonb(v_qr_after)
      )
    )
  );
  RETURN pg_catalog.jsonb_build_object(
    'settings', v_settings_after,
    'receiptQrSettings', pg_catalog.jsonb_build_object(
      'publicReceiptsEnabled', v_qr_after.public_receipts_enabled,
      'linkLifetimeDays', v_qr_after.link_lifetime_days,
      'showMedicineNames', v_qr_after.show_medicine_names,
      'qrPlacement', v_qr_after.qr_placement,
      'qrBaseUrl', v_qr_after.qr_base_url
    )
  );
END
$function$;

CREATE FUNCTION tenant_private.enforce_admin_settings_section_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor public.profiles%ROWTYPE;
  v_target_shop_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT profile.* INTO v_actor
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id AND profile.is_active AND profile.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active shop profile is required.';
  END IF;
  IF v_actor.role = 'super_admin' AND v_actor.shop_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'shops' THEN
    v_target_shop_id := OLD.id;
    IF NEW.name IS NOT DISTINCT FROM OLD.name
       AND NEW.phone IS NOT DISTINCT FROM OLD.phone
       AND NEW.address IS NOT DISTINCT FROM OLD.address
       AND NEW.logo_path IS NOT DISTINCT FROM OLD.logo_path THEN
      RETURN NEW;
    END IF;
    IF v_actor.role = 'admin' AND v_actor.shop_id = v_target_shop_id
       AND coalesce(v_actor.permissions, ARRAY[]::text[]) @> ARRAY['settings', 'settings_shop_profile']::text[] THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING errcode = '42501', message = 'Shop Profile settings access is required.';
  ELSIF TG_TABLE_NAME = 'shop_receipt_qr_settings' THEN
    v_target_shop_id := OLD.shop_id;
    IF v_actor.shop_id IS DISTINCT FROM v_target_shop_id THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'Receipt QR settings are outside your shop.';
    END IF;
    IF v_actor.role = 'manager'
       AND coalesce(v_actor.permissions, ARRAY[]::text[]) @> ARRAY['settings']::text[] THEN
      RETURN NEW;
    END IF;
    IF v_actor.role = 'admin'
       AND coalesce(v_actor.permissions, ARRAY[]::text[]) @> ARRAY['settings', 'settings_receipt_qr']::text[] THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING errcode = '42501', message = 'Receipt QR settings access is required.';
  ELSIF TG_TABLE_NAME = 'sale_receipt_links' THEN
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
       OR NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at THEN
      RETURN NEW;
    END IF;
    v_target_shop_id := OLD.shop_id;
    IF v_actor.shop_id IS DISTINCT FROM v_target_shop_id THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'Receipt QR link is outside your shop.';
    END IF;
    IF v_actor.role = 'manager'
       AND coalesce(v_actor.permissions, ARRAY[]::text[]) && ARRAY['pos', 'sales_history']::text[] THEN
      RETURN NEW;
    END IF;
    IF v_actor.role = 'admin'
       AND coalesce(v_actor.permissions, ARRAY[]::text[]) @> ARRAY['settings', 'settings_receipt_qr']::text[]
       AND coalesce(v_actor.permissions, ARRAY[]::text[]) && ARRAY['pos', 'sales_history']::text[] THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING errcode = '42501', message = 'Receipt QR regeneration access is required.';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER admin_shop_profile_section_guard
BEFORE UPDATE OF name, phone, address, logo_path ON public.shops
FOR EACH ROW EXECUTE FUNCTION tenant_private.enforce_admin_settings_section_guard();

CREATE TRIGGER admin_receipt_qr_settings_section_guard
BEFORE UPDATE ON public.shop_receipt_qr_settings
FOR EACH ROW EXECUTE FUNCTION tenant_private.enforce_admin_settings_section_guard();

CREATE TRIGGER admin_receipt_qr_revoke_section_guard
BEFORE UPDATE ON public.sale_receipt_links
FOR EACH ROW EXECUTE FUNCTION tenant_private.enforce_admin_settings_section_guard();

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
        AND profile.permissions @> ARRAY['settings', 'settings_shop_profile']::text[]
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
    AND profile.permissions @> ARRAY['settings', 'settings_shop_profile']::text[];
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'A Shop Admin with Shop Profile access is required.';
  END IF;
  v_object_name := auth.uid()::text || '/' || pg_catalog.gen_random_uuid()::text || '.' || p_extension;
  INSERT INTO public.shop_logo_upload_paths (object_name, shop_id, created_by)
  VALUES (v_object_name, v_shop_id, auth.uid());
  RETURN v_object_name;
END
$function$;

REVOKE ALL ON FUNCTION tenant_private.validate_shop_settings_payload(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tenant_private.enforce_admin_settings_section_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_current_shop_settings_v2(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_current_shop_settings(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_manage_current_shop_logo(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.prepare_current_shop_logo_upload(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_current_shop_settings_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_current_shop_logo(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_current_shop_logo_upload(text) TO authenticated;

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
      'settings_shop_profile',
      'settings_receipt_memo',
      'settings_receipt_qr',
      'settings_operations',
      'settings_demo_data',
      'settings_whatsapp_templates',
      'pos_print_sale',
      'pos_print_payment'
    ]::text[]
    AND (
      NOT (permissions && ARRAY['pos_print_sale', 'pos_print_payment']::text[])
      OR permissions @> ARRAY['pos']::text[]
    )
  );

UPDATE public.profiles AS profile
SET permissions = ARRAY(
  SELECT DISTINCT permission
  FROM pg_catalog.unnest(
    coalesce(profile.permissions, ARRAY[]::text[])
      || ARRAY[
        'settings_shop_profile',
        'settings_receipt_memo',
        'settings_receipt_qr',
        'settings_operations',
        'settings_demo_data',
        'settings_whatsapp_templates'
      ]::text[]
  ) AS expanded(permission)
  ORDER BY permission
)
WHERE profile.role = 'admin'
  AND profile.permissions @> ARRAY['settings']::text[];

DO $postflight$
BEGIN
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.update_current_shop_settings_v2(jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.update_current_shop_settings(jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.update_current_shop_settings_v2(jsonb)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.can_manage_current_shop_logo(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.prepare_current_shop_logo_upload(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.can_manage_current_shop_logo(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.prepare_current_shop_logo_upload(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.can_manage_current_shop_logo(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.prepare_current_shop_logo_upload(text)', 'EXECUTE')
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
       WHERE NOT trigger_row.tgisinternal
         AND trigger_row.tgname = 'admin_shop_profile_section_guard'
         AND trigger_row.tgenabled IN ('O', 'A')
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
       WHERE NOT trigger_row.tgisinternal
         AND trigger_row.tgname = 'admin_receipt_qr_settings_section_guard'
         AND trigger_row.tgenabled IN ('O', 'A')
     )
     OR EXISTS (
       SELECT 1 FROM public.profiles AS profile
       WHERE profile.role = 'admin'
         AND profile.permissions @> ARRAY['settings']::text[]
         AND NOT profile.permissions @> ARRAY[
           'settings_shop_profile', 'settings_receipt_memo', 'settings_receipt_qr',
           'settings_operations', 'settings_demo_data', 'settings_whatsapp_templates'
         ]::text[]
     )
     OR EXISTS (
       SELECT 1 FROM public.shop_settings AS settings
       WHERE pg_catalog.jsonb_typeof(settings.settings #> '{memo,showBatchNumber}') <> 'boolean'
          OR pg_catalog.jsonb_typeof(settings.settings #> '{memo,showExpiryDate}') <> 'boolean'
     ) THEN
    RAISE EXCEPTION 'Settings controls package postflight verification failed.';
  END IF;
END
$postflight$;

NOTIFY pgrst, 'reload schema';
