-- Read-only verification after applying 202611200004_approval_automation.sql.
DO $test$
DECLARE
  v_default text;
  v_definition text;
  v_is_definer boolean;
BEGIN
  IF to_regprocedure('public.get_approval_automation_settings()') IS NULL
     OR to_regprocedure('public.update_approval_automation_settings(boolean,boolean)') IS NULL
     OR to_regprocedure('public.request_print(text,text,jsonb)') IS NULL
     OR to_regprocedure('public.request_print_v2(text,text,jsonb,uuid)') IS NULL
     OR to_regprocedure('public.claim_auto_approved_print_request(uuid)') IS NULL
     OR to_regprocedure('public.mark_auto_approved_print_request_opened(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: one or more approval automation RPCs are missing.';
  END IF;

  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'shop_settings'
    AND column_name = 'auto_approve_print_requests';
  IF v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'FAIL: auto_approve_print_requests does not default to false.';
  END IF;
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'shop_settings'
    AND column_name = 'auto_process_returns';
  IF v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'FAIL: auto_process_returns does not default to false.';
  END IF;

  IF to_regclass('public.print_requests_shop_request_key_key') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'sale_returns'
         AND column_name = 'auto_processed'
         AND is_nullable = 'NO'
     ) THEN
    RAISE EXCEPTION 'FAIL: print idempotency or return automation metadata is missing.';
  END IF;

  SELECT routine.prosecdef INTO v_is_definer
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = to_regprocedure('public.update_approval_automation_settings(boolean,boolean)');
  IF v_is_definer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: the settings writer is not SECURITY DEFINER.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.request_print(text,text,jsonb)'::regprocedure
  );
  IF position('jsonb_build_object(''reused'', v_reused)' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: request_print does not identify whether it reused an older pending request.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.request_print_v2(text,text,jsonb,uuid)'::regprocedure
  );
  IF position('auto_approve_print_requests' IN v_definition) = 0
     OR position('request_key' IN v_definition) = 0
     OR position('v_created AND v_auto_approve' IN v_definition) = 0
     OR position('->>''reused''' IN v_definition) = 0
     OR position('autoApproved' IN v_definition) = 0
     OR position('auto_print_started_at' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: print auto-approval, idempotency, or one-time print claim is missing.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.process_sale_return(uuid,jsonb)'::regprocedure
  );
  IF position('app.auto_process_return_id' IN v_definition) = 0
     OR position('SALE_RETURN_AUTO_PROCESSED' IN v_definition) = 0
     OR position('auto_processed = v_is_auto' IN v_definition) = 0
     OR position('Automatic returns must be quarantined' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: auto-return ownership, audit, or quarantine-only guard is missing.';
  END IF;

  RAISE NOTICE 'PASS: default-off settings, Admin settings RPC, idempotent print approval, one-time print claim, and quarantine-only return guard verified.';
END
$test$;
