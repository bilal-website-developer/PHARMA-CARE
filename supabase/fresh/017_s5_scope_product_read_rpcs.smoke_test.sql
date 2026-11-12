-- Runtime S5 test for the first product/catalog read batch.
-- Creates temporary rows in a second shop inside this transaction and rolls
-- everything back; no second shop or fixture data persists.
-- If an assertion fails and the SQL Editor leaves the transaction open, issue ROLLBACK before continuing.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $test$
DECLARE
  v_actor uuid;
  v_super_admin uuid;
  v_shop_id uuid;
  v_test_shop_id uuid;
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_code text;
  v_own_barcode text;
  v_other_barcode text;
  v_own_medicine uuid;
  v_other_medicine uuid;
  v_list jsonb;
  v_catalog jsonb;
  v_stats jsonb;
  v_import jsonb;
  v_expected_active bigint;
  v_expected_expiring bigint;
  v_expected_stock_value numeric;
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

  INSERT INTO public.shops (name)
  VALUES ('S5 temporary isolation test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  v_code := 'S5-' || v_token;
  v_own_barcode := 'S5A-' || v_token;
  v_other_barcode := 'S5B-' || v_token;

  INSERT INTO public.medicines (
    shop_id, code, barcode, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_shop_id, v_code, v_own_barcode, 'S5 own ' || v_token,
    'S5 own test', '1 mg', 'S5 test', 'S5 test', 'OTC', true
  )
  RETURNING id INTO v_own_medicine;

  INSERT INTO public.medicines (
    shop_id, code, barcode, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_test_shop_id, v_code, v_other_barcode, 'S5 other ' || v_token,
    'S5 other test', '1 mg', 'S5 test', 'S5 test', 'OTC', true
  )
  RETURNING id INTO v_other_medicine;

  INSERT INTO public.medicine_units (
    shop_id, medicine_id, name, conversion_factor, is_default_sale_unit, price_paisa
  )
  VALUES
    (v_shop_id, v_own_medicine, 'S5 unit', 1, true, 1000),
    (v_test_shop_id, v_other_medicine, 'S5 unit', 1, true, 1000);

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES
    (v_shop_id, v_own_medicine, v_token || '-A', current_date + 30, current_date, 100, 1000, 10, 10, 'ACTIVE'),
    (v_test_shop_id, v_other_medicine, v_token || '-B', current_date + 30, current_date, 100, 1000, 10, 10, 'ACTIVE');

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_list := public.products_list(
    p_search => v_code,
    p_status => 'all',
    p_page => 1,
    p_page_size => 200
  );
  IF NOT (v_list->'rows' @> jsonb_build_array(jsonb_build_object('id', v_own_medicine::text)))
     OR (v_list->'rows' @> jsonb_build_array(jsonb_build_object('id', v_other_medicine::text))) THEN
    RAISE EXCEPTION 'products_list did not return only the caller-shop fixture.';
  END IF;

  v_catalog := public.pos_catalog();
  IF NOT (v_catalog @> jsonb_build_array(jsonb_build_object('id', v_own_medicine::text)))
     OR (v_catalog @> jsonb_build_array(jsonb_build_object('id', v_other_medicine::text))) THEN
    RAISE EXCEPTION 'pos_catalog did not return only the caller-shop fixture.';
  END IF;

  v_import := public.products_import_preview(jsonb_build_array(
    jsonb_build_object('line', 1, 'barcode', v_other_barcode)
  ));
  IF (v_import->0->>'duplicate_in_database')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'products_import_preview disclosed a barcode used only by another shop.';
  END IF;
  v_import := public.products_import_preview(jsonb_build_array(
    jsonb_build_object('line', 1, 'barcode', v_own_barcode)
  ));
  IF (v_import->0->>'duplicate_in_database')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'products_import_preview missed a duplicate barcode in the caller shop.';
  END IF;

  SELECT count(*) INTO v_expected_active
  FROM public.medicines
  WHERE shop_id = v_shop_id AND is_active;
  SELECT count(*) INTO v_expected_expiring
  FROM public.stock_batches AS batch
  JOIN public.medicines AS medicine
    ON medicine.id = batch.medicine_id
   AND medicine.shop_id = batch.shop_id
  WHERE batch.shop_id = v_shop_id
    AND medicine.shop_id = v_shop_id
    AND medicine.is_active
    AND batch.quantity_remaining > 0
    AND batch.expiry_date BETWEEN current_date AND current_date + 90
    AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY');
  SELECT coalesce(sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit), 0)
  INTO v_expected_stock_value
  FROM public.stock_batches AS batch
  JOIN public.medicines AS medicine
    ON medicine.id = batch.medicine_id
   AND medicine.shop_id = batch.shop_id
  WHERE batch.shop_id = v_shop_id
    AND medicine.shop_id = v_shop_id
    AND medicine.is_active
    AND batch.quantity_remaining > 0
    AND batch.expiry_date >= current_date
    AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY');
  v_stats := public.products_overview_stats();
  IF (v_stats->>'total_active')::bigint IS DISTINCT FROM v_expected_active THEN
    RAISE EXCEPTION 'products_overview_stats total_active does not match the caller shop.';
  END IF;
  IF (v_stats->>'expiring_90')::bigint IS DISTINCT FROM v_expected_expiring THEN
    RAISE EXCEPTION 'products_overview_stats expiring_90 does not match the caller shop.';
  END IF;
  IF (v_stats->>'stock_value_cost_paisa')::numeric IS DISTINCT FROM v_expected_stock_value THEN
    RAISE EXCEPTION 'products_overview_stats stock value does not match the caller shop.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin::text, 'role', 'authenticated')::text,
    true
  );

  v_error := NULL;
  BEGIN
    PERFORM public.products_list();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active shop user with products permission is required' THEN
    RAISE EXCEPTION 'products_list did not reject the platform-only Super Admin as expected.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.products_overview_stats();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active shop user with products permission is required' THEN
    RAISE EXCEPTION 'products_overview_stats did not reject the platform-only Super Admin as expected.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.products_import_preview(jsonb_build_array(jsonb_build_object('barcode', v_other_barcode)));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active shop user with products permission is required' THEN
    RAISE EXCEPTION 'products_import_preview did not reject the platform-only Super Admin as expected.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.pos_catalog();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active shop user with POS permission is required' THEN
    RAISE EXCEPTION 'pos_catalog did not reject the platform-only Super Admin as expected.';
  END IF;

  RAISE NOTICE 's5_product_read_rpc_smoke_test: all_passed=true';
END
$test$;

ROLLBACK;
