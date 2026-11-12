-- Runtime S5 test for save_medicine shop and nested-ID boundaries.
-- Test-shop rows are temporary to this transaction; ROLLBACK removes all fixtures.
-- If an assertion fails and the SQL Editor leaves the transaction open, issue ROLLBACK before continuing.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $test$
DECLARE
  v_actor uuid;
  v_super_admin uuid;
  v_shop_id uuid;
  v_test_shop_id uuid;
  v_category text;
  v_brand text;
  v_foreign_category text;
  v_foreign_brand text;
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_code text;
  v_own_medicine uuid;
  v_foreign_medicine uuid;
  v_own_unit uuid;
  v_foreign_unit uuid;
  v_values jsonb;
  v_units jsonb;
  v_error text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this smoke test as the reviewed database owner role with RLS bypass.';
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

  SELECT name INTO v_category
  FROM public.categories
  WHERE shop_id = v_shop_id AND is_active
  ORDER BY name
  LIMIT 1;
  SELECT name INTO v_brand
  FROM public.brands
  WHERE shop_id = v_shop_id AND is_active
  ORDER BY name
  LIMIT 1;
  IF v_category IS NULL OR v_brand IS NULL THEN
    RAISE EXCEPTION 'An active caller-shop category and brand are required for this smoke test.';
  END IF;

  INSERT INTO public.shops (name)
  VALUES ('S5 save_medicine test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  v_foreign_category := 'S5 category ' || v_token;
  v_foreign_brand := 'S5 brand ' || v_token;
  INSERT INTO public.categories (shop_id, name, is_active)
  VALUES (v_test_shop_id, v_foreign_category, true);
  INSERT INTO public.brands (shop_id, name, is_active)
  VALUES (v_test_shop_id, v_foreign_brand, true);

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_test_shop_id, 'S5FOREIGN-' || v_token, 'S5 foreign ' || v_token,
    'S5 foreign test', '1 mg', v_foreign_category, v_foreign_brand, 'OTC', true
  )
  RETURNING id INTO v_foreign_medicine;

  INSERT INTO public.medicine_units (
    shop_id, medicine_id, name, conversion_factor, is_default_sale_unit, price_paisa
  )
  VALUES (v_test_shop_id, v_foreign_medicine, 'Foreign unit', 1, true, 1000)
  RETURNING id INTO v_foreign_unit;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_code := 'S5SAVE-' || v_token;
  v_values := jsonb_build_object(
    'code', v_code,
    'barcode', NULL,
    'brand_name', 'S5 own ' || v_token,
    'generic_name', 'S5 own medicine',
    'strength', '1 mg',
    'category', v_category,
    'company', v_brand,
    'drug_class', 'OTC',
    'storage_condition', 'ROOM_TEMPERATURE',
    'rack_location', '',
    'min_stock_alert', 0,
    'requires_prescription', false,
    'is_active', true
  );
  v_units := jsonb_build_array(jsonb_build_object(
    'name', 'S5 unit',
    'conversion_factor', 1,
    'is_default_sale_unit', true,
    'price_paisa', 1000
  ));

  v_own_medicine := public.save_medicine(NULL, v_values, v_units);
  IF NOT EXISTS (
    SELECT 1
    FROM public.medicines
    WHERE id = v_own_medicine AND shop_id = v_shop_id AND code = v_code
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.medicine_units
    WHERE medicine_id = v_own_medicine AND shop_id = v_shop_id AND is_default_sale_unit
  ) THEN
    RAISE EXCEPTION 'save_medicine did not create the medicine and unit in the caller shop.';
  END IF;

  SELECT id INTO v_own_unit
  FROM public.medicine_units
  WHERE medicine_id = v_own_medicine AND shop_id = v_shop_id;
  v_values := jsonb_set(
    v_values,
    '{brand_name}',
    to_jsonb(('S5 updated ' || v_token)::text)
  );
  v_units := jsonb_build_array(jsonb_build_object(
    'id', v_own_unit,
    'name', 'S5 unit updated',
    'conversion_factor', 1,
    'is_default_sale_unit', true,
    'price_paisa', 1200
  ));
  PERFORM public.save_medicine(v_own_medicine, v_values, v_units);
  IF NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_own_medicine AND shop_id = v_shop_id
      AND brand_name = 'S5 updated ' || v_token
  ) OR NOT EXISTS (
    SELECT 1 FROM public.medicine_units
    WHERE id = v_own_unit AND medicine_id = v_own_medicine
      AND shop_id = v_shop_id AND name = 'S5 unit updated' AND price_paisa = 1200
  ) THEN
    RAISE EXCEPTION 'save_medicine did not update caller-shop medicine and unit rows.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_medicine(
      NULL,
      jsonb_set(v_values, '{category}', to_jsonb(v_foreign_category)),
      v_units
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Select an active category' THEN
    RAISE EXCEPTION 'save_medicine did not reject a category owned by another shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_medicine(
      NULL,
      jsonb_set(v_values, '{company}', to_jsonb(v_foreign_brand)),
      v_units
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Select an active manufacturer' THEN
    RAISE EXCEPTION 'save_medicine did not reject a brand owned by another shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_medicine(v_foreign_medicine, v_values, v_units);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Medicine not found' THEN
    RAISE EXCEPTION 'save_medicine did not hide a medicine ID owned by another shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_medicine(
      v_own_medicine,
      jsonb_set(v_values, '{brand_name}', to_jsonb('S5 attempted update'::text)),
      jsonb_build_array(jsonb_build_object(
        'id', v_foreign_unit,
        'name', 'Changed foreign unit',
        'conversion_factor', 1,
        'is_default_sale_unit', true,
        'price_paisa', 1000
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'A selected unit does not belong to this medicine' THEN
    RAISE EXCEPTION 'save_medicine did not reject a unit ID owned by another shop.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.medicines
    WHERE id = v_own_medicine AND shop_id = v_shop_id AND code = v_code
      AND brand_name = 'S5 updated ' || v_token
  ) OR NOT EXISTS (
    SELECT 1 FROM public.medicine_units
    WHERE id = v_own_unit AND medicine_id = v_own_medicine
      AND shop_id = v_shop_id AND name = 'S5 unit updated'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.medicine_units
    WHERE id = v_foreign_unit AND medicine_id = v_foreign_medicine
      AND shop_id = v_test_shop_id AND name = 'Foreign unit'
  ) THEN
    RAISE EXCEPTION 'A rejected nested-unit update changed a medicine or unit.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin::text, 'role', 'authenticated')::text,
    true
  );
  v_error := NULL;
  BEGIN
    PERFORM public.save_medicine(NULL, v_values, v_units);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active shop user with products permission is required' THEN
    RAISE EXCEPTION 'save_medicine did not reject the platform-only Super Admin.';
  END IF;

  RAISE NOTICE 's5_save_medicine_smoke_test: all_passed=true';
END
$test$;

ROLLBACK;
