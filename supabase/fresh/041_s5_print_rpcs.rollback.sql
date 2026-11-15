-- Safe rollback disables these APIs; it does not restore unscoped implementations.
BEGIN;
DO $check$ DECLARE s text; d text; BEGIN FOREACH s IN ARRAY ARRAY['public.request_print(text,text,jsonb)','public.decide_print_request(uuid,text,text)','public.pending_print_count()','public.mark_printed_request(uuid)','public.list_print_requests()','public.modify_print_request(uuid,jsonb,bigint)'] LOOP IF to_regprocedure(s) IS NULL THEN RAISE EXCEPTION 'Missing %',s; END IF; SELECT lower(pg_catalog.pg_get_functiondef(oid)) INTO d FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(s); IF position('tenant_private.current_shop_id()' IN d)=0 THEN RAISE EXCEPTION '% is not scoped implementation',s; END IF; END LOOP; END; $check$;
REVOKE ALL ON FUNCTION public.request_print(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.decide_print_request(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pending_print_count() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.mark_printed_request(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.list_print_requests() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.modify_print_request(uuid,jsonb,bigint) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
