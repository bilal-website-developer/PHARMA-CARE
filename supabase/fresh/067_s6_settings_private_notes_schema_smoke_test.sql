-- Read-only smoke check for S6 package 067.
DO $smoke$
DECLARE
  v_shop_count bigint;
  v_settings_count bigint;
BEGIN
  SELECT count(*) INTO v_shop_count FROM public.shops;
  SELECT count(*) INTO v_settings_count FROM public.shop_settings;

  IF v_shop_count <> v_settings_count THEN
    RAISE EXCEPTION 'Every existing shop must have one settings row.';
  END IF;
  IF to_regclass('public.admin_private_notes') IS NULL
     OR NOT (
       SELECT relation.relrowsecurity
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = 'public.shop_settings'::regclass
     )
     OR NOT (
       SELECT relation.relrowsecurity
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = 'public.admin_private_notes'::regclass
     ) THEN
    RAISE EXCEPTION 'Settings or private-notes RLS is missing.';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.shop_settings', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.shop_settings', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.shop_settings', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.shop_settings', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_settings', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_settings', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_settings', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shop_settings', 'DELETE')
     OR pg_catalog.has_table_privilege('anon', 'public.admin_private_notes', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.admin_private_notes', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.admin_private_notes', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.admin_private_notes', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.admin_private_notes', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.admin_private_notes', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.admin_private_notes', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.admin_private_notes', 'DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.shop_settings', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.shop_settings', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.shop_settings', 'UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.shop_settings', 'DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.admin_private_notes', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.admin_private_notes', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.admin_private_notes', 'UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.admin_private_notes', 'DELETE') THEN
    RAISE EXCEPTION 'Settings/private-note table access differs from package 067.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shop_settings'
      AND column_name IN ('store_name', 'phone', 'address', 'logo_path')
  ) THEN
    RAISE EXCEPTION 'Shop identity fields must remain in shops, not shop_settings.';
  END IF;
END
$smoke$;

SELECT jsonb_build_object(
  'stage', 'S6 package 067 settings/private-notes schema smoke test',
  'status', 'PASS',
  'read_only', true,
  'shop_count', (SELECT count(*) FROM public.shops),
  'shop_settings_count', (SELECT count(*) FROM public.shop_settings),
  'private_note_count', (SELECT count(*) FROM public.admin_private_notes),
  'shop_identity_separate', true,
  'client_select_revoked', true,
  'service_role_select', true
) AS s6_settings_private_notes_schema_smoke;
