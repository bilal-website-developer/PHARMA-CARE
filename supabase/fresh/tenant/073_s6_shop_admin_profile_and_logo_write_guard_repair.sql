-- Owner-run repair for package 073 installations created before its tenant
-- write-guard trigger was added. Safe to rerun; refuses an unexpected trigger.
BEGIN;

DO $repair$
DECLARE
  v_table_oid oid := to_regclass('public.shop_logo_upload_paths')::oid;
  v_guard_function_oid oid := to_regprocedure('tenant_private.reject_inactive_shop_write()')::oid;
  v_existing_function_oid oid;
BEGIN
  IF v_table_oid IS NULL OR v_guard_function_oid IS NULL THEN
    RAISE EXCEPTION 'Package 073 and package 069 must be installed before this repair.';
  END IF;

  SELECT trigger_row.tgfoid
  INTO v_existing_function_oid
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE NOT trigger_row.tgisinternal
    AND trigger_row.tgname = 'inactive_shop_write_guard'
    AND trigger_row.tgrelid = v_table_oid;

  IF FOUND AND v_existing_function_oid <> v_guard_function_oid THEN
    RAISE EXCEPTION 'An unexpected inactive_shop_write_guard exists on shop_logo_upload_paths; inspect before repair.';
  END IF;

  IF NOT FOUND THEN
    EXECUTE
      'CREATE TRIGGER inactive_shop_write_guard
       BEFORE INSERT OR UPDATE OR DELETE ON public.shop_logo_upload_paths
       FOR EACH ROW EXECUTE FUNCTION tenant_private.reject_inactive_shop_write()';
  ELSE
    EXECUTE 'ALTER TABLE public.shop_logo_upload_paths ENABLE TRIGGER inactive_shop_write_guard';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE NOT trigger_row.tgisinternal
      AND trigger_row.tgname = 'inactive_shop_write_guard'
      AND trigger_row.tgrelid = v_table_oid
      AND trigger_row.tgfoid = v_guard_function_oid
      AND trigger_row.tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'The shop-logo upload-path inactive-shop guard did not pass postflight.';
  END IF;
END
$repair$;

COMMIT;
