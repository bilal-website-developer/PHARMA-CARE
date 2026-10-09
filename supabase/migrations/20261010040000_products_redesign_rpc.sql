begin;

create or replace function public.can_view_cost()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active = true
      and deleted_at is null
      and role in ('admin', 'super_admin', 'accountant')
  );
$function$;

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
    ),
    'stock_value_cost_paisa', case when v_can_view_cost then coalesce((
      select sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
      from public.stock_batches batch
      join public.medicines active_medicine on active_medicine.id = batch.medicine_id
      where active_medicine.is_active
        and batch.quantity_remaining > 0
        and batch.expiry_date >= current_date
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
      and (p_class is null or medicine.drug_class = p_class)
      and (
        p_search is null or btrim(p_search) = ''
        or medicine.brand_name ilike '%' || btrim(p_search) || '%'
        or medicine.generic_name ilike '%' || btrim(p_search) || '%'
        or medicine.code ilike '%' || btrim(p_search) || '%'
        or coalesce(medicine.barcode, '') ilike '%' || btrim(p_search) || '%'
        or medicine.company ilike '%' || btrim(p_search) || '%'
      )
  ),
  filtered as (
    select * from product_rows
    where not coalesce(p_low_only, false)
      or (min_stock_alert > 0 and stock > 0 and stock <= min_stock_alert)
  )
  select count(*) into v_total from filtered;

  with product_rows as (
    select
      medicine.id,
      medicine.code,
      medicine.barcode,
      medicine.brand_name,
      medicine.generic_name,
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
      and (p_class is null or medicine.drug_class = p_class)
      and (
        p_search is null or btrim(p_search) = ''
        or medicine.brand_name ilike '%' || btrim(p_search) || '%'
        or medicine.generic_name ilike '%' || btrim(p_search) || '%'
        or medicine.code ilike '%' || btrim(p_search) || '%'
        or coalesce(medicine.barcode, '') ilike '%' || btrim(p_search) || '%'
        or medicine.company ilike '%' || btrim(p_search) || '%'
      )
  ),
  filtered as (
    select * from product_rows
    where not coalesce(p_low_only, false)
      or (min_stock_alert > 0 and stock > 0 and stock <= min_stock_alert)
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
  select coalesce(jsonb_agg(to_jsonb(ordered)), '[]'::jsonb)
  into v_rows
  from ordered;

  return jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'can_view_cost', v_can_view_cost
  );
end;
$function$;

create or replace function public.products_import_preview(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row jsonb;
  v_results jsonb := '[]'::jsonb;
  v_line integer := 1;
  v_duplicate boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['products']::text[]) then
    raise exception 'An active user with products permission is required';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array'
    or jsonb_array_length(rows) < 1 or jsonb_array_length(rows) > 2000 then
    raise exception 'Preview must contain between 1 and 2000 product rows';
  end if;

  for v_row in select value from jsonb_array_elements(rows)
  loop
    v_line := coalesce(nullif(v_row->>'line', '')::integer, v_line);
    select exists (
      select 1 from public.medicines medicine
      where lower(btrim(medicine.code)) = lower(btrim(v_row->>'code'))
        or (nullif(btrim(v_row->>'barcode'), '') is not null
          and medicine.barcode = btrim(v_row->>'barcode'))
        or (
          nullif(btrim(v_row->>'barcode'), '') is null
          and lower(btrim(medicine.brand_name)) = lower(btrim(v_row->>'brand_name'))
          and lower(btrim(medicine.generic_name)) = lower(btrim(v_row->>'generic_name'))
          and lower(btrim(medicine.company)) = lower(btrim(v_row->>'company'))
        )
    ) into v_duplicate;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'line', v_line,
      'duplicate_in_database', v_duplicate
    ));
    v_line := v_line + 1;
  end loop;
  return v_results;
end;
$function$;

create or replace function public.products_bulk_update(
  ids uuid[],
  action text,
  value text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_updated integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['products']::text[]) then
    raise exception 'An active user with products permission is required';
  end if;
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 2000 then
    raise exception 'Select between 1 and 2000 products';
  end if;
  if exists (
    select 1 from unnest(ids) as selected(id)
    where selected.id is null
  ) then
    raise exception 'Product selection contains an invalid id';
  end if;
  if (select count(distinct selected.id) from unnest(ids) as selected(id)) <> cardinality(ids) then
    raise exception 'Product selection contains duplicate ids';
  end if;
  if exists (
    select 1 from unnest(ids) as selected(id)
    left join public.medicines medicine on medicine.id = selected.id
    where medicine.id is null
  ) then
    raise exception 'One or more selected products no longer exist';
  end if;

  if action = 'category' then
    if nullif(btrim(value), '') is null or not exists (
      select 1 from public.categories
      where is_active and lower(name) = lower(btrim(value))
    ) then
      raise exception 'Select an active category';
    end if;
    update public.medicines
    set category = (select name from public.categories where is_active and lower(name) = lower(btrim(value)) limit 1)
    where id = any(ids);
  elsif action = 'deactivate' then
    update public.medicines set is_active = false where id = any(ids);
  else
    raise exception 'Bulk action must be category or deactivate';
  end if;

  get diagnostics v_updated = row_count;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(),
    'products_bulk_' || action,
    'medicines',
    ids[1],
    jsonb_build_object('ids', to_jsonb(ids), 'value', value, 'updated_count', v_updated)
  );
  return v_updated;
end;
$function$;

create or replace function public.products_bulk_import(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row jsonb;
  v_id uuid;
  v_first_id uuid;
  v_imported integer := 0;
  v_category text;
  v_company text;
  v_values jsonb;
  v_units jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['products']::text[]) then
    raise exception 'An active user with products permission is required';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array'
    or jsonb_array_length(rows) < 1 or jsonb_array_length(rows) > 2000 then
    raise exception 'Import must contain between 1 and 2000 product rows';
  end if;

  for v_row in select value from jsonb_array_elements(rows)
  loop
    if jsonb_typeof(v_row) <> 'object'
      or nullif(btrim(v_row->>'code'), '') is null
      or nullif(btrim(v_row->>'brand_name'), '') is null
      or nullif(btrim(v_row->>'generic_name'), '') is null
      or nullif(btrim(v_row->>'category'), '') is null
      or nullif(btrim(v_row->>'company'), '') is null
      or nullif(btrim(v_row->>'unit_name'), '') is null then
      raise exception 'Every import row must include code, product name, generic name, category, manufacturer, and unit';
    end if;
    if exists (
      select 1 from public.medicines medicine
      where lower(btrim(medicine.code)) = lower(btrim(v_row->>'code'))
        or (nullif(btrim(v_row->>'barcode'), '') is not null
          and medicine.barcode = btrim(v_row->>'barcode'))
        or (
          nullif(btrim(v_row->>'barcode'), '') is null
          and lower(btrim(medicine.brand_name)) = lower(btrim(v_row->>'brand_name'))
          and lower(btrim(medicine.generic_name)) = lower(btrim(v_row->>'generic_name'))
          and lower(btrim(medicine.company)) = lower(btrim(v_row->>'company'))
        )
    ) then
      raise exception 'Import contains a duplicate product: %', btrim(v_row->>'brand_name');
    end if;
    if not exists (
      select 1 from public.categories
      where is_active and lower(name) = lower(btrim(v_row->>'category'))
    ) then
      perform public.save_category(null, btrim(v_row->>'category'), true);
    end if;
    if not exists (
      select 1 from public.brands
      where is_active and lower(name) = lower(btrim(v_row->>'company'))
    ) then
      perform public.save_brand(null, btrim(v_row->>'company'), true);
    end if;

    v_category := (select name from public.categories where is_active and lower(name) = lower(btrim(v_row->>'category')) limit 1);
    v_company := (select name from public.brands where is_active and lower(name) = lower(btrim(v_row->>'company')) limit 1);
    v_values := jsonb_build_object(
      'code', btrim(v_row->>'code'),
      'barcode', nullif(btrim(v_row->>'barcode'), ''),
      'brand_name', btrim(v_row->>'brand_name'),
      'generic_name', btrim(v_row->>'generic_name'),
      'category', v_category,
      'company', v_company,
      'drug_class', coalesce(nullif(v_row->>'drug_class', ''), 'OTC'),
      'storage_condition', coalesce(nullif(v_row->>'storage_condition', ''), 'ROOM_TEMPERATURE'),
      'rack_location', coalesce(v_row->>'rack_location', ''),
      'min_stock_alert', coalesce(nullif(v_row->>'min_stock_alert', '')::integer, 0),
      'requires_prescription', coalesce(nullif(v_row->>'requires_prescription', '')::boolean, false),
      'is_active', coalesce(nullif(v_row->>'is_active', '')::boolean, true)
    );
    v_units := jsonb_build_array(jsonb_build_object(
      'name', btrim(v_row->>'unit_name'),
      'conversion_factor', (v_row->>'conversion_factor')::integer,
      'is_default_sale_unit', true,
      'price_paisa', (v_row->>'price_paisa')::integer,
      'barcode', nullif(btrim(v_row->>'unit_barcode'), '')
    ));
    v_id := public.save_medicine(null, v_values, v_units);
    v_first_id := coalesce(v_first_id, v_id);
    v_imported := v_imported + 1;
  end loop;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(),
    'products_bulk_import',
    'medicines',
    v_first_id,
    jsonb_build_object('imported_count', v_imported)
  );
  return jsonb_build_object('imported_count', v_imported);
end;
$function$;

revoke all on function public.can_view_cost() from public, anon;
revoke all on function public.products_overview_stats() from public, anon;
revoke all on function public.products_list(text, text, text, text, text, boolean, text, text, integer, integer) from public, anon;
revoke all on function public.products_import_preview(jsonb) from public, anon;
revoke all on function public.products_bulk_update(uuid[], text, text) from public, anon;
revoke all on function public.products_bulk_import(jsonb) from public, anon;
grant execute on function public.can_view_cost() to authenticated;
grant execute on function public.products_overview_stats() to authenticated;
grant execute on function public.products_list(text, text, text, text, text, boolean, text, text, integer, integer) to authenticated;
grant execute on function public.products_import_preview(jsonb) to authenticated;
grant execute on function public.products_bulk_update(uuid[], text, text) to authenticated;
grant execute on function public.products_bulk_import(jsonb) to authenticated;

commit;
