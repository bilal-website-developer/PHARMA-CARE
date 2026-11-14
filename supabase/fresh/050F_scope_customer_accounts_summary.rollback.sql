-- Safe rollback for 050F: disable the RPC rather than restore its known
-- unscoped implementation. Re-enabling requires a separately reviewed fix.
BEGIN;

DO $preflight$
DECLARE
  v_function pg_catalog.pg_proc%rowtype;
  v_function_definition text;
BEGIN
  IF to_regprocedure('public.customer_accounts_summary()') IS NULL THEN
    RAISE EXCEPTION 'customer_accounts_summary() is missing; inspect before rollback.';
  END IF;

  SELECT *
  INTO v_function
  FROM pg_catalog.pg_proc
  WHERE oid = to_regprocedure('public.customer_accounts_summary()');

  v_function_definition := lower(pg_catalog.pg_get_functiondef(v_function.oid));

  IF NOT v_function.prosecdef
     OR position('tenant_private.current_shop_id()' IN v_function_definition) = 0
     OR position('customer.shop_id = v_shop_id' IN v_function_definition) = 0
     OR position('entry.shop_id = v_shop_id' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'The reviewed scoped implementation is not installed; stop and inspect.';
  END IF;
END;
$preflight$;

REVOKE ALL ON FUNCTION public.customer_accounts_summary()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
