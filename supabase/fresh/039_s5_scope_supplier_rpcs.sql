-- Batch 039: backfill the two unreferenced suppliers and scope supplier writes.
-- Query 035 found three unscoped supplier RPCs; the two unassigned rows have no references.
-- Owner-run only. CREATE OR REPLACE preserves the reviewed function ACLs.
-- If execution fails before COMMIT, issue ROLLBACK and stop for review.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $preflight$
DECLARE
  v_signature text;
  v_expected_arguments text;
  v_expected_result text;
  v_routine pg_catalog.pg_proc%rowtype;
  v_shop_id uuid;
  v_shop_count bigint;
  v_supplier_count bigint;
  v_null_supplier_count bigint;
  v_null_active_count bigint;
  v_null_inactive_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this migration as the reviewed database owner role with RLS bypass.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);

  IF to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL THEN
    RAISE EXCEPTION 'Required tenant or permission helpers are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class table_class
    WHERE table_class.oid = 'public.suppliers'::regclass
      AND table_class.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'suppliers'
      AND column_info.column_name = 'shop_id'
  ) THEN
    RAISE EXCEPTION 'The suppliers table must have shop_id and enabled RLS.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index index_row
    WHERE index_row.indexrelid = to_regclass('public.suppliers_shop_id_id_key')
      AND index_row.indisunique
      AND index_row.indisvalid
  )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint constraint_row
       WHERE constraint_row.conrelid = 'public.purchases'::regclass
         AND constraint_row.conname = 'purchases_supplier_shop_id_fkey'
         AND constraint_row.convalidated
     ) OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint constraint_row
       WHERE constraint_row.conrelid = 'public.stock_batches'::regclass
         AND constraint_row.conname = 'stock_batches_supplier_shop_id_fkey'
         AND constraint_row.convalidated
     ) OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint constraint_row
       WHERE constraint_row.conrelid = 'public.supplier_ledger'::regclass
         AND constraint_row.conname = 'supplier_ledger_supplier_shop_id_fkey'
         AND constraint_row.convalidated
     ) THEN
    RAISE EXCEPTION 'Expected validated shop-scoped supplier keys/references are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.suppliers'::regclass
      AND tgname = 'suppliers_assign_shop_id'
      AND NOT tgisinternal
      AND tgenabled IN ('O', 'A')
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND tgname = 'audit_logs_assign_shop_id'
      AND NOT tgisinternal
      AND tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'Supplier or audit shop-attribution trigger is missing or disabled.';
  END IF;

  LOCK TABLE public.suppliers IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*)::bigint
  INTO v_shop_count
  FROM public.shops;
  IF v_shop_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one current shop before supplier backfill; found %.', v_shop_count;
  END IF;

  SELECT counter.shop_id
  INTO v_shop_id
  FROM public.purchase_number_state counter
  WHERE counter.id = 1
    AND counter.shop_id IS NOT NULL;
  IF v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.shops shop
    WHERE shop.id = v_shop_id
      AND shop.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The existing purchase counter does not identify the current shop.';
  END IF;

  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE supplier.shop_id IS NULL)::bigint,
    count(*) FILTER (WHERE supplier.shop_id IS NULL AND supplier.is_active)::bigint,
    count(*) FILTER (WHERE supplier.shop_id IS NULL AND NOT supplier.is_active)::bigint
  INTO v_supplier_count, v_null_supplier_count, v_null_active_count, v_null_inactive_count
  FROM public.suppliers supplier;

  IF v_supplier_count <> 4
     OR v_null_supplier_count <> 2
     OR v_null_active_count <> 2
     OR v_null_inactive_count <> 0
     OR EXISTS (
       SELECT 1
       FROM public.suppliers supplier
       WHERE supplier.shop_id IS NOT NULL
         AND supplier.shop_id <> v_shop_id
     ) THEN
    RAISE EXCEPTION 'Supplier rows changed from the reviewed state; inspect before backfilling.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.suppliers supplier
    WHERE supplier.shop_id IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.purchases purchase
          WHERE purchase.supplier_id = supplier.id
        )
        OR EXISTS (
          SELECT 1 FROM public.stock_batches batch
          WHERE batch.supplier_id = supplier.id
        )
        OR EXISTS (
          SELECT 1 FROM public.supplier_ledger ledger
          WHERE ledger.supplier_id = supplier.id
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.purchases purchase
    JOIN public.suppliers supplier ON supplier.id = purchase.supplier_id
    WHERE purchase.shop_id IS DISTINCT FROM supplier.shop_id
  ) OR EXISTS (
    SELECT 1
    FROM public.stock_batches batch
    JOIN public.suppliers supplier ON supplier.id = batch.supplier_id
    WHERE batch.shop_id IS DISTINCT FROM supplier.shop_id
  ) OR EXISTS (
    SELECT 1
    FROM public.supplier_ledger ledger
    JOIN public.suppliers supplier ON supplier.id = ledger.supplier_id
    WHERE ledger.shop_id IS DISTINCT FROM supplier.shop_id
  ) THEN
    RAISE EXCEPTION 'Unassigned or mismatched supplier references exist; stop and inspect before backfilling.';
  END IF;

  FOR v_signature, v_expected_arguments, v_expected_result IN
    SELECT expected.signature, expected.identity_arguments, expected.result_type
    FROM (VALUES
      ('public.save_supplier(uuid,text,text,text,text,text)', 'p_supplier_id uuid, p_name text, p_contact text, p_address text, p_licence_or_tax_number text, p_payment_terms text', 'uuid'),
      ('public.deactivate_supplier(uuid)', 'p_supplier_id uuid', 'uuid'),
      ('public.activate_supplier(uuid)', 'p_supplier_id uuid', 'uuid')
    ) AS expected(signature, identity_arguments, result_type)
  LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Expected supplier RPC % is missing.', v_signature;
    END IF;

    SELECT * INTO v_routine
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure(v_signature);

    IF pg_catalog.pg_get_function_identity_arguments(v_routine.oid) <> v_expected_arguments
       OR pg_catalog.pg_get_function_result(v_routine.oid) <> v_expected_result
       OR NOT v_routine.prosecdef
       OR NOT (coalesce(v_routine.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public'])
       OR NOT has_function_privilege('authenticated', v_routine.oid, 'EXECUTE')
       OR has_function_privilege('anon', v_routine.oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM aclexplode(coalesce(v_routine.proacl, acldefault('f', v_routine.proowner))) privilege
         WHERE privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Supplier RPC % has an unexpected signature, result, security setting, or grant.', v_signature;
    END IF;
  END LOOP;
END
$preflight$;

UPDATE public.suppliers
SET shop_id = (
  SELECT counter.shop_id
  FROM public.purchase_number_state counter
  WHERE counter.id = 1
)
WHERE shop_id IS NULL;

DO $backfill_check$
BEGIN
  IF (SELECT count(*) FROM public.suppliers) <> 4
     OR (SELECT count(*) FROM public.suppliers WHERE shop_id IS NULL) <> 0
     OR (SELECT count(DISTINCT shop_id) FROM public.suppliers) <> 1
     OR EXISTS (
       SELECT 1
       FROM public.suppliers supplier
       WHERE supplier.shop_id IS DISTINCT FROM (
         SELECT counter.shop_id
         FROM public.purchase_number_state counter
         WHERE counter.id = 1
       )
     ) THEN
    RAISE EXCEPTION 'Supplier shop backfill did not produce the expected four rows for the current shop.';
  END IF;
END
$backfill_check$;

CREATE OR REPLACE FUNCTION public.save_supplier(
  p_supplier_id uuid,
  p_name text,
  p_contact text,
  p_address text,
  p_licence_or_tax_number text,
  p_payment_terms text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_supplier_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_contact text := btrim(coalesce(p_contact, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_licence text := btrim(coalesce(p_licence_or_tax_number, ''));
  v_payment_terms text := btrim(coalesce(p_payment_terms, ''));
  v_action text;
BEGIN
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_actor
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active shop user is required';
  END IF;
  IF NOT public.has_any_permission(ARRAY['suppliers']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to manage suppliers';
  END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'Supplier name is required'; END IF;
  IF length(v_name) > 200 THEN RAISE EXCEPTION 'Supplier name is too long'; END IF;
  IF length(v_contact) > 500 THEN RAISE EXCEPTION 'Supplier contact is too long'; END IF;
  IF length(v_address) > 2000 THEN RAISE EXCEPTION 'Supplier address is too long'; END IF;
  IF length(v_licence) > 500 THEN RAISE EXCEPTION 'Supplier licence or tax number is too long'; END IF;
  IF v_payment_terms = '' OR length(v_payment_terms) > 100 THEN
    RAISE EXCEPTION 'Supplier payment terms are invalid';
  END IF;

  IF p_supplier_id IS NULL THEN
    INSERT INTO public.suppliers (
      shop_id, name, contact, address, licence_or_tax_number, payment_terms, is_active
    )
    VALUES (
      v_shop_id, v_name, v_contact, v_address, v_licence, v_payment_terms, true
    )
    RETURNING id INTO v_supplier_id;
    v_action := 'supplier_created';
  ELSE
    UPDATE public.suppliers
    SET name = v_name,
        contact = v_contact,
        address = v_address,
        licence_or_tax_number = v_licence,
        payment_terms = v_payment_terms
    WHERE id = p_supplier_id
      AND shop_id = v_shop_id
    RETURNING id INTO v_supplier_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found'; END IF;
    v_action := 'supplier_updated';
  END IF;

  INSERT INTO public.audit_logs (actor_id, shop_id, action, entity, entity_id, details)
  VALUES (
    v_actor,
    v_shop_id,
    v_action,
    'suppliers',
    v_supplier_id,
    jsonb_build_object('supplier_id', v_supplier_id)
  );

  RETURN v_supplier_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.deactivate_supplier(p_supplier_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_supplier_id uuid;
BEGIN
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_actor
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active shop user is required';
  END IF;
  IF NOT public.has_any_permission(ARRAY['suppliers']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to manage suppliers';
  END IF;
  IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'A supplier is required'; END IF;

  UPDATE public.suppliers
  SET is_active = false
  WHERE id = p_supplier_id
    AND shop_id = v_shop_id
    AND is_active = true
  RETURNING id INTO v_supplier_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active supplier not found'; END IF;

  INSERT INTO public.audit_logs (actor_id, shop_id, action, entity, entity_id, details)
  VALUES (
    v_actor,
    v_shop_id,
    'supplier_deactivated',
    'suppliers',
    v_supplier_id,
    jsonb_build_object('supplier_id', v_supplier_id)
  );

  RETURN v_supplier_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_supplier(p_supplier_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_supplier_id uuid;
BEGIN
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_actor
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active shop user is required';
  END IF;
  IF NOT public.has_any_permission(ARRAY['suppliers']::text[]) THEN
    RAISE EXCEPTION 'You do not have permission to manage suppliers';
  END IF;
  IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'A supplier is required'; END IF;

  UPDATE public.suppliers
  SET is_active = true
  WHERE id = p_supplier_id
    AND shop_id = v_shop_id
    AND is_active = false
  RETURNING id INTO v_supplier_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inactive supplier not found'; END IF;

  INSERT INTO public.audit_logs (actor_id, shop_id, action, entity, entity_id, details)
  VALUES (
    v_actor,
    v_shop_id,
    'supplier_activated',
    'suppliers',
    v_supplier_id,
    jsonb_build_object('supplier_id', v_supplier_id)
  );

  RETURN v_supplier_id;
END;
$function$;

COMMIT;
