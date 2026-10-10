begin;

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
          ),
          'stock_value_paisa', case when v_can_view_cost then coalesce((
            select sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
            from public.stock_batches batch
            join public.medicines medicine on medicine.id = batch.medicine_id
            where lower(btrim(medicine.category)) = lower(btrim(category.name))
              and medicine.is_active
              and batch.quantity_remaining > 0
              and batch.expiry_date >= current_date
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
          ),
          'stock_value_paisa', case when v_can_view_cost then coalesce((
            select sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
            from public.stock_batches batch
            join public.medicines medicine on medicine.id = batch.medicine_id
            where lower(btrim(medicine.company)) = lower(btrim(brand.name))
              and medicine.is_active
              and batch.quantity_remaining > 0
              and batch.expiry_date >= current_date
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

create or replace function public.merge_categories(
  p_source_category_id uuid,
  p_target_category_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_source_name text;
  v_target_name text;
  v_product_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['categories']::text[]) then
    raise exception 'An active user with categories permission is required';
  end if;
  if p_source_category_id is null or p_target_category_id is null
    or p_source_category_id = p_target_category_id then
    raise exception 'Select two different categories to merge';
  end if;

  perform 1
  from public.categories
  where id in (p_source_category_id, p_target_category_id)
  order by id
  for update;

  select name into v_source_name
  from public.categories where id = p_source_category_id;
  if not found then
    raise exception 'Source category not found';
  end if;
  select name into v_target_name
  from public.categories where id = p_target_category_id;
  if not found then
    raise exception 'Target category not found';
  end if;

  lock table public.medicines in share row exclusive mode;
  select count(*) into v_product_count
  from public.medicines
  where lower(btrim(category)) = lower(btrim(v_source_name));
  if v_product_count > 0
    and not public.has_any_permission(array['products']::text[]) then
    raise exception 'Merging a category used by products also requires products permission';
  end if;

  update public.medicines
  set category = v_target_name
  where lower(btrim(category)) = lower(btrim(v_source_name));
  delete from public.categories where id = p_source_category_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(),
    'categories_merge',
    'categories',
    p_source_category_id,
    jsonb_build_object(
      'source_name', v_source_name,
      'target_id', p_target_category_id,
      'target_name', v_target_name,
      'updated_products', v_product_count
    )
  );
  return v_product_count;
end;
$function$;

create or replace function public.merge_brands(
  p_source_brand_id uuid,
  p_target_brand_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_source_name text;
  v_target_name text;
  v_product_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['categories']::text[]) then
    raise exception 'An active user with categories permission is required';
  end if;
  if p_source_brand_id is null or p_target_brand_id is null
    or p_source_brand_id = p_target_brand_id then
    raise exception 'Select two different manufacturers to merge';
  end if;

  perform 1
  from public.brands
  where id in (p_source_brand_id, p_target_brand_id)
  order by id
  for update;

  select name into v_source_name
  from public.brands where id = p_source_brand_id;
  if not found then
    raise exception 'Source manufacturer not found';
  end if;
  select name into v_target_name
  from public.brands where id = p_target_brand_id;
  if not found then
    raise exception 'Target manufacturer not found';
  end if;

  lock table public.medicines in share row exclusive mode;
  select count(*) into v_product_count
  from public.medicines
  where lower(btrim(company)) = lower(btrim(v_source_name));
  if v_product_count > 0
    and not public.has_any_permission(array['products']::text[]) then
    raise exception 'Merging a manufacturer used by products also requires products permission';
  end if;

  update public.medicines
  set company = v_target_name
  where lower(btrim(company)) = lower(btrim(v_source_name));
  delete from public.brands where id = p_source_brand_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(),
    'brands_merge',
    'brands',
    p_source_brand_id,
    jsonb_build_object(
      'source_name', v_source_name,
      'target_id', p_target_brand_id,
      'target_name', v_target_name,
      'updated_products', v_product_count
    )
  );
  return v_product_count;
end;
$function$;

revoke all on function public.master_data_overview() from public, anon;
revoke all on function public.merge_categories(uuid, uuid) from public, anon;
revoke all on function public.merge_brands(uuid, uuid) from public, anon;
grant execute on function public.master_data_overview() to authenticated;
grant execute on function public.merge_categories(uuid, uuid) to authenticated;
grant execute on function public.merge_brands(uuid, uuid) to authenticated;

commit;
