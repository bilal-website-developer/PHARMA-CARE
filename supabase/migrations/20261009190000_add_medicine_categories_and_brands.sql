begin;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists categories_name_lower_key
  on public.categories (lower(name));
create unique index if not exists brands_name_lower_key
  on public.brands (lower(name));

insert into public.categories (name)
select min(btrim(m.category))
from public.medicines m
where btrim(m.category) <> ''
group by lower(btrim(m.category))
on conflict do nothing;

insert into public.brands (name)
select min(btrim(m.company))
from public.medicines m
where btrim(m.company) <> ''
group by lower(btrim(m.company))
on conflict do nothing;

update public.medicines m
set category = c.name
from public.categories c
where lower(btrim(m.category)) = lower(c.name)
  and m.category is distinct from c.name;

update public.medicines m
set company = b.name
from public.brands b
where lower(btrim(m.company)) = lower(b.name)
  and m.company is distinct from b.name;

alter table public.categories enable row level security;
alter table public.brands enable row level security;

drop policy if exists "categories read by active staff" on public.categories;
create policy "categories read by active staff"
  on public.categories for select to authenticated
  using (public.is_staff());
drop policy if exists "categories write by permission" on public.categories;
create policy "categories write by permission"
  on public.categories for all to authenticated
  using (public.has_any_permission(array['categories']::text[]))
  with check (public.has_any_permission(array['categories']::text[]));

drop policy if exists "brands read by active staff" on public.brands;
create policy "brands read by active staff"
  on public.brands for select to authenticated
  using (public.is_staff());
drop policy if exists "brands write by permission" on public.brands;
create policy "brands write by permission"
  on public.brands for all to authenticated
  using (public.has_any_permission(array['categories']::text[]))
  with check (public.has_any_permission(array['categories']::text[]));

revoke all on table public.categories, public.brands from anon, authenticated;
grant select on table public.categories, public.brands to authenticated;

create or replace function public.save_category(
  p_category_id uuid,
  p_name text,
  p_is_active boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text := nullif(btrim(p_name), '');
  v_old_name text;
  v_id uuid;
begin
  if auth.uid() is null
     or not public.has_any_permission(array['categories']::text[]) then
    raise exception 'You do not have permission to manage categories';
  end if;
  if v_name is null then
    raise exception 'Category name is required';
  end if;

  if p_category_id is null then
    insert into public.categories (name, is_active)
    values (v_name, coalesce(p_is_active, true))
    returning id into v_id;
    return v_id;
  end if;

  select name into v_old_name
  from public.categories
  where id = p_category_id
  for update;
  if not found then
    raise exception 'Category not found';
  end if;

  if v_old_name is distinct from v_name then
    lock table public.medicines in share row exclusive mode;
    if exists (
      select 1 from public.medicines
      where lower(btrim(category)) = lower(v_old_name)
    ) and not public.has_any_permission(array['products']::text[]) then
      raise exception 'Editing a category used by products also requires products permission';
    end if;
    update public.medicines
    set category = v_name
    where lower(btrim(category)) = lower(v_old_name);
  end if;

  update public.categories
  set name = v_name, is_active = coalesce(p_is_active, is_active)
  where id = p_category_id
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.delete_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text;
begin
  if auth.uid() is null
     or not public.has_any_permission(array['categories']::text[]) then
    raise exception 'You do not have permission to manage categories';
  end if;

  select name into v_name
  from public.categories
  where id = p_category_id
  for update;
  if not found then
    raise exception 'Category not found';
  end if;

  lock table public.medicines in share row exclusive mode;
  if exists (
    select 1 from public.medicines
    where lower(btrim(category)) = lower(v_name)
  ) then
    raise exception 'Category is in use by one or more medicines';
  end if;
  delete from public.categories where id = p_category_id;
end;
$function$;

create or replace function public.save_brand(
  p_brand_id uuid,
  p_name text,
  p_is_active boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text := nullif(btrim(p_name), '');
  v_old_name text;
  v_id uuid;
begin
  if auth.uid() is null
     or not public.has_any_permission(array['categories']::text[]) then
    raise exception 'You do not have permission to manage brands';
  end if;
  if v_name is null then
    raise exception 'Brand name is required';
  end if;

  if p_brand_id is null then
    insert into public.brands (name, is_active)
    values (v_name, coalesce(p_is_active, true))
    returning id into v_id;
    return v_id;
  end if;

  select name into v_old_name
  from public.brands
  where id = p_brand_id
  for update;
  if not found then
    raise exception 'Brand not found';
  end if;

  if v_old_name is distinct from v_name then
    lock table public.medicines in share row exclusive mode;
    if exists (
      select 1 from public.medicines
      where lower(btrim(company)) = lower(v_old_name)
    ) and not public.has_any_permission(array['products']::text[]) then
      raise exception 'Editing a brand used by products also requires products permission';
    end if;
    update public.medicines
    set company = v_name
    where lower(btrim(company)) = lower(v_old_name);
  end if;

  update public.brands
  set name = v_name, is_active = coalesce(p_is_active, is_active)
  where id = p_brand_id
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.delete_brand(p_brand_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text;
begin
  if auth.uid() is null
     or not public.has_any_permission(array['categories']::text[]) then
    raise exception 'You do not have permission to manage brands';
  end if;

  select name into v_name
  from public.brands
  where id = p_brand_id
  for update;
  if not found then
    raise exception 'Brand not found';
  end if;

  lock table public.medicines in share row exclusive mode;
  if exists (
    select 1 from public.medicines
    where lower(btrim(company)) = lower(v_name)
  ) then
    raise exception 'Brand is in use by one or more medicines';
  end if;
  delete from public.brands where id = p_brand_id;
end;
$function$;

revoke all on function public.save_category(uuid, text, boolean) from public, anon;
revoke all on function public.delete_category(uuid) from public, anon;
revoke all on function public.save_brand(uuid, text, boolean) from public, anon;
revoke all on function public.delete_brand(uuid) from public, anon;
grant execute on function public.save_category(uuid, text, boolean) to authenticated;
grant execute on function public.delete_category(uuid) to authenticated;
grant execute on function public.save_brand(uuid, text, boolean) to authenticated;
grant execute on function public.delete_brand(uuid) to authenticated;

commit;