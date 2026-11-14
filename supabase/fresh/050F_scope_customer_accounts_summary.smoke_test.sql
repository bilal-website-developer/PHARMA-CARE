-- Runtime test for same-shop customer/ledger visibility and foreign-shop denial.
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
  v_own_customer_id uuid;
  v_foreign_customer_id uuid;
  v_result jsonb;
  v_error_code text;
  v_signature text := 'public.customer_accounts_summary()';
  v_function_definition text;
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
     OR has_function_privilege('service_role', to_regprocedure(v_signature), 'EXECUTE') IS FALSE
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc routine
       WHERE routine.oid = to_regprocedure(v_signature)
         AND routine.prosecdef
         AND routine.proconfig @> ARRAY['search_path=pg_catalog']
     )
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
     ) THEN
    RAISE EXCEPTION 'customer_accounts_summary() is missing or has unexpected grants/security settings.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(to_regprocedure(v_signature)::oid)
  INTO v_function_definition;
  v_function_definition := lower(v_function_definition);
  IF position('tenant_private.current_shop_id()' IN v_function_definition) = 0
     OR position('customer.shop_id = v_shop_id' IN v_function_definition) = 0
     OR position('entry.shop_id = v_shop_id' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'customer_accounts_summary() is missing its same-shop filters.';
  END IF;

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
    RAISE EXCEPTION 'An active Super Admin profile is required for this smoke test.';
  END IF;

  INSERT INTO public.shops (name)
  VALUES ('S5 customer summary test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  INSERT INTO public.customers (
    shop_id, name, phone, address, cnic,
    credit_limit_paisa, current_balance_paisa, store_credit_paisa
  )
  VALUES (
    v_shop_id, 'S5 own customer ' || v_token, '0000000000',
    'Synthetic S5 test data', NULL, 0, 0, 0
  )
  RETURNING id INTO v_own_customer_id;

  INSERT INTO public.customers (
    shop_id, name, phone, address, cnic,
    credit_limit_paisa, current_balance_paisa, store_credit_paisa
  )
  VALUES (
    v_test_shop_id, 'S5 foreign customer ' || v_token, '0000000001',
    'Synthetic S5 test data', NULL, 0, 0, 0
  )
  RETURNING id INTO v_foreign_customer_id;

  INSERT INTO public.khata_entries (
    shop_id, customer_id, entry_type, reference_number, description,
    debit_paisa, credit_paisa, created_by
  )
  VALUES
    (
      v_shop_id, v_own_customer_id, 'INVOICE', 'S5-OWN-' || v_token,
      'Synthetic own-shop ledger entry', 100, 0, v_actor
    ),
    (
      v_test_shop_id, v_foreign_customer_id, 'INVOICE', 'S5-FOREIGN-' || v_token,
      'Synthetic foreign-shop ledger entry', 200, 0, v_actor
    );

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_result := public.customer_accounts_summary();

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_result->'customers') AS result_customer(item)
    WHERE result_customer.item->>'id' = v_own_customer_id::text
  ) THEN
    RAISE EXCEPTION 'Same-shop customer was not returned.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_result->'customers') AS result_customer(item)
    WHERE result_customer.item->>'id' = v_foreign_customer_id::text
  ) THEN
    RAISE EXCEPTION 'Foreign-shop customer was returned.';
  END IF;

  IF NOT coalesce(
       (v_result->'ledgerEntries') ? v_own_customer_id::text,
       false
     )
     OR coalesce(
       (v_result->'ledgerEntries') ? v_foreign_customer_id::text,
       false
     ) THEN
    RAISE EXCEPTION 'Customer ledger entries were not limited to the caller shop.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      v_result->'ledgerEntries'->(v_own_customer_id::text)
    ) AS result_entry(item)
    WHERE result_entry.item->>'description' = 'Synthetic own-shop ledger entry'
  ) THEN
    RAISE EXCEPTION 'Same-shop ledger entry was not returned.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin::text, 'role', 'authenticated')::text,
    true
  );

  v_error_code := NULL;
  BEGIN
    PERFORM public.customer_accounts_summary();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE;
  END;
  IF v_error_code IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'A platform Super Admin was not denied shop customer-account access.';
  END IF;
END;
$test$;

SELECT
  'PASS' AS status,
  'same-shop customer and ledger visible; foreign-shop data hidden; platform Super Admin denied' AS checks;

ROLLBACK;
