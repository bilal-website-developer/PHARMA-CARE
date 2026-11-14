-- Runtime tests for the five 050H shop-scoped business RPCs.
-- Synthetic fixtures are rolled back when the test succeeds.
-- If the SQL Editor leaves a failed transaction open, issue ROLLBACK.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $test$
DECLARE
  v_actor uuid;
  v_shop_id uuid;
  v_test_shop_id uuid;
  v_super_admin uuid;
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_own_category_name text;
  v_foreign_category_name text;
  v_own_brand_name text;
  v_foreign_brand_name text;
  v_own_medicine_id uuid;
  v_foreign_medicine_id uuid;
  v_own_unit_id uuid;
  v_foreign_unit_id uuid;
  v_own_batch_id uuid;
  v_foreign_batch_id uuid;
  v_own_customer_id uuid;
  v_foreign_customer_id uuid;
  v_saved_customer jsonb;
  v_own_sale_id uuid;
  v_foreign_sale_id uuid;
  v_own_sale_item_id uuid;
  v_foreign_sale_item_id uuid;
  v_result jsonb;
  v_master jsonb;
  v_customers jsonb;
  v_history jsonb;
  v_error_code text;
  v_error_message text;
  v_signature text;
  v_definition text;
  v_signatures text[] := ARRAY[
    'public.master_data_overview()',
    'public.pos_customers()',
    'public.save_customer(text,text,text,text,integer)',
    'public.record_customer_payment(uuid,integer,text)',
    'public.sales_history(integer)'
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
       OR NOT has_function_privilege('service_role', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc routine
         CROSS JOIN LATERAL aclexplode(coalesce(
           routine.proacl,
           acldefault('f', routine.proowner)
         )) AS privilege
         WHERE routine.oid = to_regprocedure(v_signature)
           AND privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       )
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc routine
         CROSS JOIN LATERAL aclexplode(coalesce(
           routine.proacl,
           acldefault('f', routine.proowner)
         )) AS privilege
         WHERE routine.oid = to_regprocedure(v_signature)
           AND privilege.privilege_type = 'EXECUTE'
           AND privilege.grantee NOT IN (
             routine.proowner,
             to_regrole('authenticated')::oid,
             to_regrole('service_role')::oid
           )
       ) THEN
      RAISE EXCEPTION 'RPC % is missing or has unexpected API grants.', v_signature;
    END IF;

    SELECT pg_catalog.pg_get_functiondef(routine.oid)
    INTO v_definition
    FROM pg_catalog.pg_proc routine
    WHERE routine.oid = to_regprocedure(v_signature);
    v_definition := lower(v_definition);

    IF position('tenant_private.current_shop_id()' IN v_definition) = 0
       OR position('v_shop_id' IN v_definition) = 0
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc routine
         WHERE routine.oid = to_regprocedure(v_signature)
           AND routine.prosecdef
           AND pg_catalog.pg_get_function_result(routine.oid) = 'jsonb'
           AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
       ) THEN
      RAISE EXCEPTION 'RPC % is missing its expected security settings or shop scope.', v_signature;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT profile.id, profile.shop_id
  INTO v_actor, v_shop_id
  FROM public.profiles AS profile
  WHERE profile.role = 'admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND profile.shop_id IS NOT NULL
  ORDER BY profile.id
  LIMIT 1;
  IF v_actor IS NULL OR v_shop_id IS NULL THEN
    RAISE EXCEPTION 'An active Shop Admin profile is required for this smoke test.';
  END IF;

  SELECT profile.id
  INTO v_super_admin
  FROM public.profiles AS profile
  WHERE profile.role = 'super_admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL
  ORDER BY profile.id
  LIMIT 1;
  IF v_super_admin IS NULL THEN
    RAISE EXCEPTION 'An active platform Super Admin profile is required for this smoke test.';
  END IF;

  INSERT INTO public.shops (name)
  VALUES ('S5 business RPC test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  v_own_category_name := 'S5 own category ' || v_token;
  v_foreign_category_name := 'S5 foreign category ' || v_token;
  v_own_brand_name := 'S5 own brand ' || v_token;
  v_foreign_brand_name := 'S5 foreign brand ' || v_token;

  INSERT INTO public.categories (shop_id, name)
  VALUES
    (v_shop_id, v_own_category_name),
    (v_test_shop_id, v_foreign_category_name);

  INSERT INTO public.brands (shop_id, name)
  VALUES
    (v_shop_id, v_own_brand_name),
    (v_test_shop_id, v_foreign_brand_name);

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, min_stock_alert, is_active
  )
  VALUES (
    v_shop_id, 'S5H-A-' || v_token, 'S5 own medicine ' || v_token,
    'S5 synthetic medicine', '1 mg', v_own_category_name,
    v_own_brand_name, 'OTC', 0, true
  )
  RETURNING id INTO v_own_medicine_id;

  INSERT INTO public.medicine_units (
    shop_id, medicine_id, name, conversion_factor, is_default_sale_unit,
    price_paisa, sale_price_paisa
  )
  VALUES (
    v_shop_id, v_own_medicine_id, 'S5 own unit ' || v_token, 1, true, 1000, 1000
  )
  RETURNING id INTO v_own_unit_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, min_stock_alert, is_active
  )
  VALUES (
    v_test_shop_id, 'S5H-X-' || v_token, 'S5 foreign medicine ' || v_token,
    'S5 synthetic medicine', '1 mg', v_own_category_name,
    v_own_brand_name, 'OTC', 2, true
  )
  RETURNING id INTO v_foreign_medicine_id;

  INSERT INTO public.medicine_units (
    shop_id, medicine_id, name, conversion_factor, is_default_sale_unit,
    price_paisa, sale_price_paisa
  )
  VALUES (
    v_test_shop_id, v_foreign_medicine_id, 'S5 foreign unit ' || v_token,
    1, true, 9000000, 9000000
  )
  RETURNING id INTO v_foreign_unit_id;

  IF (SELECT unit.sale_price_paisa FROM public.medicine_units unit
      WHERE unit.id = v_own_unit_id) IS DISTINCT FROM 1000
     OR (SELECT unit.sale_price_paisa FROM public.medicine_units unit
         WHERE unit.id = v_foreign_unit_id) IS DISTINCT FROM 9000000 THEN
    RAISE EXCEPTION 'Synthetic sale units did not retain their configured sale prices.';
  END IF;

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES (
    v_shop_id, v_own_medicine_id, 'S5H-OWN-B-' || v_token,
    current_date + 180, current_date, 100, 1000, 1, 1, 'ACTIVE'
  )
  RETURNING id INTO v_own_batch_id;

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES (
    v_test_shop_id, v_foreign_medicine_id, 'S5H-B-' || v_token,
    current_date + 30, current_date, 9000000, 9000000, 1, 1, 'ACTIVE'
  )
  RETURNING id INTO v_foreign_batch_id;

  INSERT INTO public.customers (
    shop_id, name, phone, address, credit_limit_paisa,
    current_balance_paisa, store_credit_paisa
  )
  VALUES (
    v_shop_id, 'S5 own customer ' || v_token, '03000000000',
    'Synthetic S5 test data', 0, 500, 0
  )
  RETURNING id INTO v_own_customer_id;

  INSERT INTO public.customers (
    shop_id, name, phone, address, credit_limit_paisa,
    current_balance_paisa, store_credit_paisa
  )
  VALUES (
    v_test_shop_id, 'S5 foreign customer ' || v_token, '03000000001',
    'Synthetic S5 test data', 0, 500, 0
  )
  RETURNING id INTO v_foreign_customer_id;

  INSERT INTO public.sales (
    shop_id, invoice_number, cashier_name, customer_id, customer_name,
    "timestamp", subtotal_paisa, total_paisa, status
  )
  VALUES (
    v_shop_id, 'S5H-OWN-' || v_token, 'S5 synthetic cashier',
    v_own_customer_id, 'S5 own customer ' || v_token,
    clock_timestamp() + interval '1 minute', 1000, 1000, 'COMPLETED'
  )
  RETURNING id INTO v_own_sale_id;

  INSERT INTO public.sales (
    shop_id, invoice_number, cashier_name, customer_id, customer_name,
    "timestamp", subtotal_paisa, total_paisa, status
  )
  VALUES (
    v_test_shop_id, 'S5H-FOREIGN-' || v_token, 'S5 synthetic cashier',
    v_foreign_customer_id, 'S5 foreign customer ' || v_token,
    clock_timestamp() + interval '1 minute', 9000000, 9000000, 'COMPLETED'
  )
  RETURNING id INTO v_foreign_sale_id;

  INSERT INTO public.sale_items (
    shop_id, sale_id, medicine_id, unit_id, product_name, generic_name, unit_name,
    conversion_factor, quantity_in_unit, quantity_base_units, price_paisa_per_unit,
    cost_paisa_per_base_unit, discount_percent, line_discount_paisa,
    line_adjustment_paisa, line_total_paisa
  )
  VALUES (
    v_shop_id, v_own_sale_id, v_own_medicine_id, v_own_unit_id,
    'S5 own medicine ' || v_token, 'S5 synthetic medicine',
    'S5 own unit ' || v_token, 1, 1, 1, 1000, 100, 0, 0, 0, 1000
  )
  RETURNING id INTO v_own_sale_item_id;

  INSERT INTO public.sale_item_batch_allocations (
    shop_id, sale_item_id, batch_id, quantity_base_units,
    cost_paisa_per_base_unit, batch_number, expiry_date
  )
  VALUES (
    v_shop_id, v_own_sale_item_id, v_own_batch_id, 1, 100,
    'S5H-OWN-B-' || v_token, current_date + 180
  );

  INSERT INTO public.sale_items (
    shop_id, sale_id, medicine_id, unit_id, product_name, generic_name, unit_name,
    conversion_factor, quantity_in_unit, quantity_base_units, price_paisa_per_unit,
    cost_paisa_per_base_unit, discount_percent, line_discount_paisa,
    line_adjustment_paisa, line_total_paisa
  )
  VALUES (
    v_test_shop_id, v_foreign_sale_id, v_foreign_medicine_id, v_foreign_unit_id,
    'S5 foreign medicine ' || v_token, 'S5 synthetic medicine',
    'S5 foreign unit ' || v_token, 1, 1, 1, 9000000, 9000000, 0, 0, 0, 9000000
  )
  RETURNING id INTO v_foreign_sale_item_id;

  INSERT INTO public.sale_item_batch_allocations (
    shop_id, sale_item_id, batch_id, quantity_base_units,
    cost_paisa_per_base_unit, batch_number, expiry_date
  )
  VALUES (
    v_test_shop_id, v_foreign_sale_item_id, v_foreign_batch_id, 1, 9000000,
    'S5H-B-' || v_token, current_date + 30
  );

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_master := public.master_data_overview();
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_master->'categories') AS category_row(item)
    WHERE category_row.item->>'name' = v_own_category_name
      AND (category_row.item->>'product_count')::bigint = 1
      AND (category_row.item->>'low_count')::bigint = 0
      AND (category_row.item->>'expiring_count')::bigint = 0
      AND (category_row.item->>'stock_value_paisa')::numeric = 100
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_master->'categories') AS category_row(item)
    WHERE category_row.item->>'name' = v_foreign_category_name
  ) THEN
    RAISE EXCEPTION 'Master-data category details included foreign-shop data or omitted the same-shop result.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_master->'manufacturers') AS brand_row(item)
    WHERE brand_row.item->>'name' = v_own_brand_name
      AND (brand_row.item->>'product_count')::bigint = 1
      AND (brand_row.item->>'low_count')::bigint = 0
      AND (brand_row.item->>'expiring_count')::bigint = 0
      AND (brand_row.item->>'stock_value_paisa')::numeric = 100
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_master->'manufacturers') AS brand_row(item)
    WHERE brand_row.item->>'name' = v_foreign_brand_name
  ) THEN
    RAISE EXCEPTION 'Master-data manufacturer details included foreign-shop data or omitted the same-shop result.';
  END IF;

  IF (v_master->'summary'->>'category_count')::bigint IS DISTINCT FROM (
       SELECT count(*) FROM public.categories WHERE shop_id = v_shop_id
     )
     OR (v_master->'summary'->>'active_category_count')::bigint IS DISTINCT FROM (
       SELECT count(*) FROM public.categories WHERE shop_id = v_shop_id AND is_active
     )
     OR (v_master->'summary'->>'manufacturer_count')::bigint IS DISTINCT FROM (
       SELECT count(*) FROM public.brands WHERE shop_id = v_shop_id
     )
     OR (v_master->'summary'->>'active_manufacturer_count')::bigint IS DISTINCT FROM (
       SELECT count(*) FROM public.brands WHERE shop_id = v_shop_id AND is_active
     )
     OR (v_master->'summary'->>'product_count')::bigint IS DISTINCT FROM (
       SELECT count(*) FROM public.medicines WHERE shop_id = v_shop_id
     )
     OR (v_master->'summary'->>'unit_count')::bigint IS DISTINCT FROM (
       SELECT count(*) FROM public.medicine_units WHERE shop_id = v_shop_id
     ) THEN
    RAISE EXCEPTION 'Master-data summary counts do not match the caller shop.';
  END IF;

  v_customers := public.pos_customers();
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_customers) AS customer_row(item)
    WHERE customer_row.item->>'id' = v_own_customer_id::text
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_customers) AS customer_row(item)
    WHERE customer_row.item->>'id' = v_foreign_customer_id::text
  ) THEN
    RAISE EXCEPTION 'POS customer list included foreign-shop data or omitted the same-shop customer.';
  END IF;

  v_saved_customer := public.save_customer(
    'S5 saved customer ' || v_token,
    '03000000002',
    NULL,
    'Synthetic S5 test data',
    1000
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.customers customer
    WHERE customer.id = (v_saved_customer->>'id')::uuid
      AND customer.shop_id = v_shop_id
      AND customer.phone = '03000000002'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.audit_logs log
    WHERE log.shop_id = v_shop_id
      AND log.actor_id = v_actor
      AND log.action = 'CUSTOMER_CREATED'
      AND log.entity_id = (v_saved_customer->>'id')::uuid
  ) THEN
    RAISE EXCEPTION 'save_customer did not create and audit the customer in the caller shop.';
  END IF;

  v_result := public.record_customer_payment(v_own_customer_id, 200, 'S5 scoped payment');
  IF (v_result->>'balanceAfterPaisa')::integer IS DISTINCT FROM 300
     OR (SELECT current_balance_paisa FROM public.customers
         WHERE id = v_own_customer_id AND shop_id = v_shop_id) IS DISTINCT FROM 300
     OR NOT EXISTS (
       SELECT 1
       FROM public.khata_entries entry
       WHERE entry.shop_id = v_shop_id
         AND entry.customer_id = v_own_customer_id
         AND entry.entry_type = 'PAYMENT'
         AND entry.credit_paisa = 200
         AND entry.created_by = v_actor
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.audit_logs log
       WHERE log.shop_id = v_shop_id
         AND log.actor_id = v_actor
         AND log.action = 'CUSTOMER_PAYMENT_RECORDED'
         AND log.entity_id = v_own_customer_id
     ) THEN
    RAISE EXCEPTION 'Same-shop customer payment did not update and audit the caller-shop ledger.';
  END IF;

  v_error_code := NULL;
  v_error_message := NULL;
  BEGIN
    PERFORM public.record_customer_payment(v_foreign_customer_id, 100, 'S5 foreign payment');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_error_code = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
  END;
  IF v_error_code IS NULL
     OR v_error_message <> 'Customer was not found'
     OR (SELECT current_balance_paisa FROM public.customers
         WHERE id = v_foreign_customer_id AND shop_id = v_test_shop_id) IS DISTINCT FROM 500
     OR EXISTS (
       SELECT 1
       FROM public.khata_entries entry
       WHERE entry.shop_id = v_test_shop_id
         AND entry.customer_id = v_foreign_customer_id
         AND entry.description = 'S5 foreign payment'
     ) THEN
    RAISE EXCEPTION 'Foreign-shop customer payment was not denied without changing foreign data.';
  END IF;

  v_history := public.sales_history(500);
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_history) AS sale_row(item)
    WHERE sale_row.item->>'id' = v_own_sale_id::text
      AND sale_row.item->>'customerPhone' = '03000000000'
      AND jsonb_array_length(sale_row.item->'items') = 1
      AND sale_row.item->'items'->0->>'id' = v_own_sale_item_id::text
      AND jsonb_array_length(sale_row.item->'items'->0->'batchAllocations') = 1
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_history) AS sale_row(item)
    WHERE sale_row.item->>'id' = v_foreign_sale_id::text
       OR sale_row.item->>'invoiceNumber' = 'S5H-FOREIGN-' || v_token
  ) THEN
    RAISE EXCEPTION 'Sales history included foreign-shop sales/customer details or omitted the same-shop sale.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin::text, 'role', 'authenticated')::text,
    true
  );

  v_error_code := NULL;
  BEGIN
    PERFORM public.master_data_overview();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE;
  END;
  IF v_error_code IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'A platform Super Admin was not denied master-data access.';
  END IF;

  v_error_code := NULL;
  BEGIN
    PERFORM public.pos_customers();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE;
  END;
  IF v_error_code IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'A platform Super Admin was not denied POS customer access.';
  END IF;

  v_error_code := NULL;
  BEGIN
    PERFORM public.save_customer(
      'S5 forbidden customer ' || v_token, '03000000003', NULL, '', 0
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE;
  END;
  IF v_error_code IS DISTINCT FROM '42501'
     OR EXISTS (
       SELECT 1 FROM public.customers
       WHERE name = 'S5 forbidden customer ' || v_token
     ) THEN
    RAISE EXCEPTION 'A platform Super Admin was not denied customer creation.';
  END IF;

  v_error_code := NULL;
  BEGIN
    PERFORM public.record_customer_payment(v_own_customer_id, 100, 'S5 forbidden payment');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE;
  END;
  IF v_error_code IS DISTINCT FROM '42501'
     OR (SELECT current_balance_paisa FROM public.customers
         WHERE id = v_own_customer_id AND shop_id = v_shop_id) IS DISTINCT FROM 300 THEN
    RAISE EXCEPTION 'A platform Super Admin was not denied customer payment.';
  END IF;

  v_error_code := NULL;
  BEGIN
    PERFORM public.sales_history(500);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE;
  END;
  IF v_error_code IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'A platform Super Admin was not denied sales history.';
  END IF;
END;
$test$;

ROLLBACK;

SELECT
  'PASS' AS status,
  'all five RPCs preserve same-shop behavior, deny cross-shop access, and reject platform Super Admins' AS checks;
