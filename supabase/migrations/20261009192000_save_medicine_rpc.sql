begin;

create or replace function public.save_medicine(
  p_medicine_id uuid,
  p_values jsonb,
  p_units jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
  v_unit jsonb;
  v_unit_id uuid;
  v_unit_name text;
  v_unit_factor integer;
  v_unit_price integer;
  v_is_default boolean;
  v_default_count integer := 0;
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.profiles
       where id = auth.uid() and is_active and deleted_at is null
     )
     or not public.has_any_permission(array['products']::text[]) then
    raise exception 'An active user with products permission is required';
  end if;

  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Medicine details are required';
  end if;
  if nullif(btrim(p_values->>'code'), '') is null
     or nullif(btrim(p_values->>'brand_name'), '') is null
     or nullif(btrim(p_values->>'generic_name'), '') is null
     or nullif(btrim(p_values->>'category'), '') is null
     or nullif(btrim(p_values->>'company'), '') is null
     or nullif(btrim(p_values->>'drug_class'), '') is null then
    raise exception 'Code, brand, generic, category, and manufacturer are required';
  end if;
  if p_values->>'drug_class' not in ('OTC', 'RX', 'CONTROLLED', 'NARCOTIC') then
    raise exception 'Invalid medicine classification';
  end if;
  if coalesce(nullif(p_values->>'storage_condition', ''), 'ROOM_TEMPERATURE')
       not in ('ROOM_TEMPERATURE', 'COOL', 'COLD_REFRIGERATED') then
    raise exception 'Invalid storage condition';
  end if;
  if coalesce(nullif(p_values->>'min_stock_alert', '')::bigint, 0) < 0
     or coalesce(nullif(p_values->>'min_stock_alert', '')::bigint, 0) > 2147483647 then
    raise exception 'Minimum stock threshold is out of range';
  end if;
  if p_units is null
     or jsonb_typeof(p_units) <> 'array'
     or jsonb_array_length(p_units) = 0 then
    raise exception 'At least one medicine unit is required';
  end if;

  if not exists (
    select 1 from public.categories
    where is_active and lower(name) = lower(btrim(p_values->>'category'))
  ) then
    raise exception 'Select an active category';
  end if;
  if not exists (
    select 1 from public.brands
    where is_active and lower(name) = lower(btrim(p_values->>'company'))
  ) then
    raise exception 'Select an active manufacturer';
  end if;

  for v_unit in select value from jsonb_array_elements(p_units)
  loop
    v_unit_name := nullif(btrim(v_unit->>'name'), '');
    v_unit_factor := nullif(v_unit->>'conversion_factor', '')::integer;
    v_unit_price := nullif(v_unit->>'price_paisa', '')::integer;
    v_is_default := coalesce((v_unit->>'is_default_sale_unit')::boolean, false);

    if jsonb_typeof(v_unit) <> 'object' or v_unit_name is null then
      raise exception 'Every unit needs a name';
    end if;
    if v_unit_factor is null or v_unit_factor <= 0 or v_unit_factor > 2147483647 then
      raise exception 'Unit conversion factor must be greater than zero';
    end if;
    if v_unit_price is null or v_unit_price < 0 or v_unit_price > 2147483647 then
      raise exception 'Unit price cannot be negative';
    end if;
    if v_is_default then
      v_default_count := v_default_count + 1;
    end if;
  end loop;
  if v_default_count <> 1 then
    raise exception 'Exactly one unit must be the default sale unit';
  end if;

  if p_medicine_id is null then
    insert into public.medicines (
      code, barcode, brand_name, generic_name, category, company,
      drug_class, storage_condition, rack_location, min_stock_alert,
      requires_prescription, is_active
    )
    values (
      btrim(p_values->>'code'), nullif(btrim(p_values->>'barcode'), ''),
      btrim(p_values->>'brand_name'), btrim(p_values->>'generic_name'),
      btrim(p_values->>'category'), btrim(p_values->>'company'),
      p_values->>'drug_class',
      coalesce(nullif(p_values->>'storage_condition', ''), 'ROOM_TEMPERATURE'),
      coalesce(p_values->>'rack_location', ''),
      coalesce(nullif(p_values->>'min_stock_alert', '')::integer, 0),
      coalesce((p_values->>'requires_prescription')::boolean, false),
      coalesce((p_values->>'is_active')::boolean, true)
    )
    returning id into v_id;
  else
    update public.medicines
    set code = btrim(p_values->>'code'),
        barcode = nullif(btrim(p_values->>'barcode'), ''),
        brand_name = btrim(p_values->>'brand_name'),
        generic_name = btrim(p_values->>'generic_name'),
        category = btrim(p_values->>'category'),
        company = btrim(p_values->>'company'),
        drug_class = p_values->>'drug_class',
        storage_condition = coalesce(nullif(p_values->>'storage_condition', ''), 'ROOM_TEMPERATURE'),
        rack_location = coalesce(p_values->>'rack_location', ''),
        min_stock_alert = coalesce(nullif(p_values->>'min_stock_alert', '')::integer, 0),
        requires_prescription = coalesce((p_values->>'requires_prescription')::boolean, false),
        is_active = coalesce((p_values->>'is_active')::boolean, true)
    where id = p_medicine_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Medicine not found';
    end if;
  end if;

  for v_unit in select value from jsonb_array_elements(p_units)
  loop
    v_unit_id := nullif(v_unit->>'id', '')::uuid;
    v_unit_name := btrim(v_unit->>'name');
    v_unit_factor := (v_unit->>'conversion_factor')::integer;
    v_unit_price := (v_unit->>'price_paisa')::integer;
    v_is_default := coalesce((v_unit->>'is_default_sale_unit')::boolean, false);

    if v_unit_id is null then
      insert into public.medicine_units (
        medicine_id, name, conversion_factor, is_default_sale_unit, price_paisa, barcode
      )
      values (
        v_id, v_unit_name, v_unit_factor, v_is_default, v_unit_price,
        nullif(btrim(v_unit->>'barcode'), '')
      );
    else
      update public.medicine_units
      set name = v_unit_name,
          conversion_factor = v_unit_factor,
          is_default_sale_unit = v_is_default,
          price_paisa = v_unit_price,
          barcode = nullif(btrim(v_unit->>'barcode'), '')
      where id = v_unit_id and medicine_id = v_id;
      if not found then
        raise exception 'A selected unit does not belong to this medicine';
      end if;
    end if;
  end loop;

  return v_id;
end;
$function$;

revoke all on function public.save_medicine(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_medicine(uuid, jsonb, jsonb) to authenticated;

commit;
