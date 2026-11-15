-- Read-only post-apply SECURITY DEFINER catalog check.
WITH routines AS (
 SELECT p.oid,p.proname,p.prokind AS routine_kind,pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
        pg_catalog.pg_get_function_result(p.oid) AS result_type,p.proconfig,
        pg_catalog.pg_get_functiondef(p.oid) AS function_definition,
        position('tenant_private.current_shop_id()' IN lower(pg_catalog.pg_get_functiondef(p.oid)))>0 AS has_shop_helper,
        lower(pg_catalog.pg_get_functiondef(p.oid)) ~ 'public\.(medicines|medicine_units|suppliers|purchases|purchase_items|stock_batches|stock_movements|supplier_ledger|print_requests|trash_bin_events|sales|sale_items|sale_returns|customers|khata_entries|audit_logs|brands|categories|barcode_registry)' AS references_business_tables,
        p.prorettype='trigger'::regtype AS is_trigger,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
        EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
        has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
        has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_execute,
        CASE WHEN p.proname IN ('is_admin','has_any_permission','can_view_cost','current_user_role','get_my_profile','has_permission','is_super_admin','trash_bin_finalize_profile_purge') THEN true
             WHEN NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE') THEN true
             ELSE false END AS reviewed_global_or_service_helper
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND p.prokind IN ('f','p')
)
SELECT proname,routine_kind,identity_arguments,result_type,proconfig,has_shop_helper,is_trigger,
       anon_execute,public_execute,authenticated_execute,service_role_execute,
       (NOT has_shop_helper AND references_business_tables AND NOT is_trigger
        AND NOT reviewed_global_or_service_helper) AS unscoped_business
FROM routines
ORDER BY unscoped_business DESC,proname,identity_arguments;

-- Expected after 052: unscoped_business_count = 0.
WITH routines AS (SELECT p.oid,p.proname,p.prokind,
 position('tenant_private.current_shop_id()' IN lower(pg_catalog.pg_get_functiondef(p.oid)))>0 AS has_shop_helper,
 lower(pg_catalog.pg_get_functiondef(p.oid)) ~ 'public\.(medicines|medicine_units|suppliers|purchases|purchase_items|stock_batches|stock_movements|supplier_ledger|print_requests|trash_bin_events|sales|sale_items|sale_returns|customers|khata_entries|audit_logs|brands|categories|barcode_registry)' AS references_business_tables,
 p.prorettype='trigger'::regtype AS is_trigger,
 CASE WHEN p.proname IN ('is_admin','has_any_permission','can_view_cost','current_user_role','get_my_profile','has_permission','is_super_admin','trash_bin_finalize_profile_purge') THEN true
      WHEN NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE') THEN true ELSE false END AS reviewed_helper
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND p.prokind IN ('f','p'))
SELECT count(*) FILTER(WHERE NOT has_shop_helper AND references_business_tables AND NOT is_trigger AND NOT reviewed_helper) AS unscoped_business_count,
       count(*) AS public_security_definer_routine_count
FROM routines;
