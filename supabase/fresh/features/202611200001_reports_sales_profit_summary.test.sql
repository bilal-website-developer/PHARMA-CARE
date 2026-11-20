-- Read-only metadata smoke test; execute as the database owner after applying the RPC.
do $test$
declare
  v_definition text;
  v_function regprocedure := to_regprocedure(
    'public.reports_sales_profit_summary(timestamp with time zone,timestamp with time zone)'
  );
  v_config text;
begin
  if v_function is null then
    raise exception 'FAIL: Reports profit summary RPC is missing.';
  end if;
  select pg_catalog.pg_get_functiondef(v_function),
         coalesce(array_to_string(procedure.proconfig, ','), '')
  into v_definition, v_config
  from pg_catalog.pg_proc as procedure
  where procedure.oid = v_function;

  if not exists (
    select 1 from pg_catalog.pg_proc as procedure
    where procedure.oid = v_function and procedure.prosecdef
  ) then
    raise exception 'FAIL: profit summary must be SECURITY DEFINER.';
  end if;
  if position('search_path=""' in v_config) = 0 then
    raise exception 'FAIL: profit summary must pin an empty search_path.';
  end if;
  if not has_function_privilege('authenticated', v_function, 'EXECUTE')
    or has_function_privilege('anon', v_function, 'EXECUTE') then
    raise exception 'FAIL: profit summary execute grants are incorrect.';
  end if;
  if position('tenant_private.current_shop_id()' in v_definition) = 0
    or position('public.has_any_permission' in v_definition) = 0
    or position('public.can_view_cost' in v_definition) = 0
    or position('sale_return_items' in v_definition) = 0
    or position('Asia/Karachi' in v_definition) = 0
    or position('customer_phone' in v_definition) > 0
    or position('supplier' in v_definition) > 0 then
    raise exception 'FAIL: profit summary scope, returns, date grouping, or data minimization is incorrect.';
  end if;

  raise notice 'PASS: Reports profit summary is shop-scoped, permission-checked, return-adjusted, and returns aggregates only.';
end
$test$;
