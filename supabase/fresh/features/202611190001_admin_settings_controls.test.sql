-- Owner-run smoke test for 202611190001_admin_settings_controls.sql.
DO $smoke$
DECLARE
  v_default jsonb := '{
    "billingTemplate": "pharmacy-memo",
    "receiptFormat": "thermal80",
    "maxDiscountPaisa": 20000,
    "roleDiscountPercentCap": {"admin": 30, "manager": 15, "cashier": 10, "accountant": 0},
    "expiryWarningDays": 90,
    "memo": {
      "notes": ["Return policy", "Excluded items", "Signature required"],
      "terminalName": "SERVER-PC",
      "showBatchExpiry": false,
      "showBatchNumber": false,
      "showExpiryDate": true,
      "roundNet": "none",
      "printTax": false,
      "duplicateLabel": true,
      "autoPrint": false,
      "numberDigits": 6,
      "printLogo": true
    }
  }'::jsonb;
  v_settings_function text;
  v_guard_function text;
  v_permission_constraint text;
  v_failed boolean := false;
BEGIN
  IF to_regprocedure('public.update_current_shop_settings_v2(jsonb)') IS NULL
     OR to_regprocedure('public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb)') IS NULL
     OR to_regprocedure('tenant_private.validate_shop_settings_payload(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Settings controls functions are missing.';
  END IF;
  PERFORM tenant_private.validate_shop_settings_payload(v_default);
  RAISE NOTICE 'PASS: independent batch and expiry values validate.';

  SELECT pg_catalog.pg_get_functiondef(
    'public.update_current_shop_settings_v2(jsonb)'::regprocedure
  ) INTO v_settings_function;
  SELECT pg_catalog.pg_get_functiondef(
    'tenant_private.enforce_admin_settings_section_guard()'::regprocedure
  ) INTO v_guard_function;
  IF pg_catalog.strpos(v_settings_function, 'settings_receipt_memo') = 0
     OR pg_catalog.strpos(v_settings_function, 'settings_operations') = 0
     OR pg_catalog.strpos(v_guard_function, 'settings_shop_profile') = 0
     OR pg_catalog.strpos(v_guard_function, 'settings_receipt_qr') = 0 THEN
    RAISE EXCEPTION 'One or more Admin Settings section checks are missing from the installed functions.';
  END IF;
  RAISE NOTICE 'PASS: memo, operational, Shop Profile, and Receipt QR section guards are installed.';

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO v_permission_constraint
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::regclass
    AND constraint_row.conname = 'profiles_permissions_valid'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF coalesce(v_permission_constraint, '') NOT LIKE '%settings_shop_profile%'
     OR coalesce(v_permission_constraint, '') NOT LIKE '%settings_receipt_memo%'
     OR coalesce(v_permission_constraint, '') NOT LIKE '%settings_receipt_qr%'
     OR coalesce(v_permission_constraint, '') NOT LIKE '%settings_operations%'
     OR coalesce(v_permission_constraint, '') NOT LIKE '%settings_demo_data%'
     OR coalesce(v_permission_constraint, '') NOT LIKE '%settings_whatsapp_templates%'
     OR coalesce(v_permission_constraint, '') NOT LIKE '%pos_print_sale%'
     OR coalesce(v_permission_constraint, '') NOT LIKE '%pos_print_payment%' THEN
    RAISE EXCEPTION 'Profile permission constraint does not allow the Settings section grants.';
  END IF;
  RAISE NOTICE 'PASS: profile permission constraint allows Settings sections and preserves POS print grants.';

  BEGIN
    PERFORM tenant_private.validate_shop_settings_payload(
      pg_catalog.jsonb_set(v_default, '{memo,showBatchExpiry}', 'true'::jsonb, true)
    );
    v_failed := true;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    RAISE NOTICE 'PASS: legacy combined flag cannot contradict independent settings.';
  END;
  IF v_failed THEN
    RAISE EXCEPTION 'Settings validator accepted contradictory legacy visibility.';
  END IF;

  IF pg_catalog.has_function_privilege('authenticated', 'public.update_current_shop_settings_v2(jsonb)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('authenticated', 'public.update_current_shop_settings(jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.update_current_shop_settings_v2(jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('authenticated', 'public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Settings controls function grants do not match the reviewed role boundaries.';
  END IF;
  RAISE NOTICE 'PASS: authenticated shop settings and service-only platform settings RPC grants.';

  IF EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.role = 'admin'
      AND profile.permissions @> ARRAY['settings']::text[]
      AND NOT profile.permissions @> ARRAY[
        'settings_shop_profile', 'settings_receipt_memo', 'settings_receipt_qr',
        'settings_operations', 'settings_demo_data', 'settings_whatsapp_templates'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'An existing Settings-enabled Admin is missing section grant backfill.';
  END IF;
  RAISE NOTICE 'PASS: existing Settings-enabled Admins received section grant backfill.';

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE NOT trigger_row.tgisinternal
      AND trigger_row.tgname = 'admin_shop_profile_section_guard'
      AND trigger_row.tgrelid = 'public.shops'::regclass
      AND trigger_row.tgenabled IN ('O', 'A')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE NOT trigger_row.tgisinternal
      AND trigger_row.tgname = 'admin_receipt_qr_settings_section_guard'
      AND trigger_row.tgrelid = 'public.shop_receipt_qr_settings'::regclass
      AND trigger_row.tgenabled IN ('O', 'A')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE NOT trigger_row.tgisinternal
      AND trigger_row.tgname = 'admin_receipt_qr_revoke_section_guard'
      AND trigger_row.tgrelid = 'public.sale_receipt_links'::regclass
      AND trigger_row.tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'One or more Admin Settings section guards are missing or disabled.';
  END IF;
  RAISE NOTICE 'PASS: Shop Profile and Receipt QR writes are protected by database guards.';

  IF EXISTS (
    SELECT 1 FROM public.shop_settings AS settings
    WHERE pg_catalog.jsonb_typeof(settings.settings #> '{memo,showBatchNumber}') <> 'boolean'
       OR pg_catalog.jsonb_typeof(settings.settings #> '{memo,showExpiryDate}') <> 'boolean'
  ) THEN
    RAISE EXCEPTION 'A shop settings row is missing independent batch/expiry visibility.';
  END IF;
  RAISE NOTICE 'PASS: all existing shop settings contain independent batch/expiry values.';
END
$smoke$;
