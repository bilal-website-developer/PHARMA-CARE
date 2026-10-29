-- DRAFT ONLY: Part B pack-size pricing schema foundation.
-- Do not apply until the live-schema assumptions and the coordinated client/RPC
-- changes have been reviewed and approved.
-- For the first dry run, wrap this entire file in BEGIN; ... ROLLBACK; in the
-- Supabase SQL Editor. This file intentionally has no transaction boundary.

do $preflight$
begin
  if to_regclass('public.medicines') is null
     or to_regclass('public.medicine_units') is null
     or to_regclass('public.stock_batches') is null
     or to_regclass('public.sales') is null
     or to_regclass('public.sale_items') is null
     or to_regclass('public.purchase_items') is null
     or to_regclass('public.stock_movements') is null then
    raise exception 'Pack pricing preflight failed: expected current pharmacy tables are missing';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.medicine_units'::regclass
      and attname = 'price_paisa' and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.medicine_units'::regclass
      and attname = 'conversion_factor' and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.medicine_units'::regclass
      and attname = 'is_default_sale_unit' and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.medicine_units'::regclass
      and attname = 'barcode' and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.sale_items'::regclass
      and attname = 'unit_id' and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.purchase_items'::regclass
      and attname = 'unit_id' and not attisdropped
  ) then
    raise exception 'Pack pricing preflight failed: legacy medicine_units columns differ from the checked-in schema';
  end if;

  if exists (
    select 1
    from (values
      ('public.medicines'::regclass, 'dosage_form'),
      ('public.medicines'::regclass, 'base_unit_label'),
      ('public.medicine_units'::regclass, 'sale_price_paisa'),
      ('public.medicine_units'::regclass, 'cost_price_paisa'),
      ('public.medicine_units'::regclass, 'is_active'),
      ('public.medicine_units'::regclass, 'sort_order'),
      ('public.medicine_units'::regclass, 'pack_pricing_backfilled')
    ) expected(relid, attname)
    join pg_attribute existing
      on existing.attrelid = expected.relid
     and existing.attname = expected.attname
     and not existing.attisdropped
  ) then
    raise exception 'Pack pricing preflight failed: one or more draft columns already exist; inspect before proceeding';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.medicine_units'::regclass
      and conname in (
        'medicine_units_sale_price_paisa_check',
        'medicine_units_cost_price_paisa_check',
        'medicine_units_sort_order_check',
        'medicine_units_default_must_be_active_check'
      )
  ) or exists (
    select 1
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'medicine_units_sync_sale_price',
        'sale_items_validate_pack_unit',
        'purchase_items_update_last_pack_cost',
        'medicine_units_exactly_one_active_default',
        'medicines_require_default_unit'
      )
  ) or to_regprocedure('public.sync_medicine_unit_sale_price()') is not null
    or to_regprocedure('public.validate_sale_item_pack_unit()') is not null
    or to_regprocedure('public.update_medicine_unit_last_pack_cost()') is not null
    or to_regprocedure('public.assert_medicine_has_one_active_default_unit()') is not null
  then
    raise exception 'Pack pricing preflight failed: one or more draft constraints, functions, or triggers already exist';
  end if;

  if exists (
    select medicine_id
    from public.medicine_units
    group by medicine_id
    having count(*) > 1
       and count(*) filter (where is_default_sale_unit) <> 1
  ) then
    raise exception 'Pack pricing preflight failed: products with multiple units must have exactly one default unit';
  end if;
end;
$preflight$;

create temporary table pack_pricing_totals_before on commit drop as
select
  (select count(*)::bigint from public.sales) as sales_count,
  (select coalesce(sum(total_paisa), 0)::numeric from public.sales) as sales_total_paisa,
  (select count(*)::bigint from public.sale_items) as sale_items_count,
  (select coalesce(sum(line_total_paisa), 0)::numeric from public.sale_items) as sale_items_total_paisa,
  (select coalesce(sum(quantity_base_units), 0)::numeric from public.sale_items) as sold_base_units,
  (select count(*)::bigint from public.stock_batches) as batches_count,
  (select coalesce(sum(quantity_received), 0)::numeric from public.stock_batches) as received_base_units,
  (select coalesce(sum(quantity_remaining), 0)::numeric from public.stock_batches) as remaining_base_units,
  (select count(*)::bigint from public.stock_movements) as movements_count,
  (select coalesce(sum(quantity_delta), 0)::numeric from public.stock_movements) as movement_base_units;

alter table public.medicines
  add column dosage_form text,
  add column base_unit_label text;

alter table public.medicine_units
  add column sale_price_paisa integer,
  add column cost_price_paisa integer,
  add column is_active boolean not null default true,
  add column sort_order integer not null default 0,
  add column pack_pricing_backfilled boolean not null default false;

-- Preserve every configured legacy price, including zero, so existing single-unit
-- products retain their current price behavior. New empty prices remain NULL.
update public.medicine_units
set sale_price_paisa = price_paisa
where sale_price_paisa is null;

with unit_order as (
  select id,
         row_number() over (
           partition by medicine_id
           order by is_default_sale_unit desc, conversion_factor, name, id
         ) - 1 as next_sort_order
  from public.medicine_units
)
update public.medicine_units unit
set sort_order = unit_order.next_sort_order::integer
from unit_order
where unit.id = unit_order.id;

-- A single existing unit is unambiguous and remains the sale default. Products
-- with no units get a neutral one-base-unit fallback, never an inferred label.
update public.medicine_units unit
set is_default_sale_unit = true
where (
  select count(*)
  from public.medicine_units sibling
  where sibling.medicine_id = unit.medicine_id
) = 1
  and not unit.is_default_sale_unit;

insert into public.medicine_units (
  medicine_id,
  name,
  conversion_factor,
  is_default_sale_unit,
  price_paisa,
  barcode,
  sale_price_paisa,
  cost_price_paisa,
  is_active,
  sort_order,
  pack_pricing_backfilled
)
select
  medicine.id,
  'Base unit',
  1,
  true,
  coalesce(stock.mrp_paisa_per_base_unit, 0),
  null,
  stock.mrp_paisa_per_base_unit,
  null,
  true,
  0,
  true
from public.medicines medicine
left join lateral (
  select batch.mrp_paisa_per_base_unit
  from public.stock_batches batch
  where batch.medicine_id = medicine.id
    and batch.quantity_remaining > 0
    and batch.expiry_date >= current_date
    and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
  order by batch.expiry_date, batch.received_date, batch.id
  limit 1
) stock on true
where not exists (
  select 1
  from public.medicine_units unit
  where unit.medicine_id = medicine.id
);

do $constraints$
begin
  if exists (
    select 1
    from public.medicines medicine
    left join public.medicine_units unit on unit.medicine_id = medicine.id
    group by medicine.id
    having count(unit.id) = 0
       or count(*) filter (where unit.is_active and unit.is_default_sale_unit) <> 1
  ) then
    raise exception 'Pack pricing migration stopped: every medicine must have exactly one active default unit';
  end if;
end;
$constraints$;

do $add_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.medicine_units'::regclass
      and conname = 'medicine_units_sale_price_paisa_check'
  ) then
    alter table public.medicine_units
      add constraint medicine_units_sale_price_paisa_check
      check (sale_price_paisa is null or sale_price_paisa >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.medicine_units'::regclass
      and conname = 'medicine_units_cost_price_paisa_check'
  ) then
    alter table public.medicine_units
      add constraint medicine_units_cost_price_paisa_check
      check (cost_price_paisa is null or cost_price_paisa >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.medicine_units'::regclass
      and conname = 'medicine_units_sort_order_check'
  ) then
    alter table public.medicine_units
      add constraint medicine_units_sort_order_check
      check (sort_order >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.medicine_units'::regclass
      and conname = 'medicine_units_default_must_be_active_check'
  ) then
    alter table public.medicine_units
      add constraint medicine_units_default_must_be_active_check
      check (not is_default_sale_unit or is_active);
  end if;
end;
$add_constraints$;

create function public.sync_medicine_unit_sale_price()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.sale_price_paisa is not null then
      new.price_paisa := new.sale_price_paisa;
    elsif new.price_paisa > 0 then
      new.sale_price_paisa := new.price_paisa;
    end if;
  elsif new.sale_price_paisa is distinct from old.sale_price_paisa then
    new.price_paisa := coalesce(new.sale_price_paisa, 0);
  elsif new.price_paisa is distinct from old.price_paisa then
    new.sale_price_paisa := new.price_paisa;
  end if;
  return new;
end;
$function$;

create trigger medicine_units_sync_sale_price
before insert or update of price_paisa, sale_price_paisa
on public.medicine_units
for each row execute function public.sync_medicine_unit_sale_price();

revoke all on function public.sync_medicine_unit_sale_price() from public, anon, authenticated;

create function public.validate_sale_item_pack_unit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_unit public.medicine_units%rowtype;
begin
  select * into v_unit
  from public.medicine_units
  where id = new.unit_id and medicine_id = new.medicine_id
  for share;
  if not found or not v_unit.is_active then
    raise exception 'The selected sale unit is inactive or does not belong to this medicine';
  end if;
  if v_unit.sale_price_paisa is null then
    raise exception 'The selected sale unit has no configured sale price';
  end if;
  if new.conversion_factor is distinct from v_unit.conversion_factor
     or new.quantity_base_units is null
     or new.quantity_in_unit is null
     or new.quantity_base_units::bigint is distinct from
        new.quantity_in_unit::bigint * v_unit.conversion_factor
     or new.price_paisa_per_unit is distinct from v_unit.sale_price_paisa then
    raise exception 'Sale unit price or base-unit quantity does not match its configuration';
  end if;
  return new;
end;
$function$;

create trigger sale_items_validate_pack_unit
before insert on public.sale_items
for each row execute function public.validate_sale_item_pack_unit();

revoke all on function public.validate_sale_item_pack_unit() from public, anon, authenticated;

create function public.update_medicine_unit_last_pack_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_factor integer;
  v_active boolean;
begin
  perform 1
  from public.medicines
  where id = new.medicine_id
  for share;
  if not found then
    raise exception 'Purchase medicine does not exist';
  end if;

  select conversion_factor, is_active
  into v_factor, v_active
  from public.medicine_units
  where id = new.unit_id and medicine_id = new.medicine_id
  for update;
  if v_factor is null or not v_active then
    raise exception 'The selected purchase unit is inactive or does not belong to this medicine';
  end if;
  if new.conversion_factor is distinct from v_factor then
    raise exception 'Purchase conversion factor does not match its configured unit';
  end if;
  update public.medicine_units
  set cost_price_paisa = new.unit_cost_paisa
  where id = new.unit_id;
  return new;
end;
$function$;

create trigger purchase_items_update_last_pack_cost
before insert on public.purchase_items
for each row execute function public.update_medicine_unit_last_pack_cost();

revoke all on function public.update_medicine_unit_last_pack_cost() from public, anon, authenticated;

create function public.assert_medicine_has_one_active_default_unit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_medicine_ids uuid[];
  v_medicine_id uuid;
begin
  if tg_table_name = 'medicines' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    v_medicine_ids := array[new.id];
  elsif tg_op = 'INSERT' then
    v_medicine_ids := array[new.medicine_id];
  elsif tg_op = 'DELETE' then
    v_medicine_ids := array[old.medicine_id];
  elsif old.medicine_id is distinct from new.medicine_id then
    v_medicine_ids := array[old.medicine_id, new.medicine_id];
  else
    v_medicine_ids := array[new.medicine_id];
  end if;

  select array_agg(distinct affected.id order by affected.id)
  into v_medicine_ids
  from unnest(v_medicine_ids) affected(id);

  foreach v_medicine_id in array v_medicine_ids
  loop
    perform 1
    from public.medicines medicine
    where medicine.id = v_medicine_id
    for key share;
    if not found then
      continue;
    end if;

    if (
      select count(*)
      from public.medicine_units unit
      where unit.medicine_id = v_medicine_id
        and unit.is_active
        and unit.is_default_sale_unit
    ) <> 1 then
      raise exception 'Each medicine must have exactly one active default sale unit';
    end if;
  end loop;

  return null;
end;
$function$;

revoke all on function public.assert_medicine_has_one_active_default_unit() from public, anon, authenticated;

create constraint trigger medicine_units_exactly_one_active_default
after insert or update or delete on public.medicine_units
deferrable initially deferred
for each row execute function public.assert_medicine_has_one_active_default_unit();

create constraint trigger medicines_require_default_unit
after insert on public.medicines
deferrable initially deferred
for each row execute function public.assert_medicine_has_one_active_default_unit();

-- Cost is internal data. The current Products client reads these columns
-- explicitly; do not grant it SELECT on cost_price_paisa.
revoke select on table public.medicine_units from public, anon, authenticated;
grant select (
  id,
  medicine_id,
  name,
  conversion_factor,
  is_default_sale_unit,
  price_paisa,
  barcode,
  sale_price_paisa,
  is_active,
  sort_order
) on table public.medicine_units to authenticated;

do $verify_totals$
declare
  v_before record;
begin
  select * into v_before from pack_pricing_totals_before;
  if v_before.sales_count <> (select count(*) from public.sales)
     or v_before.sales_total_paisa <> (select coalesce(sum(total_paisa), 0)::numeric from public.sales)
     or v_before.sale_items_count <> (select count(*) from public.sale_items)
     or v_before.sale_items_total_paisa <> (select coalesce(sum(line_total_paisa), 0)::numeric from public.sale_items)
     or v_before.sold_base_units <> (select coalesce(sum(quantity_base_units), 0)::numeric from public.sale_items)
     or v_before.batches_count <> (select count(*) from public.stock_batches)
     or v_before.received_base_units <> (select coalesce(sum(quantity_received), 0)::numeric from public.stock_batches)
     or v_before.remaining_base_units <> (select coalesce(sum(quantity_remaining), 0)::numeric from public.stock_batches)
     or v_before.movements_count <> (select count(*) from public.stock_movements)
     or v_before.movement_base_units <> (select coalesce(sum(quantity_delta), 0)::numeric from public.stock_movements) then
    raise exception 'Pack pricing migration changed existing sales or stock totals';
  end if;
end;
$verify_totals$;
