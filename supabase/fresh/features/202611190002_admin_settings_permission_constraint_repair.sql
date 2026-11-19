-- Repair a partially applied 202611190001 package that stopped while backfilling Admin grants.
-- Run only when the Settings-control functions and all three triggers already exist.
BEGIN;

DO $preflight$
DECLARE
  v_constraint_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this repair as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regprocedure('public.update_current_shop_settings_v2(jsonb)') IS NULL
     OR to_regprocedure('public.platform_update_shop_settings(uuid,uuid,jsonb,jsonb)') IS NULL
     OR to_regprocedure('tenant_private.validate_shop_settings_payload(jsonb)') IS NULL
     OR to_regprocedure('tenant_private.enforce_admin_settings_section_guard()') IS NULL THEN
    RAISE EXCEPTION 'Settings controls functions are not fully installed; do not use the partial-apply repair.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.shops'::regclass
         AND tgname = 'admin_shop_profile_section_guard'
         AND NOT tgisinternal AND tgenabled IN ('O', 'A')
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.shop_receipt_qr_settings'::regclass
         AND tgname = 'admin_receipt_qr_settings_section_guard'
         AND NOT tgisinternal AND tgenabled IN ('O', 'A')
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.sale_receipt_links'::regclass
         AND tgname = 'admin_receipt_qr_revoke_section_guard'
         AND NOT tgisinternal AND tgenabled IN ('O', 'A')
     ) THEN
    RAISE EXCEPTION 'Settings controls triggers are incomplete; do not use the partial-apply repair.';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO v_constraint_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::regclass
    AND constraint_row.conname = 'profiles_permissions_valid'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF v_constraint_definition IS NULL
     OR v_constraint_definition NOT LIKE '%''settings''%'
     OR v_constraint_definition NOT LIKE '%''manage_users''%'
     OR v_constraint_definition NOT LIKE '%''pos_print_sale''%'
     OR v_constraint_definition NOT LIKE '%''pos_print_payment''%' THEN
    RAISE EXCEPTION 'The existing profile permission constraint is not the expected S6 constraint; inspect before repair.';
  END IF;
END
$preflight$;

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
  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.role = 'admin'
      AND profile.permissions @> ARRAY['settings']::text[]
      AND NOT profile.permissions @> ARRAY[
        'settings_shop_profile', 'settings_receipt_memo', 'settings_receipt_qr',
        'settings_operations', 'settings_demo_data', 'settings_whatsapp_templates'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'Settings section grants were not fully backfilled.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.profiles'::regclass
      AND constraint_row.conname = 'profiles_permissions_valid'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%''settings_whatsapp_templates''%'
  ) THEN
    RAISE EXCEPTION 'The Settings section permission constraint was not installed.';
  END IF;
END
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
