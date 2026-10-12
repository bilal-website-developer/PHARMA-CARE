begin;

create sequence if not exists public.medicine_barcode_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

create or replace function public.ean13_check_digit(payload12 text)
returns text
language plpgsql
immutable
set search_path = public
as $function$
declare
  v_digits text;
  v_sum integer := 0;
  v_index integer;
  v_digit integer;
begin
  v_digits := regexp_replace(coalesce(payload12, ''), '\D', '', 'g');
  if length(v_digits) <> 12 then
    raise exception 'EAN-13 payload must contain exactly 12 digits';
  end if;

  for v_index in 1..12 loop
    v_digit := substr(v_digits, v_index, 1)::int;
    if v_index % 2 = 1 then
      v_sum := v_sum + v_digit;
    else
      v_sum := v_sum + (v_digit * 3);
    end if;
  end loop;

  return ((10 - (v_sum % 10)) % 10)::text;
end;
$function$;

create or replace function public.assign_medicine_barcode(
  p_medicine_id uuid,
  p_barcode text default null,
  p_replace boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_medicine record;
  v_trimmed text;
  v_candidate text;
  v_payload text;
  v_next bigint;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['products']::text[]) then
    raise exception 'An active user with products permission is required';
  end if;

  if p_medicine_id is null then
    raise exception 'A medicine id is required';
  end if;

  select * into v_medicine
  from public.medicines
  where id = p_medicine_id;

  if not found then
    raise exception 'Medicine not found';
  end if;

  if p_barcode is not null then
    v_trimmed := btrim(p_barcode);
    if v_trimmed = '' then
      raise exception 'Barcode value cannot be blank';
    end if;

    if length(v_trimmed) = 13 and v_trimmed ~ '^\d+$' then
      if public.ean13_check_digit(substr(v_trimmed, 1, 12)) <> substr(v_trimmed, 13, 1) then
        raise exception 'EAN-13 barcode checksum is invalid';
      end if;
    end if;

    if v_medicine.barcode is not null and btrim(v_medicine.barcode) <> '' and not p_replace then
      raise exception 'This medicine already has a barcode. Use replace=true to overwrite it.';
    end if;

    update public.medicines
    set barcode = v_trimmed
    where id = p_medicine_id;

    insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values (
      auth.uid(),
      'assign_medicine_barcode',
      'medicines',
      p_medicine_id,
      jsonb_build_object('barcode', v_trimmed, 'replaced', p_replace)
    );

    return v_trimmed;
  end if;

  if v_medicine.barcode is not null and btrim(v_medicine.barcode) <> '' and not p_replace then
    return v_medicine.barcode;
  end if;

  loop
    v_next := nextval('public.medicine_barcode_seq');
    v_payload := '200' || lpad(v_next::text, 9, '0');
    v_candidate := v_payload || public.ean13_check_digit(v_payload);

    if not exists (
      select 1
      from public.medicines
      where barcode = v_candidate
        and id <> p_medicine_id
    ) then
      update public.medicines
      set barcode = v_candidate
      where id = p_medicine_id;

      insert into public.audit_logs (actor_id, action, entity, entity_id, details)
      values (
        auth.uid(),
        'assign_medicine_barcode',
        'medicines',
        p_medicine_id,
        jsonb_build_object('barcode', v_candidate, 'replaced', p_replace)
      );

      return v_candidate;
    end if;
  end loop;
end;
$function$;

create or replace function public.assign_missing_barcodes(
  p_medicine_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_ids uuid[] := coalesce(p_medicine_ids, array[]::uuid[]);
  v_medicine_id uuid;
  v_existing_barcode text;
  v_assigned integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) or not public.has_any_permission(array['products']::text[]) then
    raise exception 'An active user with products permission is required';
  end if;

  if array_length(v_ids, 1) is null then
    return jsonb_build_object('assigned', 0, 'skipped', 0, 'failed', 0);
  end if;

  foreach v_medicine_id in array v_ids loop
    if v_medicine_id is null then
      v_failed := v_failed + 1;
      continue;
    end if;

    begin
      select barcode into v_existing_barcode
      from public.medicines
      where id = v_medicine_id;

      if v_existing_barcode is not null and btrim(v_existing_barcode) <> '' then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_existing_barcode := public.assign_medicine_barcode(v_medicine_id, null, false);
      if v_existing_barcode is not null and btrim(v_existing_barcode) <> '' then
        v_assigned := v_assigned + 1;
      else
        v_failed := v_failed + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('assigned', v_assigned, 'skipped', v_skipped, 'failed', v_failed);
end;
$function$;

revoke all on function public.ean13_check_digit(text) from public, anon;
revoke all on function public.assign_medicine_barcode(uuid, text, boolean) from public, anon;
revoke all on function public.assign_missing_barcodes(uuid[]) from public, anon;

grant execute on function public.assign_medicine_barcode(uuid, text, boolean) to authenticated;
grant execute on function public.assign_missing_barcodes(uuid[]) to authenticated;

commit;

notify pgrst, 'reload schema';
