-- Runtime S5 test for same-shop sale posting and rejection of foreign references.
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
  v_own_customer_id uuid;
  v_foreign_customer_id uuid;
  v_own_medicine_id uuid;
  v_own_unit_id uuid;
  v_own_batch_id uuid;
  v_foreign_medicine_id uuid;
  v_foreign_unit_id uuid;
  v_foreign_batch_id uuid;
  v_sale_id uuid;
  v_result jsonb;
  v_error text;
  v_signature text := 'public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)';
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
         AND position('tenant_private.current_shop_id()' IN lower(pg_catalog.pg_get_functiondef(routine.oid))) > 0
         AND position('medicine.shop_id = v_shop_id' IN lower(pg_catalog.pg_get_functiondef(routine.oid))) > 0
         AND position('unit.shop_id = v_shop_id' IN lower(pg_catalog.pg_get_functiondef(routine.oid))) > 0
         AND position('stock.shop_id = v_shop_id' IN lower(pg_catalog.pg_get_functiondef(routine.oid))) > 0
     ) THEN
    RAISE EXCEPTION 'post_sale is missing or has unexpected API grants, security settings, or shop checks.';
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
  VALUES ('S5 sale scope test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  INSERT INTO public.customers (shop_id, name, phone, address)
  VALUES (v_shop_id, 'S5 sale customer ' || v_token, '03000000000', 'S5 sale test')
  RETURNING id INTO v_own_customer_id;
  INSERT INTO public.customers (shop_id, name, phone, address)
  VALUES (v_test_shop_id, 'S5 foreign customer ' || v_token, '03000000001', 'S5 sale test')
  RETURNING id INTO v_foreign_customer_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_shop_id, 'S5SALE-A-' || v_token, 'S5 sale own ' || v_token,
    'S5 sale test own', '1 mg', 'S5 sale test', 'S5 sale test', 'OTC', true
  )
  RETURNING id INTO v_own_medicine_id;
  INSERT INTO public.medicine_units (
    shop_id, medicine_id, name, conversion_factor, is_default_sale_unit, price_paisa
  )
  VALUES (v_shop_id, v_own_medicine_id, 'S5 sale unit ' || v_token, 1, true, 1000)
  RETURNING id INTO v_own_unit_id;

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES (
    v_shop_id, v_own_medicine_id, v_token || '-OWN',
    current_date + 30, current_date, 100, 1000, 10, 10, 'ACTIVE'
  )
  RETURNING id INTO v_own_batch_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_test_shop_id, 'S5SALE-X-' || v_token, 'S5 sale foreign ' || v_token,
    'S5 sale test foreign', '1 mg', 'S5 sale test', 'S5 sale test', 'OTC', true
  )
  RETURNING id INTO v_foreign_medicine_id;
  INSERT INTO public.medicine_units (
    shop_id, medicine_id, name, conversion_factor, is_default_sale_unit, price_paisa
  )
  VALUES (v_test_shop_id, v_foreign_medicine_id, 'S5 foreign unit ' || v_token, 1, true, 1000)
  RETURNING id INTO v_foreign_unit_id;

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES (
    v_test_shop_id, v_foreign_medicine_id, v_token || '-FOREIGN',
    current_date + 30, current_date, 100, 1000, 10, 10, 'ACTIVE'
  )
  RETURNING id INTO v_foreign_batch_id;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_result := public.post_sale(
    v_own_customer_id,
    'S5 sale customer ' || v_token,
    jsonb_build_array(jsonb_build_object(
      'medicine_id', v_own_medicine_id,
      'unit_id', v_own_unit_id,
      'quantity_in_unit', 1
    )),
    0,
    0,
    1000,
    jsonb_build_array(jsonb_build_object(
      'payment_method', 'CASH',
      'amount_paisa', 1000
    ))
  );
  v_sale_id := nullif(v_result->>'id', '')::uuid;
  IF v_sale_id IS NULL
     OR (v_result->>'customerId')::uuid IS DISTINCT FROM v_own_customer_id
     OR v_result->>'customerPhone' IS DISTINCT FROM '03000000000'
     OR jsonb_array_length(v_result->'items') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'A valid same-shop sale did not return the expected sale and customer data.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales
    WHERE id = v_sale_id AND shop_id = v_shop_id AND cashier_id = v_actor
  ) OR NOT EXISTS (
    SELECT 1 FROM public.sale_items
    WHERE sale_id = v_sale_id AND shop_id = v_shop_id AND medicine_id = v_own_medicine_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.sale_payments
    WHERE sale_id = v_sale_id AND shop_id = v_shop_id AND payment_method = 'CASH'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.sale_item_batch_allocations
    WHERE sale_item_id IN (
      SELECT id FROM public.sale_items WHERE sale_id = v_sale_id AND shop_id = v_shop_id
    )
      AND shop_id = v_shop_id
      AND batch_id = v_own_batch_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE shop_id = v_shop_id
      AND batch_id = v_own_batch_id
      AND reference_id = v_sale_id
      AND movement_type = 'SALE'
      AND quantity_delta = -1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE shop_id = v_shop_id
      AND actor_id = v_actor
      AND entity_id = v_sale_id
      AND action = 'SALE_POSTED'
  ) THEN
    RAISE EXCEPTION 'The successful sale did not persist all related rows in the caller shop.';
  END IF;
  IF (SELECT quantity_remaining FROM public.stock_batches WHERE id = v_own_batch_id) IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'The successful sale did not decrement only its caller-shop batch.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.post_sale(
      v_foreign_customer_id,
      'S5 rejected foreign customer ' || v_token,
      jsonb_build_array(jsonb_build_object(
        'medicine_id', v_own_medicine_id,
        'unit_id', v_own_unit_id,
        'quantity_in_unit', 1
      )),
      0, 0, 1000,
      jsonb_build_array(jsonb_build_object('payment_method', 'CASH', 'amount_paisa', 1000))
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Select a valid customer' THEN
    RAISE EXCEPTION 'Sale posting did not reject a foreign-shop customer.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.post_sale(
      NULL,
      'S5 rejected foreign item ' || v_token,
      jsonb_build_array(jsonb_build_object(
        'medicine_id', v_foreign_medicine_id,
        'unit_id', v_foreign_unit_id,
        'quantity_in_unit', 1
      )),
      0, 0, 1000,
      jsonb_build_array(jsonb_build_object('payment_method', 'CASH', 'amount_paisa', 1000))
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'A selected medicine or sale unit is no longer available' THEN
    RAISE EXCEPTION 'Sale posting did not reject a foreign-shop medicine and unit.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin::text, 'role', 'authenticated')::text,
    true
  );
  v_error := NULL;
  BEGIN
    PERFORM public.post_sale(
      v_own_customer_id,
      'S5 rejected Super Admin sale ' || v_token,
      jsonb_build_array(jsonb_build_object(
        'medicine_id', v_own_medicine_id,
        'unit_id', v_own_unit_id,
        'quantity_in_unit', 1
      )),
      0, 0, 1000,
      jsonb_build_array(jsonb_build_object('payment_method', 'CASH', 'amount_paisa', 1000))
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'You do not have permission to post a sale' THEN
    RAISE EXCEPTION 'Super Admin was not rejected by the business-sale RPC.';
  END IF;

  IF (SELECT quantity_remaining FROM public.stock_batches WHERE id = v_own_batch_id) IS DISTINCT FROM 9
     OR (SELECT quantity_remaining FROM public.stock_batches WHERE id = v_foreign_batch_id) IS DISTINCT FROM 10
     OR (SELECT count(*) FROM public.sales WHERE customer_id = v_foreign_customer_id) <> 0
     OR (SELECT count(*) FROM public.sales WHERE customer_name = ('S5 rejected foreign item ' || v_token)) <> 0
     OR (SELECT count(*) FROM public.sales WHERE customer_name = ('S5 rejected Super Admin sale ' || v_token)) <> 0 THEN
    RAISE EXCEPTION 'A rejected sale changed stock or created a sale outside the valid same-shop case.';
  END IF;
END;
$test$;

ROLLBACK;
