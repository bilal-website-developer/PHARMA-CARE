-- Runtime S5 test for stock RPC shop isolation and write boundaries.
-- All fixtures are rolled back when the transaction succeeds.
-- If the SQL Editor leaves a failed transaction open, issue ROLLBACK.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $test$
DECLARE
  v_actor uuid;
  v_shop_id uuid;
  v_test_shop_id uuid;
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_reason text := lower('s5 stock ' || replace(gen_random_uuid()::text, '-', ''));
  v_own_medicine_id uuid;
  v_foreign_medicine_id uuid;
  v_own_active_batch_id uuid;
  v_own_expired_batch_id uuid;
  v_foreign_active_batch_id uuid;
  v_foreign_expired_batch_id uuid;
  v_result jsonb;
  v_stats jsonb;
  v_expected_stats jsonb;
  v_buckets jsonb;
  v_expected_buckets jsonb;
  v_list jsonb;
  v_log jsonb;
  v_error text;
  v_quantity integer;
  v_signature text;
  v_signatures text[] := ARRAY[
    'public.adjust_stock(uuid,integer,text)',
    'public.stock_overview_stats()',
    'public.stock_batches_list(text,text,text,integer,integer,uuid,text)',
    'public.stock_expiry_buckets()',
    'public.stock_adjustments_log(integer,integer,date,date,text,uuid)',
    'public.write_off_expired_batch(uuid,text)'
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
           AND position(
             'tenant_private.current_shop_id()'
             IN lower(pg_catalog.pg_get_functiondef(routine.oid))
           ) > 0
           AND position(
             'shop_id = v_shop_id'
             IN lower(pg_catalog.pg_get_functiondef(routine.oid))
           ) > 0
       ) THEN
      RAISE EXCEPTION 'Stock routine % is missing or has unexpected shop scope, grants, or security settings.', v_signature;
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

  INSERT INTO public.shops (name)
  VALUES ('S5 stock scope test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_shop_id, 'S5STOCK-A-' || v_token, 'S5 stock own ' || v_token,
    'S5 stock test own', '1 mg', 'S5 stock test', 'S5 stock test', 'OTC', true
  )
  RETURNING id INTO v_own_medicine_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_test_shop_id, 'S5STOCK-X-' || v_token, 'S5 stock foreign ' || v_token,
    'S5 stock test foreign', '1 mg', 'S5 stock test', 'S5 stock test', 'OTC', true
  )
  RETURNING id INTO v_foreign_medicine_id;

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES (
    v_shop_id, v_own_medicine_id, 'S5STOCK-A-' || v_token,
    current_date + 14, current_date, 100, 1000, 11, 10, 'ACTIVE'
  )
  RETURNING id INTO v_own_active_batch_id;

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES (
    v_shop_id, v_own_medicine_id, 'S5STOCK-E-' || v_token,
    current_date - 1, current_date - 180, 200, 1500, 5, 5, 'ACTIVE'
  )
  RETURNING id INTO v_own_expired_batch_id;

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES (
    v_test_shop_id, v_foreign_medicine_id, 'S5STOCK-XA-' || v_token,
    current_date + 14, current_date, 9000000, 90000000, 1000000, 1000000, 'ACTIVE'
  )
  RETURNING id INTO v_foreign_active_batch_id;

  INSERT INTO public.stock_batches (
    shop_id, medicine_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining, status
  )
  VALUES (
    v_test_shop_id, v_foreign_medicine_id, 'S5STOCK-XE-' || v_token,
    current_date - 1, current_date - 180, 9000000, 90000000, 1000000, 1000000, 'ACTIVE'
  )
  RETURNING id INTO v_foreign_expired_batch_id;

  INSERT INTO public.stock_movements (
    shop_id, batch_id, movement_type, quantity_delta, reason, created_by
  )
  VALUES
    (v_shop_id, v_own_active_batch_id, 'ADJUSTMENT', 1, v_reason, v_actor),
    (v_test_shop_id, v_foreign_active_batch_id, 'ADJUSTMENT', 1, v_reason, v_actor);

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_list := public.stock_batches_list(
    'all', v_token, 'expiry_asc', 1, 20, NULL, NULL
  );
  IF (v_list->>'total_count')::integer IS DISTINCT FROM 2
     OR jsonb_array_length(v_list->'rows') IS DISTINCT FROM 2
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_list->'rows') AS listed(row_data)
       WHERE (listed.row_data->>'medicine_id')::uuid IS DISTINCT FROM v_own_medicine_id
     ) THEN
    RAISE EXCEPTION 'Stock batch listing included a foreign-shop row or omitted a same-shop fixture.';
  END IF;

  v_quantity := public.adjust_stock(v_own_active_batch_id, 1, 'other');
  IF v_quantity IS DISTINCT FROM 11 OR NOT EXISTS (
    SELECT 1
    FROM public.stock_movements
    WHERE shop_id = v_shop_id
      AND batch_id = v_own_active_batch_id
      AND movement_type = 'ADJUSTMENT'
      AND quantity_delta = 1
      AND reason = 'other'
      AND created_by = v_actor
  ) THEN
    RAISE EXCEPTION 'Same-shop stock adjustment did not update quantity and record a scoped movement.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.adjust_stock(v_foreign_active_batch_id, 1, 'other');
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS NULL
     OR (SELECT quantity_remaining FROM public.stock_batches WHERE id = v_foreign_active_batch_id) IS DISTINCT FROM 1000000
     OR EXISTS (
       SELECT 1
       FROM public.stock_movements
       WHERE shop_id = v_shop_id AND batch_id = v_foreign_active_batch_id
     ) THEN
    RAISE EXCEPTION 'Foreign-shop stock adjustment was not rejected cleanly.';
  END IF;

  v_log := public.stock_adjustments_log(1, 20, NULL, NULL, v_reason, NULL);
  IF (v_log->>'total_count')::integer IS DISTINCT FROM 1
     OR jsonb_array_length(v_log->'rows') IS DISTINCT FROM 1
     OR (v_log->'rows'->0->>'batch_id')::uuid IS DISTINCT FROM v_own_active_batch_id THEN
    RAISE EXCEPTION 'Stock adjustment history included a foreign-shop movement or omitted the same-shop movement.';
  END IF;

  v_result := public.write_off_expired_batch(v_own_expired_batch_id, 'expired');
  IF (v_result->>'batch_id')::uuid IS DISTINCT FROM v_own_expired_batch_id
     OR (SELECT quantity_remaining FROM public.stock_batches WHERE id = v_own_expired_batch_id) IS DISTINCT FROM 0
     OR NOT EXISTS (
       SELECT 1
       FROM public.stock_movements
       WHERE shop_id = v_shop_id
         AND batch_id = v_own_expired_batch_id
         AND movement_type = 'WRITE_OFF'
         AND quantity_delta = -5
         AND reason = 'expired'
         AND created_by = v_actor
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.audit_logs
       WHERE shop_id = v_shop_id
         AND actor_id = v_actor
         AND action = 'stock_batch_write_off'
         AND entity_id = v_own_expired_batch_id
     ) THEN
    RAISE EXCEPTION 'Same-shop expired-batch write-off did not update stock and create scoped movement/audit rows.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.write_off_expired_batch(v_foreign_expired_batch_id, 'expired');
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS NULL
     OR (SELECT quantity_remaining FROM public.stock_batches WHERE id = v_foreign_expired_batch_id) IS DISTINCT FROM 1000000
     OR EXISTS (
       SELECT 1
       FROM public.stock_movements
       WHERE shop_id = v_shop_id AND batch_id = v_foreign_expired_batch_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.audit_logs
       WHERE shop_id = v_shop_id
         AND action = 'stock_batch_write_off'
         AND entity_id = v_foreign_expired_batch_id
     ) THEN
    RAISE EXCEPTION 'Foreign-shop expired-batch write-off was not rejected cleanly.';
  END IF;

  v_stats := public.stock_overview_stats();
  SELECT jsonb_build_object(
    'stock_value_cost_paisa', CASE WHEN public.can_view_cost() THEN coalesce((
      SELECT sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
      FROM public.stock_batches batch
      JOIN public.medicines medicine
        ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
      WHERE batch.shop_id = v_shop_id
        AND medicine.is_active
        AND batch.quantity_remaining > 0
        AND batch.expiry_date >= current_date
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
    ), 0) ELSE NULL END,
    'stock_value_mrp_paisa', coalesce((
      SELECT sum(batch.quantity_remaining::numeric * batch.mrp_paisa_per_base_unit)
      FROM public.stock_batches batch
      JOIN public.medicines medicine
        ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
      WHERE batch.shop_id = v_shop_id
        AND medicine.is_active
        AND batch.quantity_remaining > 0
        AND batch.expiry_date >= current_date
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
    ), 0),
    'expiring_30', (
      SELECT count(*)
      FROM public.stock_batches batch
      JOIN public.medicines medicine
        ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
      WHERE batch.shop_id = v_shop_id
        AND medicine.is_active
        AND batch.quantity_remaining > 0
        AND batch.expiry_date BETWEEN current_date AND current_date + 30
        AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
    ),
    'expired_batches', (
      SELECT count(*)
      FROM public.stock_batches batch
      WHERE batch.shop_id = v_shop_id
        AND batch.quantity_remaining > 0
        AND batch.expiry_date < current_date
    ),
    'expired_value_at_risk_paisa', CASE WHEN public.can_view_cost() THEN coalesce((
      SELECT sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
      FROM public.stock_batches batch
      WHERE batch.shop_id = v_shop_id
        AND batch.quantity_remaining > 0
        AND batch.expiry_date < current_date
    ), 0) ELSE NULL END
  )
  INTO v_expected_stats;
  IF v_stats IS DISTINCT FROM v_expected_stats THEN
    RAISE EXCEPTION 'Stock overview aggregates do not match caller-shop-only values.';
  END IF;

  v_buckets := public.stock_expiry_buckets();
  SELECT jsonb_build_object(
    'buckets', jsonb_build_array(
      jsonb_build_object(
        'key', 'expired', 'label', 'Expired',
        'count', count(*) FILTER (WHERE batch.expiry_date < current_date),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE batch.expiry_date < current_date), 0)
      ),
      jsonb_build_object(
        'key', '0-30', 'label', '0-30 days',
        'count', count(*) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date AND current_date + 30),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date AND current_date + 30), 0)
      ),
      jsonb_build_object(
        'key', '31-60', 'label', '31-60 days',
        'count', count(*) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date + 31 AND current_date + 60),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date + 31 AND current_date + 60), 0)
      ),
      jsonb_build_object(
        'key', '61-90', 'label', '61-90 days',
        'count', count(*) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date + 61 AND current_date + 90),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date BETWEEN current_date + 61 AND current_date + 90), 0)
      ),
      jsonb_build_object(
        'key', '90+', 'label', '90+ days',
        'count', count(*) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date > current_date + 90),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) FILTER (WHERE medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY') AND batch.expiry_date > current_date + 90), 0)
      )
    )
  )
  INTO v_expected_buckets
  FROM public.stock_batches batch
  JOIN public.medicines medicine
    ON medicine.id = batch.medicine_id AND medicine.shop_id = v_shop_id
  WHERE batch.shop_id = v_shop_id
    AND batch.quantity_remaining > 0
    AND (
      batch.expiry_date < current_date
      OR (medicine.is_active AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY'))
    );
  IF v_buckets IS DISTINCT FROM v_expected_buckets THEN
    RAISE EXCEPTION 'Stock expiry buckets do not match caller-shop-only values.';
  END IF;

  RAISE NOTICE 'Batch 032 stock shop-scope smoke test passed; all test rows will roll back.';
END;
$test$;

ROLLBACK;
