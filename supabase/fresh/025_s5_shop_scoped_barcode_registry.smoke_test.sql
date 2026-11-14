-- Runtime S5 test for shop-scoped barcode assignment and cross-table uniqueness.
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
  v_prefix text;
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_own_medicine_id uuid;
  v_own_unit_id uuid;
  v_bulk_medicine_id uuid;
  v_manual_medicine_id uuid;
  v_foreign_medicine_id uuid;
  v_foreign_unit_id uuid;
  v_medicine_barcode text;
  v_unit_barcode text;
  v_manual_payload text;
  v_manual_barcode text;
  v_manual_assignment text;
  v_manual_own_registered boolean;
  v_manual_foreign_registered boolean;
  v_result jsonb;
  v_error text;
  v_signature text;
  v_signatures text[] := ARRAY[
    'public.assign_medicine_barcode(uuid,text,boolean)',
    'public.assign_medicine_unit_barcode(uuid,text,boolean)',
    'public.assign_missing_barcodes(uuid[])'
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

  IF has_table_privilege('anon', 'public.medicine_barcode_registry', 'SELECT')
     OR has_table_privilege('anon', 'public.medicine_barcode_registry', 'INSERT')
     OR has_table_privilege('anon', 'public.medicine_barcode_registry', 'UPDATE')
     OR has_table_privilege('anon', 'public.medicine_barcode_registry', 'DELETE')
     OR has_table_privilege('authenticated', 'public.medicine_barcode_registry', 'SELECT')
     OR has_table_privilege('authenticated', 'public.medicine_barcode_registry', 'INSERT')
     OR has_table_privilege('authenticated', 'public.medicine_barcode_registry', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.medicine_barcode_registry', 'DELETE')
     OR has_table_privilege('service_role', 'public.medicine_barcode_registry', 'SELECT')
     OR has_table_privilege('service_role', 'public.medicine_barcode_registry', 'INSERT')
     OR has_table_privilege('service_role', 'public.medicine_barcode_registry', 'UPDATE')
     OR has_table_privilege('service_role', 'public.medicine_barcode_registry', 'DELETE')
     OR has_table_privilege('anon', 'public.medicine_barcode_counters', 'SELECT')
     OR has_table_privilege('anon', 'public.medicine_barcode_counters', 'INSERT')
     OR has_table_privilege('anon', 'public.medicine_barcode_counters', 'UPDATE')
     OR has_table_privilege('anon', 'public.medicine_barcode_counters', 'DELETE')
     OR has_table_privilege('authenticated', 'public.medicine_barcode_counters', 'SELECT')
     OR has_table_privilege('authenticated', 'public.medicine_barcode_counters', 'INSERT')
     OR has_table_privilege('authenticated', 'public.medicine_barcode_counters', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.medicine_barcode_counters', 'DELETE')
     OR has_table_privilege('service_role', 'public.medicine_barcode_counters', 'SELECT')
     OR has_table_privilege('service_role', 'public.medicine_barcode_counters', 'INSERT')
     OR has_table_privilege('service_role', 'public.medicine_barcode_counters', 'UPDATE')
     OR has_table_privilege('service_role', 'public.medicine_barcode_counters', 'DELETE')
     OR has_sequence_privilege('anon', 'public.shop_barcode_prefix_seq', 'USAGE')
     OR has_sequence_privilege('anon', 'public.shop_barcode_prefix_seq', 'SELECT')
     OR has_sequence_privilege('anon', 'public.shop_barcode_prefix_seq', 'UPDATE')
     OR has_sequence_privilege('authenticated', 'public.shop_barcode_prefix_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.shop_barcode_prefix_seq', 'SELECT')
     OR has_sequence_privilege('authenticated', 'public.shop_barcode_prefix_seq', 'UPDATE')
     OR has_sequence_privilege('service_role', 'public.shop_barcode_prefix_seq', 'USAGE')
     OR has_sequence_privilege('service_role', 'public.shop_barcode_prefix_seq', 'SELECT')
     OR has_sequence_privilege('service_role', 'public.shop_barcode_prefix_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'An API role has direct access to protected barcode registry state.';
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

  LOOP
    v_manual_payload := lpad(
      floor(random() * 1000000000000)::bigint::text,
      12,
      '0'
    );
    v_manual_barcode := v_manual_payload || public.ean13_check_digit(v_manual_payload);
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.medicines AS medicine
      WHERE medicine.shop_id = v_shop_id
        AND lower(btrim(medicine.barcode)) = lower(v_manual_barcode)
      UNION ALL
      SELECT 1
      FROM public.medicine_units AS unit
      WHERE unit.shop_id = v_shop_id
        AND lower(btrim(unit.barcode)) = lower(v_manual_barcode)
    );
  END LOOP;

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

  SELECT barcode_prefix INTO v_prefix
  FROM public.shops
  WHERE id = v_shop_id;
  IF v_prefix IS NULL OR v_prefix !~ '^PCS[0-9]+$' THEN
    RAISE EXCEPTION 'The caller shop has no valid immutable barcode prefix.';
  END IF;

  INSERT INTO public.shops (name)
  VALUES ('S5 barcode registry test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.shops
    WHERE id = v_test_shop_id
      AND barcode_prefix ~ '^PCS[0-9]+$'
      AND barcode_prefix <> v_prefix
  ) THEN
    RAISE EXCEPTION 'A new shop did not receive a unique database-assigned barcode prefix.';
  END IF;

  v_error := NULL;
  BEGIN
    UPDATE public.shops
    SET barcode_prefix = barcode_prefix || 'X'
    WHERE id = v_shop_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Barcode prefix cannot be changed' THEN
    RAISE EXCEPTION 'A shop barcode prefix was mutable.';
  END IF;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_shop_id, 'S5BC-A-' || v_token, 'S5 barcode A ' || v_token,
    'S5 barcode medicine A', '1 mg', 'S5 barcode test', 'S5 barcode test',
    'OTC', true
  )
  RETURNING id INTO v_own_medicine_id;

  INSERT INTO public.medicine_units (
    shop_id, medicine_id, name, conversion_factor,
    is_default_sale_unit, price_paisa, barcode
  )
  VALUES (
    v_shop_id, v_own_medicine_id, 'S5 barcode unit A ' || v_token,
    1, true, 1000, NULL
  )
  RETURNING id INTO v_own_unit_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_shop_id, 'S5BC-B-' || v_token, 'S5 barcode B ' || v_token,
    'S5 barcode medicine B', '1 mg', 'S5 barcode test', 'S5 barcode test',
    'OTC', true
  )
  RETURNING id INTO v_bulk_medicine_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_shop_id, 'S5BC-C-' || v_token, 'S5 barcode C ' || v_token,
    'S5 barcode medicine C', '1 mg', 'S5 barcode test', 'S5 barcode test',
    'OTC', true
  )
  RETURNING id INTO v_manual_medicine_id;

  INSERT INTO public.medicines (
    shop_id, code, brand_name, generic_name, strength,
    category, company, drug_class, is_active
  )
  VALUES (
    v_test_shop_id, 'S5BC-X-' || v_token, 'S5 barcode foreign ' || v_token,
    'S5 barcode foreign medicine', '1 mg', 'S5 barcode test', 'S5 barcode test',
    'OTC', true
  )
  RETURNING id INTO v_foreign_medicine_id;
  UPDATE public.medicines
  SET barcode = v_manual_barcode
  WHERE id = v_foreign_medicine_id
    AND shop_id = v_test_shop_id;

  INSERT INTO public.medicine_units (
    shop_id, medicine_id, name, conversion_factor,
    is_default_sale_unit, price_paisa, barcode
  )
  VALUES (
    v_test_shop_id, v_foreign_medicine_id, 'S5 foreign unit ' || v_token,
    1, true, 1000, NULL
  )
  RETURNING id INTO v_foreign_unit_id;

  IF EXISTS (
    SELECT 1
    FROM public.medicine_barcode_registry AS registry
    WHERE registry.shop_id = v_shop_id
      AND registry.medicine_id = v_own_medicine_id
  ) OR EXISTS (
    SELECT 1
    FROM public.medicine_barcode_registry AS registry
    WHERE registry.medicine_unit_id = v_own_unit_id
  ) THEN
    RAISE EXCEPTION 'Empty barcode fields were incorrectly registered.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_medicine_barcode := public.assign_medicine_barcode(v_own_medicine_id, NULL, false);
  IF v_medicine_barcode !~ ('^' || v_prefix || '-[0-9]{9}$')
     OR NOT EXISTS (
       SELECT 1
       FROM public.medicine_barcode_registry AS registry
       WHERE registry.shop_id = v_shop_id
         AND registry.normalized_barcode = lower(v_medicine_barcode)
         AND registry.medicine_id = v_own_medicine_id
         AND registry.medicine_unit_id IS NULL
     ) THEN
    RAISE EXCEPTION 'Medicine barcode generation or registry synchronization failed.';
  END IF;

  v_unit_barcode := public.assign_medicine_unit_barcode(v_own_unit_id, NULL, false);
  IF v_unit_barcode !~ ('^' || v_prefix || '-[0-9]{9}$')
     OR v_unit_barcode = v_medicine_barcode
     OR NOT EXISTS (
       SELECT 1
       FROM public.medicine_barcode_registry AS registry
       WHERE registry.shop_id = v_shop_id
         AND registry.normalized_barcode = lower(v_unit_barcode)
         AND registry.medicine_unit_id = v_own_unit_id
         AND registry.medicine_id IS NULL
     ) THEN
    RAISE EXCEPTION 'Medicine-unit barcode generation or registry synchronization failed.';
  END IF;

  UPDATE public.medicine_units
  SET barcode = 'S5-TRIGGER-' || v_token
  WHERE id = v_own_unit_id;
  IF NOT EXISTS (
    SELECT 1
    FROM public.medicine_barcode_registry AS registry
    WHERE registry.shop_id = v_shop_id
      AND registry.normalized_barcode = lower('S5-TRIGGER-' || v_token)
      AND registry.medicine_unit_id = v_own_unit_id
  ) OR EXISTS (
    SELECT 1
    FROM public.medicine_barcode_registry AS registry
    WHERE registry.shop_id = v_shop_id
      AND registry.normalized_barcode = lower(v_unit_barcode)
  ) THEN
    RAISE EXCEPTION 'Unit barcode update did not synchronize the registry.';
  END IF;
  UPDATE public.medicine_units
  SET barcode = v_unit_barcode
  WHERE id = v_own_unit_id;
  UPDATE public.medicine_units
  SET barcode = NULL
  WHERE id = v_own_unit_id;
  IF EXISTS (
    SELECT 1
    FROM public.medicine_barcode_registry AS registry
    WHERE registry.shop_id = v_shop_id
      AND registry.medicine_unit_id = v_own_unit_id
  ) THEN
    RAISE EXCEPTION 'Clearing a unit barcode did not remove its registry entry.';
  END IF;
  UPDATE public.medicine_units
  SET barcode = v_unit_barcode
  WHERE id = v_own_unit_id;

  v_error := NULL;
  BEGIN
    PERFORM public.assign_medicine_unit_barcode(
      v_own_unit_id,
      lower(v_medicine_barcode),
      true
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Barcode is already assigned in this shop'
     OR NOT EXISTS (
       SELECT 1
       FROM public.medicine_units
       WHERE id = v_own_unit_id
         AND barcode = v_unit_barcode
     ) THEN
    RAISE EXCEPTION 'Cross-table normalized duplicate barcode was not rejected.';
  END IF;

  v_manual_assignment := public.assign_medicine_barcode(
    v_manual_medicine_id,
    v_manual_barcode,
    false
  );
  SELECT EXISTS (
    SELECT 1
    FROM public.medicine_barcode_registry AS registry
    WHERE registry.shop_id = v_shop_id
      AND registry.normalized_barcode = lower(v_manual_barcode)
      AND registry.medicine_id = v_manual_medicine_id
  ) INTO v_manual_own_registered;
  SELECT EXISTS (
    SELECT 1
    FROM public.medicine_barcode_registry AS registry
    WHERE registry.shop_id = v_test_shop_id
      AND registry.normalized_barcode = lower(v_manual_barcode)
      AND registry.medicine_id = v_foreign_medicine_id
  ) INTO v_manual_foreign_registered;
  IF v_manual_assignment IS DISTINCT FROM v_manual_barcode
     OR NOT v_manual_own_registered
     OR NOT v_manual_foreign_registered THEN
    RAISE EXCEPTION
      'Manual EAN registry scope failed (return_matches_expected=%, own_registry=%, foreign_registry=%).',
      v_manual_assignment IS NOT DISTINCT FROM v_manual_barcode,
      v_manual_own_registered,
      v_manual_foreign_registered;
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.assign_medicine_barcode(
      v_manual_medicine_id,
      '9781234567897',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'This medicine already has a barcode. Use replace=true to overwrite it.'
     OR NOT EXISTS (
       SELECT 1
       FROM public.medicines
       WHERE id = v_manual_medicine_id
         AND barcode = v_manual_barcode
     ) THEN
    RAISE EXCEPTION 'A NULL replace flag bypassed the barcode overwrite guard.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.assign_medicine_unit_barcode(
      v_own_unit_id,
      v_manual_barcode,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Barcode is already assigned in this shop' THEN
    RAISE EXCEPTION 'A manual medicine/unit barcode collision was not rejected.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.assign_medicine_barcode(v_foreign_medicine_id, 'S5-FOREIGN', true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Medicine not found' THEN
    RAISE EXCEPTION 'The medicine barcode RPC did not hide a foreign-shop medicine.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.assign_medicine_unit_barcode(v_foreign_unit_id, 'S5-FOREIGN-UNIT', true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Medicine unit not found' THEN
    RAISE EXCEPTION 'The unit barcode RPC did not hide a foreign-shop unit.';
  END IF;

  v_result := public.assign_missing_barcodes(
    ARRAY[v_bulk_medicine_id, v_foreign_medicine_id, NULL]::uuid[]
  );
  IF v_result->>'assigned' IS DISTINCT FROM '1'
     OR v_result->>'skipped' IS DISTINCT FROM '0'
     OR v_result->>'failed' IS DISTINCT FROM '2'
     OR NOT EXISTS (
       SELECT 1
       FROM public.medicine_barcode_registry AS registry
       WHERE registry.shop_id = v_shop_id
         AND registry.medicine_id = v_bulk_medicine_id
     ) THEN
    RAISE EXCEPTION 'Bulk barcode assignment did not scope and report results correctly.';
  END IF;

  v_result := public.assign_missing_barcodes(ARRAY[v_bulk_medicine_id]::uuid[]);
  IF v_result->>'assigned' IS DISTINCT FROM '0'
     OR v_result->>'skipped' IS DISTINCT FROM '1'
     OR v_result->>'failed' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Bulk barcode assignment did not skip a medicine already assigned.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin::text, 'role', 'authenticated')::text,
    true
  );
  v_error := NULL;
  BEGIN
    PERFORM public.assign_medicine_barcode(v_own_medicine_id, NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active user with products permission is required' THEN
    RAISE EXCEPTION 'A platform-only Super Admin was not rejected by medicine barcode assignment.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.assign_medicine_unit_barcode(v_own_unit_id, NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active user with products permission is required' THEN
    RAISE EXCEPTION 'A platform-only Super Admin was not rejected by unit barcode assignment.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND action = 'assign_medicine_barcode'
      AND entity_id = v_own_medicine_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND action = 'assign_medicine_unit_barcode'
      AND entity_id = v_own_unit_id
  ) THEN
    RAISE EXCEPTION 'Barcode assignment audit events were not recorded for the caller shop.';
  END IF;

  RAISE NOTICE 's5_shop_scoped_barcode_registry_smoke_test: all_passed=true';
END
$test$;

ROLLBACK;
