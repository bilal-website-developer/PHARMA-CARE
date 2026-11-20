-- Owner-run rollback. Roll back the frontend first so it no longer calls this RPC.
begin;

do $rollback_guard$
declare
  v_definition text;
begin
  if to_regprocedure('public.reports_sales_profit_summary(timestamp with time zone,timestamp with time zone)') is null then
    raise exception 'The Reports profit summary RPC is not installed.';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.reports_sales_profit_summary(timestamptz,timestamptz)'::regprocedure
  ) into v_definition;
  if position('Historical sale cost allocation is incomplete' in v_definition) = 0
    or position('tenant_private.current_shop_id()' in v_definition) = 0 then
    raise exception 'The RPC no longer matches this package; inspect it before rollback.';
  end if;
end
$rollback_guard$;

drop function public.reports_sales_profit_summary(timestamptz, timestamptz);

commit;
