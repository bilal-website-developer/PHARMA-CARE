-- 043: scope the existing stock-alert summary; do not create stock_alerts_list().
-- Included by 051/052; do not run this source fragment by itself.
DO $preflight$ DECLARE o oid:=to_regprocedure('public.stock_alerts_summary(integer)'); BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Owner role with RLS bypass required'; END IF; IF (SELECT count(*) FROM public.medicines)<>13 OR (SELECT count(DISTINCT shop_id) FROM public.medicines)<>1 OR EXISTS(SELECT 1 FROM public.medicines WHERE shop_id IS NULL) OR to_regprocedure('public.stock_alerts_list()') IS NOT NULL THEN RAISE EXCEPTION 'Alert preflight differs; rerun 050'; END IF; IF o IS NULL OR NOT (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public']::text[] AND has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') FROM pg_catalog.pg_proc p WHERE p.oid=o) THEN RAISE EXCEPTION 'Alert RPC differs from reviewed security/grants'; END IF; END; $preflight$;
create or replace function public.stock_alerts_summary(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_shop_id uuid := tenant_private.current_shop_id();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_low_count bigint;
  v_out_count bigint;
  v_items jsonb;
begin
  if auth.uid() is null or v_shop_id is null or not exists (select 1 from public.profiles where id=auth.uid() and shop_id=v_shop_id and role<>'super_admin' and is_active and deleted_at is null) then
    raise exception 'An active user profile is required';
  end if;

  with medicine_stock as (
    select
      medicine.id as medicine_id,
      medicine.brand_name as name,
      medicine.strength,
      medicine.generic_name,
      medicine.min_stock_alert,
      coalesce(sum(batch.quantity_remaining) filter (
        where batch.quantity_remaining > 0
          and batch.expiry_date >= current_date
          and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
      ), 0)::bigint as stock
    from public.medicines medicine
    left join public.stock_batches batch on batch.medicine_id=medicine.id and batch.shop_id=v_shop_id
    where medicine.is_active and medicine.shop_id=v_shop_id
    group by medicine.id
  ),
  alerts as (
    select
      medicine_id,
      name,
      strength,
      generic_name,
      stock,
      min_stock_alert,
      case when stock = 0 then 'out' else 'low' end as kind
    from medicine_stock
    where min_stock_alert > 0
      and (
        stock = 0
        or (stock > 0 and stock <= min_stock_alert)
      )
  ),
  limited_alerts as (
    select *
    from alerts
    order by
      case when kind = 'out' then 0 else 1 end,
      min_stock_alert - stock desc,
      name
    limit v_limit
  ),
  alert_summary as (
    select
      count(*) filter (where kind = 'low') as low_count,
      count(*) filter (where kind = 'out') as out_count
    from alerts
  ),
  alert_items as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'medicine_id', medicine_id,
        'name', name,
        'strength', strength,
        'generic_name', generic_name,
        'stock', stock,
        'min_stock_alert', min_stock_alert,
        'kind', kind
      )
      order by
        case when kind = 'out' then 0 else 1 end,
        min_stock_alert - stock desc,
        name
    ), '[]'::jsonb) as items
    from limited_alerts
  )
  select alert_summary.low_count, alert_summary.out_count, alert_items.items
  into v_low_count, v_out_count, v_items
  from alert_summary cross join alert_items;

  return jsonb_build_object(
    'low_count', coalesce(v_low_count, 0),
    'out_count', coalesce(v_out_count, 0),
    'generated_at', now(),
    'items', v_items
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.stock_alerts_summary(integer) FROM PUBLIC,anon;
