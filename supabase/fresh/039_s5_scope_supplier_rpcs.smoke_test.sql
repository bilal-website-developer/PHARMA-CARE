-- Runtime test for supplier backfill, shop-scoped writes, and audit attribution.
-- All fixtures are rolled back when the transaction succeeds.
-- If the SQL Editor leaves a failed transaction open, issue ROLLBACK.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $test$
DECLARE
  v_actor uuid;
  v_super_admin uuid;
  v_shop_id uuid;
  v_test_shop_id uuid;
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_own_supplier_id uuid;
  v_foreign_active_supplier_id uuid;
  v_foreign_inactive_supplier_id uuid;
  v_result_id uuid;
  v_error text;
  v_signature text;
  v_signatures text[] := ARRAY[
    'public.save_supplier(uuid,text,text,text,text,text)',
    'public.deactivate_supplier(uuid)',
    'public.activate_supplier(uuid)'
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
       )
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS routine
         CROSS JOIN LATERAL aclexplode(coalesce(
           routine.proacl,
           acldefault('f', routine.proowner)
         )) AS privilege
         WHERE routine.oid = to_regprocedure(v_signature)
           AND privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Supplier routine % is missing or has unexpected shop scope, grants, or security settings.', v_signature;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.suppliers) <> 4
     OR (SELECT count(*) FROM public.suppliers WHERE shop_id IS NULL) <> 0
     OR (SELECT count(DISTINCT shop_id) FROM public.suppliers) <> 1 THEN
    RAISE EXCEPTION 'Supplier backfill did not assign all four reviewed rows to one shop.';
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
  IF NOT EXISTS (
    SELECT 1
    FROM public.shops
    WHERE id = v_shop_id
      AND status = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM public.suppliers
    WHERE shop_id IS DISTINCT FROM v_shop_id
  ) THEN
    RAISE EXCEPTION 'The backfilled suppliers do not all belong to the active caller shop.';
  END IF;

  SELECT id
  INTO v_super_admin
  FROM public.profiles
  WHERE role = 'super_admin'
    AND is_active = true
    AND deleted_at IS NULL
  ORDER BY id
  LIMIT 1;
  IF v_super_admin IS NULL THEN
    RAISE EXCEPTION 'An active platform Super Admin profile is required for this smoke test.';
  END IF;

  INSERT INTO public.shops (name)
  VALUES ('S5 supplier scope test ' || v_token)
  RETURNING id INTO v_test_shop_id;

  INSERT INTO public.suppliers (
    shop_id, name, contact, address, licence_or_tax_number, payment_terms, is_active
  )
  VALUES (
    v_test_shop_id, 'S5 foreign active ' || v_token, '', '', '',
    'CASH', true
  )
  RETURNING id INTO v_foreign_active_supplier_id;

  INSERT INTO public.suppliers (
    shop_id, name, contact, address, licence_or_tax_number, payment_terms, is_active
  )
  VALUES (
    v_test_shop_id, 'S5 foreign inactive ' || v_token, '', '', '',
    'CASH', false
  )
  RETURNING id INTO v_foreign_inactive_supplier_id;
  IF v_foreign_active_supplier_id IS NULL
     OR v_foreign_inactive_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Foreign-shop supplier fixtures were not created.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  v_own_supplier_id := public.save_supplier(
    NULL,
    'S5 own supplier ' || v_token,
    'Initial contact',
    'Initial address',
    'S5-' || v_token,
    'NET 30'
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.suppliers
    WHERE id = v_own_supplier_id
      AND shop_id = v_shop_id
      AND name = 'S5 own supplier ' || v_token
      AND is_active
  ) THEN
    RAISE EXCEPTION 'New supplier was not assigned to the caller shop.';
  END IF;

  v_result_id := public.save_supplier(
    v_own_supplier_id,
    'S5 own supplier updated ' || v_token,
    'Updated contact',
    'Updated address',
    'S5U-' || v_token,
    'PREPAID'
  );
  IF v_result_id IS DISTINCT FROM v_own_supplier_id
     OR NOT EXISTS (
       SELECT 1
       FROM public.suppliers
       WHERE id = v_own_supplier_id
         AND shop_id = v_shop_id
         AND name = 'S5 own supplier updated ' || v_token
         AND contact = 'Updated contact'
         AND address = 'Updated address'
         AND licence_or_tax_number = 'S5U-' || v_token
         AND payment_terms = 'PREPAID'
     ) THEN
    RAISE EXCEPTION 'Same-shop supplier update failed or changed the wrong row.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_supplier(
      v_foreign_active_supplier_id,
      'S5 unauthorized supplier update',
      '',
      '',
      '',
      'CASH'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Supplier not found' THEN
    RAISE EXCEPTION 'save_supplier did not hide a supplier ID owned by another shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.deactivate_supplier(v_foreign_active_supplier_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Active supplier not found' THEN
    RAISE EXCEPTION 'deactivate_supplier did not reject a supplier owned by another shop.';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.activate_supplier(v_foreign_inactive_supplier_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'Inactive supplier not found' THEN
    RAISE EXCEPTION 'activate_supplier did not reject a supplier owned by another shop.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.suppliers
    WHERE id = v_foreign_active_supplier_id
      AND shop_id = v_test_shop_id
      AND name = 'S5 foreign active ' || v_token
      AND is_active
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.suppliers
    WHERE id = v_foreign_inactive_supplier_id
      AND shop_id = v_test_shop_id
      AND name = 'S5 foreign inactive ' || v_token
      AND NOT is_active
  ) OR EXISTS (
    SELECT 1
    FROM public.audit_logs
    WHERE entity = 'suppliers'
      AND entity_id IN (v_foreign_active_supplier_id, v_foreign_inactive_supplier_id)
  ) THEN
    RAISE EXCEPTION 'A foreign-shop supplier or its audit history was changed.';
  END IF;

  v_result_id := public.deactivate_supplier(v_own_supplier_id);
  IF v_result_id IS DISTINCT FROM v_own_supplier_id
     OR NOT EXISTS (
       SELECT 1
       FROM public.suppliers
       WHERE id = v_own_supplier_id
         AND shop_id = v_shop_id
         AND NOT is_active
     ) THEN
    RAISE EXCEPTION 'Same-shop supplier deactivation failed.';
  END IF;

  v_result_id := public.activate_supplier(v_own_supplier_id);
  IF v_result_id IS DISTINCT FROM v_own_supplier_id
     OR NOT EXISTS (
       SELECT 1
       FROM public.suppliers
       WHERE id = v_own_supplier_id
         AND shop_id = v_shop_id
         AND is_active
     ) THEN
    RAISE EXCEPTION 'Same-shop supplier activation failed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND entity = 'suppliers'
      AND entity_id = v_own_supplier_id
      AND action = 'supplier_created'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND entity = 'suppliers'
      AND entity_id = v_own_supplier_id
      AND action = 'supplier_updated'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND entity = 'suppliers'
      AND entity_id = v_own_supplier_id
      AND action = 'supplier_deactivated'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = v_actor
      AND shop_id = v_shop_id
      AND entity = 'suppliers'
      AND entity_id = v_own_supplier_id
      AND action = 'supplier_activated'
  ) THEN
    RAISE EXCEPTION 'Supplier audit events were not attributed to the caller shop.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_super_admin::text, 'role', 'authenticated')::text,
    true
  );
  v_error := NULL;
  BEGIN
    PERFORM public.save_supplier(
      NULL,
      'S5 platform-only supplier ' || v_token,
      '',
      '',
      '',
      'CASH'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  END;
  IF v_error IS DISTINCT FROM 'An active shop user is required' THEN
    RAISE EXCEPTION 'Platform Super Admin was not rejected by the supplier RPC.';
  END IF;

  RAISE NOTICE 'Batch 039 supplier shop-scope smoke test passed; all test rows will roll back.';
END
$test$;

ROLLBACK;
