begin;

create or replace function public.products_overview_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_stats jsonb;
  v_can_view_cost boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['products']::text[]) then
    raise exception 'An active user with products permission is required';
  end if;

  v_can_view_cost := public.can_view_cost();
  select jsonb_build_object(
    'total_active', count(*) filter (where medicine.is_active),
    'low_stock', count(*) filter (
      where medicine.is_active
        and medicine.min_stock_alert > 0
        and coalesce(stock.quantity, 0) > 0
        and stock.quantity <= medicine.min_stock_alert
    ),
    'out_of_stock', count(*) filter (
      where medicine.is_active and coalesce(stock.quantity, 0) = 0
    ),
    'expiring_90', (
      select count(*)
      from public.stock_batches batch
      join public.medicines active_medicine on active_medicine.id = batch.medicine_id
      where active_medicine.is_active
        and batch.quantity_remaining > 0
        and batch.expiry_date between current_date and current_date + 90
        and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
    ),
    'stock_value_cost_paisa', case when v_can_view_cost then coalesce((
      select sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
      from public.stock_batches batch
      join public.medicines active_medicine on active_medicine.id = batch.medicine_id
      where active_medicine.is_active
        and batch.quantity_remaining > 0
        and batch.expiry_date >= current_date
        and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
    ), 0) else null end
  )
  into v_stats
  from public.medicines medicine
  left join lateral (
    select sum(batch.quantity_remaining)::bigint as quantity
    from public.stock_batches batch
    where batch.medicine_id = medicine.id
      and batch.quantity_remaining > 0
      and batch.expiry_date >= current_date
      and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
  ) stock on true;

  return v_stats;
end;
$function$;

create or replace function public.products_list(
  p_search text default null,
  p_category text default null,
  p_manufacturer text default null,
  p_class text default null,
  p_status text default 'active',
  p_low_only boolean default false,
  p_sort_col text default 'name',
  p_sort_dir text default 'asc',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 200);
  v_sort_col text := coalesce(p_sort_col, 'name');
  v_sort_dir text := lower(coalesce(p_sort_dir, 'asc'));
  v_can_view_cost boolean;
  v_total bigint;
  v_rows jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['products']::text[]) then
    raise exception 'An active user with products permission is required';
  end if;
  if p_status is null or p_status not in ('active', 'inactive', 'all') then
    raise exception 'Status must be active, inactive, or all';
  end if;
  if p_class is not null and p_class not in ('OTC', 'RX', 'CONTROLLED', 'NARCOTIC') then
    raise exception 'Medicine class is invalid';
  end if;
  if v_sort_col not in ('name', 'stock', 'expiry', 'mrp') or v_sort_dir not in ('asc', 'desc') then
    raise exception 'Product sort option is invalid';
  end if;

  v_can_view_cost := public.can_view_cost();
  with product_rows as (
    select
      medicine.id,
      medicine.code,
      medicine.barcode,
      medicine.brand_name,
      medicine.generic_name,
      medicine.strength,
      medicine.category,
      medicine.company,
      medicine.drug_class,
      medicine.storage_condition,
      medicine.rack_location,
      medicine.min_stock_alert,
      medicine.requires_prescription,
      medicine.is_active,
      coalesce(stock.quantity, 0)::bigint as stock,
      stock.nearest_expiry,
      coalesce(unit.price_paisa, 0)::bigint as mrp_paisa,
      coalesce(unit.conversion_factor, 1)::bigint as default_unit_conversion,
      case when v_can_view_cost then stock.latest_cost_paisa else null end as latest_cost_paisa,
      case
        when not v_can_view_cost
          or stock.latest_cost_paisa is null
          or coalesce(unit.price_paisa, 0) = 0 then null
        else round(
          ((coalesce(unit.price_paisa, 0)::numeric
            - stock.latest_cost_paisa::numeric * coalesce(unit.conversion_factor, 1))
            * 100)
          / unit.price_paisa::numeric,
          2
        )
      end as margin_percent
    from public.medicines medicine
    left join lateral (
      select
        sum(batch.quantity_remaining)::bigint as quantity,
        min(batch.expiry_date) as nearest_expiry,
        (array_agg(batch.cost_paisa_per_base_unit order by batch.received_date desc, batch.id desc))[1] as latest_cost_paisa
      from public.stock_batches batch
      where batch.medicine_id = medicine.id
        and batch.quantity_remaining > 0
        and batch.expiry_date >= current_date
        and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
    ) stock on true
    left join lateral (
      select medicine_unit.price_paisa, medicine_unit.conversion_factor
      from public.medicine_units medicine_unit
      where medicine_unit.medicine_id = medicine.id
      order by medicine_unit.is_default_sale_unit desc, medicine_unit.id
      limit 1
    ) unit on true
    where (p_status = 'all' or medicine.is_active = (p_status = 'active'))
      and (p_category is null or p_category = '' or medicine.category = p_category)
      and (p_manufacturer is null or p_manufacturer = '' or medicine.company = p_manufacturer)
      and (
        p_class is null
        or (p_class = 'CONTROLLED' and medicine.drug_class in ('CONTROLLED', 'NARCOTIC'))
        or (p_class <> 'CONTROLLED' and medicine.drug_class = p_class)
      )
      and (
        p_search is null or btrim(p_search) = ''
        or medicine.brand_name ilike '%' || btrim(p_search) || '%'
        or medicine.generic_name ilike '%' || btrim(p_search) || '%'
        or coalesce(medicine.strength, '') ilike '%' || btrim(p_search) || '%'
        or medicine.code ilike '%' || btrim(p_search) || '%'
        or medicine.category ilike '%' || btrim(p_search) || '%'
        or coalesce(medicine.barcode, '') ilike '%' || btrim(p_search) || '%'
        or medicine.company ilike '%' || btrim(p_search) || '%'
      )
  ),
  filtered as (
    select * from product_rows
    where not coalesce(p_low_only, false)
      or (min_stock_alert > 0 and stock > 0 and stock <= min_stock_alert)
  ),
  counted as (
    select count(*)::bigint as total_count from filtered
  ),
  ordered as (
    select *
    from filtered
    order by
      case when v_sort_col = 'name' and v_sort_dir = 'asc' then brand_name end asc,
      case when v_sort_col = 'name' and v_sort_dir = 'desc' then brand_name end desc,
      case when v_sort_col = 'stock' and v_sort_dir = 'asc' then stock end asc,
      case when v_sort_col = 'stock' and v_sort_dir = 'desc' then stock end desc,
      case when v_sort_col = 'expiry' and v_sort_dir = 'asc' then nearest_expiry end asc nulls last,
      case when v_sort_col = 'expiry' and v_sort_dir = 'desc' then nearest_expiry end desc nulls last,
      case when v_sort_col = 'mrp' and v_sort_dir = 'asc' then mrp_paisa end asc,
      case when v_sort_col = 'mrp' and v_sort_dir = 'desc' then mrp_paisa end desc,
      id
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select counted.total_count,
    coalesce((
      select jsonb_agg(to_jsonb(ordered)) from ordered
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

create or replace function public.master_data_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_can_view_cost boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['categories']::text[]) then
    raise exception 'An active user with categories permission is required';
  end if;

  v_can_view_cost := public.can_view_cost();

  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', category.id,
          'name', category.name,
          'is_active', category.is_active,
          'product_count', (
            select count(*) from public.medicines medicine
            where lower(btrim(medicine.category)) = lower(btrim(category.name))
          ),
          'low_count', (
            select count(*)
            from public.medicines medicine
            left join lateral (
              select sum(batch.quantity_remaining)::bigint as quantity
              from public.stock_batches batch
              where batch.medicine_id = medicine.id
                and batch.quantity_remaining > 0
                and batch.expiry_date >= current_date
                and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
            ) stock on true
            where lower(btrim(medicine.category)) = lower(btrim(category.name))
              and medicine.is_active
              and medicine.min_stock_alert > 0
              and coalesce(stock.quantity, 0) > 0
              and stock.quantity <= medicine.min_stock_alert
          ),
          'out_count', (
            select count(*)
            from public.medicines medicine
            left join lateral (
              select sum(batch.quantity_remaining)::bigint as quantity
              from public.stock_batches batch
              where batch.medicine_id = medicine.id
                and batch.quantity_remaining > 0
                and batch.expiry_date >= current_date
                and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
            ) stock on true
            where lower(btrim(medicine.category)) = lower(btrim(category.name))
              and medicine.is_active
              and coalesce(stock.quantity, 0) = 0
          ),
          'expiring_count', (
            select count(*)
            from public.stock_batches batch
            join public.medicines medicine on medicine.id = batch.medicine_id
            where lower(btrim(medicine.category)) = lower(btrim(category.name))
              and medicine.is_active
              and batch.quantity_remaining > 0
              and batch.expiry_date between current_date and current_date + 90
              and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
          ),
          'stock_value_paisa', case when v_can_view_cost then coalesce((
            select sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
            from public.stock_batches batch
            join public.medicines medicine on medicine.id = batch.medicine_id
            where lower(btrim(medicine.category)) = lower(btrim(category.name))
              and medicine.is_active
              and batch.quantity_remaining > 0
              and batch.expiry_date >= current_date
              and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
          ), 0) else null end
        ) order by lower(category.name), category.id
      )
      from public.categories category
    ), '[]'::jsonb),
    'manufacturers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', brand.id,
          'name', brand.name,
          'is_active', brand.is_active,
          'product_count', (
            select count(*) from public.medicines medicine
            where lower(btrim(medicine.company)) = lower(btrim(brand.name))
          ),
          'low_count', (
            select count(*)
            from public.medicines medicine
            left join lateral (
              select sum(batch.quantity_remaining)::bigint as quantity
              from public.stock_batches batch
              where batch.medicine_id = medicine.id
                and batch.quantity_remaining > 0
                and batch.expiry_date >= current_date
                and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
            ) stock on true
            where lower(btrim(medicine.company)) = lower(btrim(brand.name))
              and medicine.is_active
              and medicine.min_stock_alert > 0
              and coalesce(stock.quantity, 0) > 0
              and stock.quantity <= medicine.min_stock_alert
          ),
          'out_count', (
            select count(*)
            from public.medicines medicine
            left join lateral (
              select sum(batch.quantity_remaining)::bigint as quantity
              from public.stock_batches batch
              where batch.medicine_id = medicine.id
                and batch.quantity_remaining > 0
                and batch.expiry_date >= current_date
                and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
            ) stock on true
            where lower(btrim(medicine.company)) = lower(btrim(brand.name))
              and medicine.is_active
              and coalesce(stock.quantity, 0) = 0
          ),
          'expiring_count', (
            select count(*)
            from public.stock_batches batch
            join public.medicines medicine on medicine.id = batch.medicine_id
            where lower(btrim(medicine.company)) = lower(btrim(brand.name))
              and medicine.is_active
              and batch.quantity_remaining > 0
              and batch.expiry_date between current_date and current_date + 90
              and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
          ),
          'stock_value_paisa', case when v_can_view_cost then coalesce((
            select sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
            from public.stock_batches batch
            join public.medicines medicine on medicine.id = batch.medicine_id
            where lower(btrim(medicine.company)) = lower(btrim(brand.name))
              and medicine.is_active
              and batch.quantity_remaining > 0
              and batch.expiry_date >= current_date
              and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
          ), 0) else null end
        ) order by lower(brand.name), brand.id
      )
      from public.brands brand
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'category_count', (select count(*) from public.categories),
      'active_category_count', (select count(*) from public.categories where is_active),
      'manufacturer_count', (select count(*) from public.brands),
      'active_manufacturer_count', (select count(*) from public.brands where is_active),
      'product_count', (select count(*) from public.medicines),
      'unit_count', (select count(*) from public.medicine_units)
    )
  );
end;
$function$;

commit;
