begin;

create or replace function public.stock_overview_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_can_view_cost boolean;
  v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['stock_inventory']::text[]) then
    raise exception 'An active user with stock inventory permission is required';
  end if;

  v_can_view_cost := public.can_view_cost();

  select jsonb_build_object(
    'stock_value_cost_paisa', case when v_can_view_cost then coalesce((
      select sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
      from public.stock_batches batch
      join public.medicines medicine on medicine.id = batch.medicine_id
      where medicine.is_active
        and batch.quantity_remaining > 0
        and batch.expiry_date >= current_date
        and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
    ), 0) else null end,
    'stock_value_mrp_paisa', coalesce((
      select sum(batch.quantity_remaining::numeric * batch.mrp_paisa_per_base_unit)
      from public.stock_batches batch
      join public.medicines medicine on medicine.id = batch.medicine_id
      where medicine.is_active
        and batch.quantity_remaining > 0
        and batch.expiry_date >= current_date
        and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
    ), 0),
    'expiring_30', (
      select count(*)
      from public.stock_batches batch
      join public.medicines medicine on medicine.id = batch.medicine_id
      where medicine.is_active
        and batch.quantity_remaining > 0
        and batch.expiry_date between current_date and current_date + 30
        and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
    ),
    'expired_batches', (
      select count(*)
      from public.stock_batches batch
      where batch.quantity_remaining > 0
        and batch.expiry_date < current_date
    ),
    'expired_value_at_risk_paisa', case when v_can_view_cost then coalesce((
      select sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
      from public.stock_batches batch
      where batch.quantity_remaining > 0
        and batch.expiry_date < current_date
    ), 0) else null end
  )
  into v_result;

  return v_result;
end;
$function$;

create or replace function public.stock_batches_list(
  p_tab text default 'all',
  p_search text default null,
  p_sort text default 'expiry_asc',
  p_page integer default 1,
  p_page_size integer default 25,
  p_medicine_id uuid default null,
  p_expiry_bucket text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 500);
  v_search text := nullif(btrim(p_search), '');
  v_sort text := lower(coalesce(p_sort, 'expiry_asc'));
  v_can_view_cost boolean;
  v_total bigint;
  v_rows jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['stock_inventory']::text[]) then
    raise exception 'An active user with stock inventory permission is required';
  end if;
  if p_tab is null or p_tab not in ('all', 'near-expiry', 'expired', 'low-stock') then
    raise exception 'Stock tab must be all, near-expiry, expired, or low-stock';
  end if;
  if p_expiry_bucket is not null
     and p_expiry_bucket not in ('expired', '0-30', '31-60', '61-90', '90+') then
    raise exception 'Expiry bucket is invalid';
  end if;
  if v_sort not in (
    'medicine_asc', 'medicine_desc', 'batch_asc', 'batch_desc',
    'expiry_asc', 'expiry_desc', 'quantity_asc', 'quantity_desc',
    'cost_asc', 'cost_desc', 'value_asc', 'value_desc'
  ) then
    raise exception 'Stock sort option is invalid';
  end if;

  v_can_view_cost := public.can_view_cost();
  if not v_can_view_cost and v_sort in ('cost_asc', 'cost_desc', 'value_asc', 'value_desc') then
    raise exception 'Cost sort options require cost visibility';
  end if;

  with batch_rows as (
    select
      batch.id,
      batch.medicine_id,
      medicine.brand_name as medicine_name,
      medicine.generic_name,
      medicine.code,
      medicine.barcode,
      medicine.is_active as medicine_is_active,
      medicine.min_stock_alert,
      batch.batch_number,
      batch.expiry_date,
      batch.received_date,
      batch.quantity_remaining,
      batch.status,
      batch.supplier_id,
      supplier.name as supplier_name,
      batch.mrp_paisa_per_base_unit,
      case when v_can_view_cost then batch.cost_paisa_per_base_unit else null end as cost_paisa_per_base_unit,
      case when v_can_view_cost
        then batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit
        else null
      end as stock_value_cost_paisa,
      batch.quantity_remaining > 0
        and batch.expiry_date >= current_date
        and batch.status in ('ACTIVE', 'NEAR_EXPIRY') as is_sellable,
      coalesce((
        select sum(sellable_batch.quantity_remaining)::bigint
        from public.stock_batches sellable_batch
        where sellable_batch.medicine_id = medicine.id
          and sellable_batch.quantity_remaining > 0
          and sellable_batch.expiry_date >= current_date
          and sellable_batch.status in ('ACTIVE', 'NEAR_EXPIRY')
      ), 0) as sellable_stock
    from public.stock_batches batch
    join public.medicines medicine on medicine.id = batch.medicine_id
    left join public.suppliers supplier on supplier.id = batch.supplier_id
    where (p_medicine_id is null or batch.medicine_id = p_medicine_id)
      and (
        v_search is null
        or batch.batch_number ilike '%' || v_search || '%'
        or medicine.brand_name ilike '%' || v_search || '%'
        or medicine.generic_name ilike '%' || v_search || '%'
        or medicine.code ilike '%' || v_search || '%'
        or coalesce(medicine.barcode, '') ilike '%' || v_search || '%'
      )
  ),
  filtered as (
    select *
    from batch_rows
    where
      (
        p_tab = 'all'
        or (p_tab = 'near-expiry'
          and medicine_is_active
          and is_sellable
          and expiry_date between current_date and current_date + 90)
        or (p_tab = 'expired'
          and quantity_remaining > 0
          and expiry_date < current_date)
        or (p_tab = 'low-stock'
          and medicine_is_active
          and is_sellable
          and min_stock_alert > 0
          and sellable_stock > 0
          and sellable_stock <= min_stock_alert)
      )
      and (
        p_tab <> 'all'
        or quantity_remaining > 0
        or v_search is not null
        or p_medicine_id is not null
      )
      and (
        p_expiry_bucket is null
        or (p_expiry_bucket = 'expired'
          and quantity_remaining > 0
          and expiry_date < current_date)
        or (p_expiry_bucket = '0-30'
          and medicine_is_active
          and is_sellable
          and expiry_date between current_date and current_date + 30)
        or (p_expiry_bucket = '31-60'
          and medicine_is_active
          and is_sellable
          and expiry_date between current_date + 31 and current_date + 60)
        or (p_expiry_bucket = '61-90'
          and medicine_is_active
          and is_sellable
          and expiry_date between current_date + 61 and current_date + 90)
        or (p_expiry_bucket = '90+'
          and medicine_is_active
          and is_sellable
          and expiry_date > current_date + 90)
      )
  ),
  counted as (
    select count(*)::bigint as total_count from filtered
  ),
  page_rows as (
    select *
    from filtered
    order by
      case when v_sort = 'medicine_asc' then lower(medicine_name) end asc,
      case when v_sort = 'medicine_desc' then lower(medicine_name) end desc,
      case when v_sort = 'batch_asc' then lower(batch_number) end asc,
      case when v_sort = 'batch_desc' then lower(batch_number) end desc,
      case when v_sort = 'expiry_asc' then expiry_date end asc,
      case when v_sort = 'expiry_desc' then expiry_date end desc,
      case when v_sort = 'quantity_asc' then quantity_remaining end asc,
      case when v_sort = 'quantity_desc' then quantity_remaining end desc,
      case when v_sort = 'cost_asc' then cost_paisa_per_base_unit end asc nulls last,
      case when v_sort = 'cost_desc' then cost_paisa_per_base_unit end desc nulls last,
      case when v_sort = 'value_asc' then stock_value_cost_paisa end asc nulls last,
      case when v_sort = 'value_desc' then stock_value_cost_paisa end desc nulls last,
      expiry_date asc,
      batch_number asc,
      id
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select counted.total_count,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page_rows.id,
        'medicine_id', page_rows.medicine_id,
        'medicine_name', page_rows.medicine_name,
        'generic_name', page_rows.generic_name,
        'code', page_rows.code,
        'barcode', page_rows.barcode,
        'batch_number', page_rows.batch_number,
        'expiry_date', page_rows.expiry_date,
        'received_date', page_rows.received_date,
        'quantity_remaining', page_rows.quantity_remaining,
        'status', page_rows.status,
        'supplier_id', page_rows.supplier_id,
        'supplier_name', page_rows.supplier_name,
        'min_stock_alert', page_rows.min_stock_alert,
        'cost_paisa_per_base_unit', page_rows.cost_paisa_per_base_unit,
        'mrp_paisa_per_base_unit', page_rows.mrp_paisa_per_base_unit,
        'stock_value_cost_paisa', page_rows.stock_value_cost_paisa,
        'is_sellable', page_rows.is_sellable
      ) order by page_rows.expiry_date, page_rows.batch_number, page_rows.id)
      from page_rows
    ), '[]'::jsonb)
  into v_total, v_rows
  from counted;

  return jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'can_view_cost', v_can_view_cost
  );
end;
$function$;

create or replace function public.stock_expiry_buckets()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['stock_inventory']::text[]) then
    raise exception 'An active user with stock inventory permission is required';
  end if;

  select jsonb_build_object(
    'buckets', jsonb_build_array(
      jsonb_build_object(
        'key', 'expired',
        'label', 'Expired',
        'count', count(*) filter (where batch.expiry_date < current_date),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) filter (where batch.expiry_date < current_date), 0)
      ),
      jsonb_build_object(
        'key', '0-30',
        'label', '0-30 days',
        'count', count(*) filter (where medicine.is_active and batch.status in ('ACTIVE', 'NEAR_EXPIRY') and batch.expiry_date between current_date and current_date + 30),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) filter (where medicine.is_active and batch.status in ('ACTIVE', 'NEAR_EXPIRY') and batch.expiry_date between current_date and current_date + 30), 0)
      ),
      jsonb_build_object(
        'key', '31-60',
        'label', '31-60 days',
        'count', count(*) filter (where medicine.is_active and batch.status in ('ACTIVE', 'NEAR_EXPIRY') and batch.expiry_date between current_date + 31 and current_date + 60),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) filter (where medicine.is_active and batch.status in ('ACTIVE', 'NEAR_EXPIRY') and batch.expiry_date between current_date + 31 and current_date + 60), 0)
      ),
      jsonb_build_object(
        'key', '61-90',
        'label', '61-90 days',
        'count', count(*) filter (where medicine.is_active and batch.status in ('ACTIVE', 'NEAR_EXPIRY') and batch.expiry_date between current_date + 61 and current_date + 90),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) filter (where medicine.is_active and batch.status in ('ACTIVE', 'NEAR_EXPIRY') and batch.expiry_date between current_date + 61 and current_date + 90), 0)
      ),
      jsonb_build_object(
        'key', '90+',
        'label', '90+ days',
        'count', count(*) filter (where medicine.is_active and batch.status in ('ACTIVE', 'NEAR_EXPIRY') and batch.expiry_date > current_date + 90),
        'quantity_remaining', coalesce(sum(batch.quantity_remaining) filter (where medicine.is_active and batch.status in ('ACTIVE', 'NEAR_EXPIRY') and batch.expiry_date > current_date + 90), 0)
      )
    )
  )
  into v_result
  from public.stock_batches batch
  join public.medicines medicine on medicine.id = batch.medicine_id
  where batch.quantity_remaining > 0
    and (
      batch.expiry_date < current_date
      or (medicine.is_active and batch.status in ('ACTIVE', 'NEAR_EXPIRY'))
    );

  return v_result;
end;
$function$;

create or replace function public.stock_adjustments_log(
  p_page integer default 1,
  p_page_size integer default 25,
  p_date_from date default null,
  p_date_to date default null,
  p_reason text default null,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 500);
  v_reason text := nullif(lower(btrim(p_reason)), '');
  v_total bigint;
  v_rows jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['stock_inventory']::text[]) then
    raise exception 'An active user with stock inventory permission is required';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'Start date must not be after end date';
  end if;

  with filtered as (
    select
      movement.id,
      movement.batch_id,
      movement.movement_type,
      movement.quantity_delta,
      movement.reason,
      movement.created_at,
      batch.batch_number,
      medicine.id as medicine_id,
      medicine.brand_name as medicine_name,
      medicine.generic_name,
      coalesce(profile.username, profile.full_name, 'Unknown') as actor_name
    from public.stock_movements movement
    join public.stock_batches batch on batch.id = movement.batch_id
    join public.medicines medicine on medicine.id = batch.medicine_id
    left join public.profiles profile on profile.id = movement.created_by
    where (
        (p_batch_id is null and movement.movement_type in ('ADJUSTMENT', 'WRITE_OFF'))
        or (
          p_batch_id is not null
          and movement.batch_id = p_batch_id
          and movement.movement_type in (
            'RECEIPT', 'SALE', 'SALE_RETURN', 'ADJUSTMENT', 'WRITE_OFF', 'PURCHASE_RETURN'
          )
        )
      )
      and (p_date_from is null or movement.created_at::date >= p_date_from)
      and (p_date_to is null or movement.created_at::date <= p_date_to)
      and (v_reason is null or lower(btrim(movement.reason)) = v_reason)
  ),
  counted as (
    select count(*)::bigint as total_count from filtered
  ),
  page_rows as (
    select *
    from filtered
    order by created_at desc, id desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select counted.total_count,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page_rows.id,
        'batch_id', page_rows.batch_id,
        'batch_number', page_rows.batch_number,
        'medicine_id', page_rows.medicine_id,
        'medicine_name', page_rows.medicine_name,
        'generic_name', page_rows.generic_name,
        'movement_type', page_rows.movement_type,
        'quantity_delta', page_rows.quantity_delta,
        'reason', page_rows.reason,
        'created_at', page_rows.created_at,
        'actor_name', page_rows.actor_name
      ) order by page_rows.created_at desc, page_rows.id desc)
      from page_rows
    ), '[]'::jsonb)
  into v_total, v_rows
  from counted;

  return jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'page', v_page,
    'page_size', v_page_size
  );
end;
$function$;

commit;
