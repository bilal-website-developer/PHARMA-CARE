-- Safe rollback for 050H: disable the five RPCs rather than restore their
-- known unscoped implementations. Re-enabling requires a scoped replacement.
BEGIN;

DO $preflight$
DECLARE
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
  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Scoped RPC % is missing; stop and inspect.', v_signature;
    END IF;

    SELECT lower(pg_catalog.pg_get_functiondef(routine.oid))
    INTO v_definition
    FROM pg_catalog.pg_proc routine
    WHERE routine.oid = to_regprocedure(v_signature);

    IF position('tenant_private.current_shop_id()' IN v_definition) = 0
       OR position('v_shop_id' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Scoped implementation % is not installed; stop and inspect.', v_signature;
    END IF;
  END LOOP;
END;
$preflight$;

REVOKE ALL ON FUNCTION public.master_data_overview()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pos_customers()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_customer(text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_customer_payment(uuid, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sales_history(integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
