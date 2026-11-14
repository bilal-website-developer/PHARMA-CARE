-- Runtime S5 test for products_bulk_update shop boundaries and audit attribution.
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
  v_own_category text;
  v_target_category text;
  v_foreign_category text;
  v_own_product_one uuid;
  v_own_product_two uuid;
  v_foreign_product uuid;
  v_updated integer;
  v_error text;
  v_signature text := 'public.products_bulk_update(uuid[],text,text)';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this smoke test as the reviewed database owner role with RLS bypass.';
  END IF;
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
    RAISE EXCEPTION 'products_bulk_update is missing or has unexpected API grants/security settings.';
  END IF;

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
  VALUES ('S5 bulk-update test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  v_own_category := 'S5 own category ' || v_token;
  v_target_category := 'S5 target category ' || v_token;
  v_foreign_category := 'S5 foreign category ' || v_token;

  INSERT INTO public.categories (shop_id, name, is_active)
  VALUES
    (v_shop_id, v_own_category, true),
    (v_shop_id, v_target_category, true),
    (v_test_shop_id, v_foreign_category, true);

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_shop_id, 'S5BULK-A-' || v_token, 'S5 bulk A ' || v_token,
    'S5 bulk test A', '1 mg', v_own_category, 'S5 bulk test', 'OTC', true
  )
  RETURNING id INTO v_own_product_one;
  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_shop_id, 'S5BULK-B-' || v_token, 'S5 bulk B ' || v_token,
    'S5 bulk test B', '1 mg', v_own_category, 'S5 bulk test', 'OTC', true
  )
  RETURNING id INTO v_own_product_two;
  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_test_shop_id, 'S5BULK-X-' || v_token, 'S5 bulk foreign ' || v_token,
    'S5 bulk foreign test', '1 mg', v_foreign_category, 'S5 bulk test', 'OTC', true
  )
  RETURNING id INTO v_foreign_product;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_error := NULL;
  BEGIN
    PERFORM public.products_bulk_update(
      ARRAY[v_own_product_one, v_foreign_product],
      'deactivate',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'One or more selected products no longer exist' THEN
    RAISE EXCEPTION 'Bulk update did not reject a selection containing a foreign-shop medicine.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_own_product_one AND shop_id = v_shop_id AND is_active
  ) OR NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_foreign_product AND shop_id = v_test_shop_id AND is_active
  ) THEN
    RAISE EXCEPTION 'A rejected mixed-shop update changed a product.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.products_bulk_update(
      ARRAY[v_own_product_one],
      'category',
      v_foreign_category
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Select an active category' THEN
    RAISE EXCEPTION 'Bulk update accepted a category owned only by another shop.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_own_product_one AND shop_id = v_shop_id AND category = v_own_category
  ) THEN
    RAISE EXCEPTION 'A rejected foreign-category update changed a product.';
  END IF;

  v_updated := public.products_bulk_update(
    ARRAY[v_own_product_one, v_own_product_two],
    'category',
    v_target_category
  );
  IF v_updated <> 2 OR NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_own_product_one AND shop_id = v_shop_id AND category = v_target_category
  ) OR NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_own_product_two AND shop_id = v_shop_id AND category = v_target_category
  ) OR NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_foreign_product AND shop_id = v_test_shop_id AND category = v_foreign_category
  ) THEN
    RAISE EXCEPTION 'Bulk category update did not affect only the selected caller-shop medicines.';
  END IF;

  v_updated := public.products_bulk_update(
    ARRAY[v_own_product_one],
    'deactivate',
    NULL
  );
  IF v_updated <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_own_product_one AND shop_id = v_shop_id AND NOT is_active
  ) OR NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_foreign_product AND shop_id = v_test_shop_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Bulk deactivate did not affect only the caller-shop medicine.';
  END IF;

  v_updated := public.products_bulk_update(
    ARRAY[v_own_product_one],
    'activate',
    NULL
  );
  IF v_updated <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_own_product_one AND shop_id = v_shop_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Bulk activate did not reactivate the caller-shop medicine.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND action = 'products_bulk_category'
      AND entity_id = v_own_product_one
      AND details->>'updated_count' = '2'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND action = 'products_bulk_deactivate'
      AND entity_id = v_own_product_one
      AND details->>'updated_count' = '1'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND action = 'products_bulk_activate'
      AND entity_id = v_own_product_one
      AND details->>'updated_count' = '1'
  ) THEN
    RAISE EXCEPTION 'Bulk-update audit events were not recorded in the caller shop.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin::text, 'role', 'authenticated')::text,
    true
  );
  v_error := NULL;
  BEGIN
    PERFORM public.products_bulk_update(
      ARRAY[v_own_product_one],
      'deactivate',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active user with products permission is required' THEN
    RAISE EXCEPTION 'A platform-only Super Admin was not rejected by products_bulk_update.';
  END IF;

  RAISE NOTICE 's5_scope_products_bulk_update_smoke_test: all_passed=true';
END
$test$;

ROLLBACK;
