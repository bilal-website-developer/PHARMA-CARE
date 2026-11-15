-- Safe rollback disables the purchase APIs; it does not restore known-unscoped bodies.
-- Keep the per-shop counter key: reverting it could merge live counters.
BEGIN;
DO $check$ DECLARE s text; d text; BEGIN FOREACH s IN ARRAY ARRAY['public.post_purchase(uuid,text,date,integer,text,jsonb,integer,text)','public.purchase_catalog()','public.purchase_history(text,text,date,date,integer,integer,boolean)','public.purchase_detail(uuid)','public.void_purchase(uuid,text)'] LOOP IF to_regprocedure(s) IS NULL THEN RAISE EXCEPTION 'Missing %',s; END IF; SELECT lower(pg_catalog.pg_get_functiondef(oid)) INTO d FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(s); IF position('tenant_private.current_shop_id()' IN d)=0 THEN RAISE EXCEPTION '% is not scoped implementation',s; END IF; END LOOP; END; $check$;
REVOKE ALL ON FUNCTION public.post_purchase(uuid,text,date,integer,text,jsonb,integer,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.purchase_catalog() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.purchase_history(text,text,date,date,integer,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.purchase_detail(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.void_purchase(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
