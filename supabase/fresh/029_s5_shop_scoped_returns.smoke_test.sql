-- Runtime S5 test for per-shop returns and return-policy settings.
-- All fixtures are rolled back when the transaction succeeds.
-- If an assertion fails and the SQL Editor leaves the transaction open, issue ROLLBACK.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $test$
DECLARE
  v_actor uuid;
  v_shop_id uuid;
  v_test_shop_id uuid;
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_medicine_id uuid;
  v_unit_id uuid;
  v_batch_id uuid;
  v_foreign_sale_id uuid;
  v_foreign_return_id uuid;
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_allocation_id uuid;
  v_return_id uuid;
  v_rejected_return_id uuid;
  v_invoice text;
  v_sale jsonb;
  v_pending jsonb;
  v_result jsonb;
  v_settings jsonb;
  v_error text;
  v_signature text;
  v_signatures text[] := ARRAY[
    'public.sale_for_return(text)',
    'public.request_sale_return(uuid,text,jsonb)',
    'public.pending_sale_returns()',
    'public.reject_sale_return(uuid,text)',
    'public.process_sale_return(uuid,jsonb)',
    'public.get_return_policy_settings()',
    'public.update_return_policy_settings(integer,integer)'
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
           AND routine.prorettype = 'jsonb'::regtype
           AND routine.proconfig @> ARRAY['search_path=public']
           AND position(
             'tenant_private.current_shop_id()'
             IN lower(pg_catalog.pg_get_functiondef(routine.oid))
           ) > 0
           AND position(
             'shop_id = v_shop_id'
             IN lower(pg_catalog.pg_get_functiondef(routine.oid))
           ) > 0
       ) THEN
      RAISE EXCEPTION 'Return routine % is missing or has unexpected shop scope, grants, or security settings.', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.return_policy_settings'::regclass
      AND constraint_row.contype = 'p'
      AND constraint_row.conname = 'return_policy_settings_pkey'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) = 'PRIMARY KEY (shop_id, id)'
  ) THEN
    RAISE EXCEPTION 'return_policy_settings does not have the expected per-shop primary key.';
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
    AND permissions && ARRAY['sales_history']::text[]
  ORDER BY id
  LIMIT 1;
  IF v_actor IS NULL OR v_shop_id IS NULL THEN
    RAISE EXCEPTION 'An active Shop Admin with Sales History in its profile permissions is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.return_policy_settings
    WHERE shop_id = v_shop_id AND id = 1
  ) THEN
    RAISE EXCEPTION 'The caller shop has no return policy settings.';
  END IF;

  INSERT INTO public.shops (name)
  VALUES ('S5 return scope test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  INSERT INTO public.return_policy_settings (
    shop_id, id, return_window_days, minimum_restock_shelf_life_days
  )
  VALUES (v_test_shop_id, 1, 123, 456);

  UPDATE public.return_policy_settings
  SET return_window_days = 321,
      minimum_restock_shelf_life_days = 654
  WHERE shop_id = v_shop_id AND id = 1;

  INSERT INTO public.sales (
    shop_id, invoice_number, cashier_name, subtotal_paisa, total_paisa, status
  )
  VALUES (
    v_test_shop_id, 'S5-FOREIGN-' || v_token, 'S5 foreign fixture', 0, 0, 'COMPLETED'
  )
  RETURNING id INTO v_foreign_sale_id;

  INSERT INTO public.sale_returns (shop_id, sale_id, status, reason, requested_by)
  VALUES (
    v_test_shop_id, v_foreign_sale_id, 'PENDING', 'S5 foreign fixture', v_actor
  )
  RETURNING id INTO v_foreign_return_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_shop_id, 'S5RET-' || v_token, 'S5 return test ' || v_token,
    'S5 return test', '1 mg', 'S5 return test', 'S5 return test', 'OTC', true
  )
  RETURNING id INTO v_medicine_id;

  INSERT INTO public.medicine_units (
    shop_id, medicine_id, name, conversion_factor, is_default_sale_unit, price_paisa
  )
  VALUES (v_shop_id, v_medicine_id, 'S5 return unit ' || v_token, 1, true, 1000)
  RETURNING id INTO v_unit_id;

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES (
    v_shop_id, v_medicine_id, v_token, current_date + 180, current_date,
    100, 1000, 10, 10, 'ACTIVE'
  )
  RETURNING id INTO v_batch_id;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_settings := public.get_return_policy_settings();
  IF (v_settings->>'returnWindowDays')::integer IS DISTINCT FROM 321
     OR (v_settings->>'minimumRestockShelfLifeDays')::integer IS DISTINCT FROM 654 THEN
    RAISE EXCEPTION 'Return policy read did not return the caller shop settings.';
  END IF;

  v_result := public.update_return_policy_settings(13, 180);
  IF (v_result->>'returnWindowDays')::integer IS DISTINCT FROM 13
     OR (v_result->>'minimumRestockShelfLifeDays')::integer IS DISTINCT FROM 180
     OR NOT EXISTS (
       SELECT 1
       FROM public.return_policy_settings
       WHERE shop_id = v_shop_id AND id = 1
         AND return_window_days = 13
         AND minimum_restock_shelf_life_days = 180
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.return_policy_settings
       WHERE shop_id = v_test_shop_id AND id = 1
         AND return_window_days = 123
         AND minimum_restock_shelf_life_days = 456
     ) THEN
    RAISE EXCEPTION 'Return policy update changed or failed to preserve shop-specific settings.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.audit_logs
    WHERE shop_id = v_shop_id
      AND actor_id = v_actor
      AND action = 'RETURN_POLICY_UPDATED'
  ) THEN
    RAISE EXCEPTION 'Return policy update did not record an audit row in the caller shop.';
  END IF;

  v_result := public.post_sale(
    NULL,
    'S5 return test ' || v_token,
    jsonb_build_array(jsonb_build_object(
      'medicine_id', v_medicine_id,
      'unit_id', v_unit_id,
      'quantity_in_unit', 2
    )),
    0,
    0,
    2000,
    jsonb_build_array(jsonb_build_object(
      'payment_method', 'CASH',
      'amount_paisa', 2000
    ))
  );
  v_sale_id := nullif(v_result->>'id', '')::uuid;
  v_invoice := v_result->>'invoiceNumber';
  IF v_sale_id IS NULL OR v_invoice IS NULL THEN
    RAISE EXCEPTION 'Could not create the same-shop sale fixture.';
  END IF;

  v_sale := public.sale_for_return(v_invoice);
  IF (v_sale->>'id')::uuid IS DISTINCT FROM v_sale_id
     OR jsonb_array_length(v_sale->'items') IS DISTINCT FROM 1
     OR jsonb_array_length(v_sale->'items'->0->'allocations') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Sale lookup did not return the same-shop sale.';
  END IF;
  v_sale_item_id := (v_sale->'items'->0->>'saleItemId')::uuid;
  v_allocation_id := (v_sale->'items'->0->'allocations'->0->>'allocationId')::uuid;

  v_result := public.request_sale_return(
    v_sale_id,
    'S5 same-shop return ' || v_token,
    jsonb_build_array(jsonb_build_object(
      'sale_item_id', v_sale_item_id,
      'allocation_id', v_allocation_id,
      'quantity_base_units', 1
    ))
  );
  v_return_id := (v_result->>'id')::uuid;
  IF v_result->>'status' IS DISTINCT FROM 'PENDING'
     OR NOT EXISTS (
       SELECT 1 FROM public.sale_returns
       WHERE id = v_return_id AND shop_id = v_shop_id AND sale_id = v_sale_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.sale_return_items
       WHERE return_id = v_return_id AND shop_id = v_shop_id
     ) THEN
    RAISE EXCEPTION 'Same-shop return request did not persist its shop-scoped rows.';
  END IF;

  v_pending := public.pending_sale_returns();
  IF NOT (v_pending @> jsonb_build_array(jsonb_build_object('id', v_return_id)))
     OR v_pending @> jsonb_build_array(jsonb_build_object('id', v_foreign_return_id)) THEN
    RAISE EXCEPTION 'Pending returns included a foreign-shop request or omitted the caller request.';
  END IF;

  v_result := public.process_sale_return(
    v_return_id,
    jsonb_build_array(jsonb_build_object(
      'id', (SELECT id FROM public.sale_return_items WHERE return_id = v_return_id AND shop_id = v_shop_id),
      'disposition', 'QUARANTINE',
      'sealedIntact', false
    ))
  );
  IF v_result->>'status' IS DISTINCT FROM 'COMPLETED'
     OR (v_result->>'refundTotalPaisa')::integer IS DISTINCT FROM 1000
     OR NOT EXISTS (
       SELECT 1 FROM public.sale_returns
       WHERE id = v_return_id AND shop_id = v_shop_id AND status = 'COMPLETED'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.sales
       WHERE id = v_sale_id AND shop_id = v_shop_id AND status = 'PARTIALLY_RETURNED'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.sale_return_items return_item
       JOIN public.stock_batches quarantine
         ON quarantine.id = return_item.quarantine_batch_id
        AND quarantine.shop_id = v_shop_id
       WHERE return_item.return_id = v_return_id
         AND return_item.shop_id = v_shop_id
         AND quarantine.status = 'QUARANTINE'
         AND quarantine.quantity_received = 1
         AND quarantine.quantity_remaining = 1
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.stock_movements
       WHERE shop_id = v_shop_id AND reference_id = v_return_id
         AND movement_type = 'SALE_RETURN' AND quantity_delta = 1
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.audit_logs
       WHERE shop_id = v_shop_id AND actor_id = v_actor
         AND entity_id = v_return_id AND action = 'SALE_RETURN_PROCESSED'
     ) THEN
    RAISE EXCEPTION 'Same-shop return processing did not persist the expected scoped results.';
  END IF;

  v_result := public.request_sale_return(
    v_sale_id,
    'S5 same-shop rejection ' || v_token,
    jsonb_build_array(jsonb_build_object(
      'sale_item_id', v_sale_item_id,
      'allocation_id', v_allocation_id,
      'quantity_base_units', 1
    ))
  );
  v_rejected_return_id := (v_result->>'id')::uuid;
  v_result := public.reject_sale_return(v_rejected_return_id, 'S5 rejection test');
  IF v_result->>'status' IS DISTINCT FROM 'REJECTED'
     OR NOT EXISTS (
       SELECT 1 FROM public.sale_returns
       WHERE id = v_rejected_return_id AND shop_id = v_shop_id AND status = 'REJECTED'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.audit_logs
       WHERE shop_id = v_shop_id AND actor_id = v_actor
         AND entity_id = v_rejected_return_id AND action = 'SALE_RETURN_REJECTED'
     ) THEN
    RAISE EXCEPTION 'Same-shop return rejection did not persist its scoped result.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.sale_for_return('S5-FOREIGN-' || v_token);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Sale was not found or is not returnable' THEN
    RAISE EXCEPTION 'Sale lookup did not reject a foreign-shop invoice.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.request_sale_return(
      v_foreign_sale_id,
      'S5 rejected foreign sale',
      jsonb_build_array(jsonb_build_object(
        'sale_item_id', v_sale_item_id,
        'allocation_id', v_allocation_id,
        'quantity_base_units', 1
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Sale was not found or is not returnable' THEN
    RAISE EXCEPTION 'Return request did not reject a foreign-shop sale.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.reject_sale_return(v_foreign_return_id, 'S5 rejected foreign return');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Return request is missing or has already been processed' THEN
    RAISE EXCEPTION 'Return rejection did not reject a foreign-shop request.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.process_sale_return(
      v_foreign_return_id,
      '[]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Return request is missing or has already been processed' THEN
    RAISE EXCEPTION 'Return processing did not reject a foreign-shop request.';
  END IF;

  IF (SELECT quantity_remaining FROM public.stock_batches WHERE id = v_batch_id AND shop_id = v_shop_id) IS DISTINCT FROM 8
     OR EXISTS (
       SELECT 1 FROM public.sale_returns
       WHERE sale_id = v_foreign_sale_id AND shop_id = v_shop_id
     )
     OR EXISTS (
       SELECT 1 FROM public.audit_logs
       WHERE entity_id = v_foreign_return_id AND shop_id = v_shop_id
     ) THEN
    RAISE EXCEPTION 'A foreign-shop return attempt changed caller-shop stock or created caller-shop records.';
  END IF;
END;
$test$;

ROLLBACK;
