-- Runtime S5 test for category/brand writes and bulk-import shop boundaries.
-- All fixtures are rolled back when the transaction succeeds.
-- If an assertion fails and the SQL Editor leaves the transaction open, issue ROLLBACK.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $test$
DECLARE
  v_actor uuid;
  v_super_admin uuid;
  v_shop_id uuid;
  v_test_shop_id uuid;
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_shared_category text;
  v_shared_brand text;
  v_foreign_only_category text;
  v_foreign_only_brand text;
  v_renamed_category text;
  v_renamed_brand text;
  v_foreign_category_id uuid;
  v_foreign_brand_id uuid;
  v_own_category_id uuid;
  v_own_brand_id uuid;
  v_own_foreign_only_category_id uuid;
  v_own_foreign_only_brand_id uuid;
  v_foreign_only_category_id uuid;
  v_foreign_only_brand_id uuid;
  v_foreign_product_id uuid;
  v_foreign_only_product_id uuid;
  v_import_result jsonb;
  v_error text;
  v_signature text;
  v_signatures text[] := ARRAY[
    'public.save_category(uuid,text,boolean)',
    'public.delete_category(uuid)',
    'public.save_brand(uuid,text,boolean)',
    'public.delete_brand(uuid)',
    'public.products_bulk_import(jsonb)'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this smoke test as the reviewed database owner role with RLS bypass.';
  END IF;

  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL
       OR NOT has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS routine
         WHERE routine.oid = to_regprocedure(v_signature)
           AND routine.prosecdef
           AND routine.proconfig @> ARRAY['search_path=public']
       ) THEN
      RAISE EXCEPTION 'Routine % is missing or has unexpected API grants/security settings.', v_signature;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT id, shop_id
  INTO v_actor, v_shop_id
  FROM public.profiles
  WHERE role = 'admin'
    AND is_active = true
    AND deleted_at IS NULL
    AND shop_id IS NOT NULL
  ORDER BY id
  LIMIT 1;
  IF v_actor IS NULL OR v_shop_id IS NULL THEN
    RAISE EXCEPTION 'An active Shop Admin profile is required for this smoke test.';
  END IF;

  SELECT id INTO v_super_admin
  FROM public.profiles
  WHERE role = 'super_admin'
    AND is_active = true
    AND deleted_at IS NULL
  ORDER BY id
  LIMIT 1;
  IF v_super_admin IS NULL THEN
    RAISE EXCEPTION 'An active Super Admin profile is required for this smoke test.';
  END IF;

  INSERT INTO public.shops (name)
  VALUES ('S5 catalog-write test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  v_shared_category := 'S5 shared category ' || v_token;
  v_shared_brand := 'S5 shared brand ' || v_token;
  v_foreign_only_category := 'S5 foreign-only category ' || v_token;
  v_foreign_only_brand := 'S5 foreign-only brand ' || v_token;
  v_renamed_category := 'S5 renamed category ' || v_token;
  v_renamed_brand := 'S5 renamed brand ' || v_token;

  INSERT INTO public.categories (shop_id, name, is_active)
  VALUES (v_test_shop_id, v_shared_category, true)
  RETURNING id INTO v_foreign_category_id;
  INSERT INTO public.categories (shop_id, name, is_active)
  VALUES (v_test_shop_id, v_foreign_only_category, true)
  RETURNING id INTO v_foreign_only_category_id;

  INSERT INTO public.brands (shop_id, name, is_active)
  VALUES (v_test_shop_id, v_shared_brand, true)
  RETURNING id INTO v_foreign_brand_id;
  INSERT INTO public.brands (shop_id, name, is_active)
  VALUES (v_test_shop_id, v_foreign_only_brand, true)
  RETURNING id INTO v_foreign_only_brand_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength, category, company, drug_class, is_active
  )
  VALUES (
    v_test_shop_id, 'S5FOREIGN-' || v_token, 'S5 duplicate product ' || v_token,
    'S5 duplicate generic ' || v_token, '5 mg', v_shared_category, v_shared_brand, 'OTC', true
  )
  RETURNING id INTO v_foreign_product_id;
  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength, category, company, drug_class, is_active
  )
  VALUES (
    v_test_shop_id, 'S5FOREIGNONLY-' || v_token, 'S5 foreign-only product ' || v_token,
    'S5 foreign-only generic ' || v_token, '10 mg',
    v_foreign_only_category, v_foreign_only_brand, 'OTC', true
  )
  RETURNING id INTO v_foreign_only_product_id;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_own_category_id := public.save_category(NULL, v_shared_category, true);
  v_own_brand_id := public.save_brand(NULL, v_shared_brand, true);
  v_own_foreign_only_category_id := public.save_category(NULL, v_foreign_only_category, true);
  v_own_foreign_only_brand_id := public.save_brand(NULL, v_foreign_only_brand, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = v_own_category_id AND shop_id = v_shop_id AND name = v_shared_category
  ) OR NOT EXISTS (
    SELECT 1 FROM public.brands
    WHERE id = v_own_brand_id AND shop_id = v_shop_id AND name = v_shared_brand
  ) THEN
    RAISE EXCEPTION 'Category/brand creation did not assign the caller shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_category(v_foreign_category_id, 'S5 unauthorized category rename', true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Category not found' THEN
    RAISE EXCEPTION 'save_category did not hide a category ID owned by another shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.delete_category(v_foreign_category_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Category not found' THEN
    RAISE EXCEPTION 'delete_category did not hide a category ID owned by another shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_brand(v_foreign_brand_id, 'S5 unauthorized brand rename', true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Brand not found' THEN
    RAISE EXCEPTION 'save_brand did not hide a brand ID owned by another shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.delete_brand(v_foreign_brand_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Brand not found' THEN
    RAISE EXCEPTION 'delete_brand did not hide a brand ID owned by another shop.';
  END IF;

  v_import_result := public.products_bulk_import(jsonb_build_array(jsonb_build_object(
    'code', 'S5IMPORT-' || v_token,
    'brand_name', 'S5 duplicate product ' || v_token,
    'generic_name', 'S5 duplicate generic ' || v_token,
    'strength', '5 mg',
    'category', v_shared_category,
    'company', v_shared_brand,
    'drug_class', 'OTC',
    'unit_name', 'S5 test unit',
    'conversion_factor', 1,
    'price_paisa', 1000
  )));
  IF v_import_result->>'imported_count' IS DISTINCT FROM '1'
     OR NOT EXISTS (
       SELECT 1
       FROM public.medicines
       WHERE shop_id = v_shop_id
         AND code = 'S5IMPORT-' || v_token
         AND brand_name = 'S5 duplicate product ' || v_token
     ) THEN
    RAISE EXCEPTION 'Bulk import did not allow a matching product that exists only in another shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.products_bulk_import(jsonb_build_array(jsonb_build_object(
      'code', 'S5IMPORT-DUP-' || v_token,
      'brand_name', 'S5 duplicate product ' || v_token,
      'generic_name', 'S5 duplicate generic ' || v_token,
      'strength', '5 mg',
      'category', v_shared_category,
      'company', v_shared_brand,
      'drug_class', 'OTC',
      'unit_name', 'S5 duplicate unit',
      'conversion_factor', 1,
      'price_paisa', 1000
    )));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS NULL OR v_error NOT LIKE 'Import contains a duplicate product:%' THEN
    RAISE EXCEPTION 'Bulk import did not reject a duplicate product in the caller shop.';
  END IF;

  PERFORM public.save_category(v_own_category_id, v_renamed_category, true);
  PERFORM public.save_brand(v_own_brand_id, v_renamed_brand, true);
  IF NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE shop_id = v_shop_id
      AND code = 'S5IMPORT-' || v_token
      AND category = v_renamed_category
      AND company = v_renamed_brand
  ) OR NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE shop_id = v_test_shop_id
      AND id = v_foreign_product_id
      AND category = v_shared_category
      AND company = v_shared_brand
  ) THEN
    RAISE EXCEPTION 'Renaming a category/brand changed the wrong shop''s medicines.';
  END IF;

  PERFORM public.delete_category(v_own_foreign_only_category_id);
  PERFORM public.delete_brand(v_own_foreign_only_brand_id);
  IF EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = v_own_foreign_only_category_id AND shop_id = v_shop_id
  ) OR EXISTS (
    SELECT 1 FROM public.brands
    WHERE id = v_own_foreign_only_brand_id AND shop_id = v_shop_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_foreign_only_product_id
      AND shop_id = v_test_shop_id
      AND category = v_foreign_only_category
      AND company = v_foreign_only_brand
  ) THEN
    RAISE EXCEPTION 'A foreign-shop medicine incorrectly blocked or was changed by local deletion.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND action = 'products_bulk_import'
      AND entity_id = (
        SELECT id FROM public.medicines
        WHERE shop_id = v_shop_id AND code = 'S5IMPORT-' || v_token
      )
      AND details->>'imported_count' = '1'
  ) THEN
    RAISE EXCEPTION 'Bulk-import audit event was not recorded in the caller shop.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin::text, 'role', 'authenticated')::text,
    true
  );
  v_error := NULL;
  BEGIN
    PERFORM public.save_category(NULL, 'S5 platform-only category ' || v_token, true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active shop user with categories permission is required' THEN
    RAISE EXCEPTION 'A platform-only Super Admin was not rejected by save_category.';
  END IF;

  RAISE NOTICE 's5_scope_catalog_write_rpcs_smoke_test: all_passed=true';
END
$test$;

ROLLBACK;
