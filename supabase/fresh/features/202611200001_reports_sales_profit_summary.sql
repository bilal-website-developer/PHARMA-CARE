-- Owner-run draft. Review the matching README and smoke test before applying.
begin;

do $preflight$
begin
  if to_regclass('public.sales') is null
    or to_regclass('public.sale_items') is null
    or to_regclass('public.sale_item_batch_allocations') is null
    or to_regclass('public.sale_returns') is null
    or to_regclass('public.sale_return_items') is null
    or to_regprocedure('tenant_private.current_shop_id()') is null
    or to_regprocedure('public.has_any_permission(text[])') is null
    or to_regprocedure('public.can_view_cost()') is null then
    raise exception 'Required shop-scoped sales, return, or permission objects are missing.';
  end if;
  if exists (
    select 1
    from (values
      ('sales', 'shop_id'),
      ('sale_items', 'shop_id'),
      ('sale_items', 'cost_paisa_per_base_unit'),
      ('sale_item_batch_allocations', 'shop_id'),
      ('sale_item_batch_allocations', 'cost_paisa_per_base_unit'),
      ('sale_returns', 'shop_id'),
      ('sale_return_items', 'shop_id')
    ) as required_column(table_name, column_name)
    where not exists (
      select 1 from information_schema.columns as column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = required_column.table_name
        and column_info.column_name = required_column.column_name
    )
  ) then
    raise exception 'Required tenant or sale-time cost columns are missing.';
  end if;
  if to_regprocedure('public.reports_sales_profit_summary(timestamp with time zone,timestamp with time zone)') is not null then
    raise exception 'A profit summary RPC already exists; inspect it before replacing anything.';
  end if;
end
$preflight$;

create function public.reports_sales_profit_summary(
  p_from timestamptz,
  p_to_exclusive timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_shop_id uuid := tenant_private.current_shop_id();
  v_revenue_paisa bigint;
  v_cost_paisa bigint;
  v_order_count bigint;
  v_daily jsonb;
begin
  if auth.uid() is null
    or v_shop_id is null
    or not public.has_any_permission(array['reports']::text[])
    or not public.can_view_cost() then
    raise exception using errcode = '42501', message = 'Reports profit access is required.';
  end if;
  if p_from is null or p_to_exclusive is null or p_from >= p_to_exclusive then
    raise exception using errcode = '22023', message = 'Choose a valid profit-summary date range.';
  end if;

  if exists (
    select 1
    from public.sales as sale
    join public.sale_items as sale_item
      on sale_item.sale_id = sale.id
      and sale_item.shop_id = v_shop_id
    left join lateral (
      select sum(allocation.quantity_base_units)::bigint as allocated_units
      from public.sale_item_batch_allocations as allocation
      where allocation.sale_item_id = sale_item.id
        and allocation.shop_id = v_shop_id
    ) as allocation_summary on true
    where sale.shop_id = v_shop_id
      and sale."timestamp" >= p_from
      and sale."timestamp" < p_to_exclusive
      and sale.status in ('COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED')
      and coalesce(allocation_summary.allocated_units, 0)
        not in (0, sale_item.quantity_base_units::bigint)
  ) then
    raise exception using errcode = 'P0001', message = 'Historical sale cost allocation is incomplete; profit was not calculated.';
  end if;
  if exists (
    select 1
    from public.sales as sale
    where sale.shop_id = v_shop_id
      and sale."timestamp" >= p_from
      and sale."timestamp" < p_to_exclusive
      and sale.status in ('COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED')
      and not exists (
        select 1 from public.sale_items as sale_item
        where sale_item.sale_id = sale.id and sale_item.shop_id = v_shop_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Historical sale lines are incomplete; profit was not calculated.';
  end if;

  with selected_sales as (
    select sale.id, sale."timestamp", sale.total_paisa
    from public.sales as sale
    where sale.shop_id = v_shop_id
      and sale."timestamp" >= p_from
      and sale."timestamp" < p_to_exclusive
      and sale.status in ('COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED')
  ),
  return_totals as (
    select return_header.sale_id,
      sum(return_header.refund_total_paisa)::bigint as refunded_paisa
    from public.sale_returns as return_header
    join selected_sales as sale on sale.id = return_header.sale_id
    where return_header.shop_id = v_shop_id
      and return_header.status = 'COMPLETED'
    group by return_header.sale_id
  ),
  sale_costs as (
    select sale_item.sale_id,
      sum(case
        when allocation_summary.allocated_units is null
          then sale_item.cost_paisa_per_base_unit::bigint * sale_item.quantity_base_units
        else coalesce(allocation_summary.remaining_cost_paisa, 0)
      end)::bigint as cost_paisa
    from public.sale_items as sale_item
    join selected_sales as sale on sale.id = sale_item.sale_id
    left join lateral (
      select
        sum(allocation.quantity_base_units)::bigint as allocated_units,
        sum(
          greatest(
            allocation.quantity_base_units::bigint - coalesce(returned.returned_units, 0),
            0
          ) * allocation.cost_paisa_per_base_unit::bigint
        )::bigint as remaining_cost_paisa
      from public.sale_item_batch_allocations as allocation
      left join lateral (
        select sum(return_item.quantity_base_units)::bigint as returned_units
        from public.sale_return_items as return_item
        join public.sale_returns as return_header
          on return_header.id = return_item.return_id
          and return_header.shop_id = v_shop_id
          and return_header.status = 'COMPLETED'
        where return_item.sale_item_batch_allocation_id = allocation.id
          and return_item.shop_id = v_shop_id
      ) as returned on true
      where allocation.sale_item_id = sale_item.id
        and allocation.shop_id = v_shop_id
    ) as allocation_summary on true
    where sale_item.shop_id = v_shop_id
    group by sale_item.sale_id
  ),
  sale_metrics as (
    select
      sale.id,
      sale."timestamp",
      greatest(sale.total_paisa::bigint - coalesce(returns.refunded_paisa, 0), 0) as revenue_paisa,
      coalesce(costs.cost_paisa, 0) as cost_paisa
    from selected_sales as sale
    left join return_totals as returns on returns.sale_id = sale.id
    left join sale_costs as costs on costs.sale_id = sale.id
  ),
  daily_summary as (
    select
      (sale."timestamp" at time zone 'Asia/Karachi')::date as sales_date,
      sum(sale.revenue_paisa)::bigint as revenue_paisa,
      sum(sale.cost_paisa)::bigint as cost_paisa,
      count(*)::bigint as order_count
    from sale_metrics as sale
    group by (sale."timestamp" at time zone 'Asia/Karachi')::date
  )
  select
    coalesce(sum(daily.revenue_paisa), 0)::bigint,
    coalesce(sum(daily.cost_paisa), 0)::bigint,
    coalesce(sum(daily.order_count), 0)::bigint,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'date', to_char(daily.sales_date, 'YYYY-MM-DD'),
        'revenuePaisa', daily.revenue_paisa,
        'costPaisa', daily.cost_paisa,
        'grossProfitPaisa', daily.revenue_paisa - daily.cost_paisa,
        'orderCount', daily.order_count
      ) order by daily.sales_date),
      '[]'::jsonb
    )
  into v_revenue_paisa, v_cost_paisa, v_order_count, v_daily
  from daily_summary as daily;

  return jsonb_build_object(
    'revenuePaisa', v_revenue_paisa,
    'costPaisa', v_cost_paisa,
    'grossProfitPaisa', v_revenue_paisa - v_cost_paisa,
    'orderCount', v_order_count,
    'daily', v_daily
  );
end
$function$;

revoke all on function public.reports_sales_profit_summary(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reports_sales_profit_summary(timestamptz, timestamptz)
  to authenticated;

commit;
