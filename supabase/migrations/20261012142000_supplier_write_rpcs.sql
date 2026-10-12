begin;

create or replace function public.save_supplier(
  p_supplier_id uuid,
  p_name text,
  p_contact text,
  p_address text,
  p_licence_or_tax_number text,
  p_payment_terms text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_supplier_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_contact text := btrim(coalesce(p_contact, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_licence text := btrim(coalesce(p_licence_or_tax_number, ''));
  v_payment_terms text := btrim(coalesce(p_payment_terms, ''));
  v_action text;
begin
  if v_actor is null or not exists (
    select 1
    from public.profiles
    where id = v_actor and is_active = true and deleted_at is null
  ) then
    raise exception 'An active authenticated user is required';
  end if;
  if not public.has_any_permission(array['suppliers']::text[]) then
    raise exception 'You do not have permission to manage suppliers';
  end if;
  if v_name = '' then raise exception 'Supplier name is required'; end if;
  if length(v_name) > 200 then raise exception 'Supplier name is too long'; end if;
  if length(v_contact) > 500 then raise exception 'Supplier contact is too long'; end if;
  if length(v_address) > 2000 then raise exception 'Supplier address is too long'; end if;
  if length(v_licence) > 500 then raise exception 'Supplier licence or tax number is too long'; end if;
  if v_payment_terms = '' or length(v_payment_terms) > 100 then
    raise exception 'Supplier payment terms are invalid';
  end if;

  if p_supplier_id is null then
    insert into public.suppliers (
      name, contact, address, licence_or_tax_number, payment_terms, is_active
    )
    values (v_name, v_contact, v_address, v_licence, v_payment_terms, true)
    returning id into v_supplier_id;
    v_action := 'supplier_created';
  else
    update public.suppliers
    set name = v_name,
        contact = v_contact,
        address = v_address,
        licence_or_tax_number = v_licence,
        payment_terms = v_payment_terms
    where id = p_supplier_id
    returning id into v_supplier_id;
    if not found then raise exception 'Supplier not found'; end if;
    v_action := 'supplier_updated';
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    v_actor,
    v_action,
    'suppliers',
    v_supplier_id,
    jsonb_build_object('supplier_id', v_supplier_id)
  );

  return v_supplier_id;
end;
$function$;

create or replace function public.deactivate_supplier(p_supplier_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_supplier_id uuid;
begin
  if v_actor is null or not exists (
    select 1
    from public.profiles
    where id = v_actor and is_active = true and deleted_at is null
  ) then
    raise exception 'An active authenticated user is required';
  end if;
  if not public.has_any_permission(array['suppliers']::text[]) then
    raise exception 'You do not have permission to manage suppliers';
  end if;
  if p_supplier_id is null then raise exception 'A supplier is required'; end if;

  update public.suppliers
  set is_active = false
  where id = p_supplier_id and is_active = true
  returning id into v_supplier_id;
  if not found then raise exception 'Active supplier not found'; end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    v_actor,
    'supplier_deactivated',
    'suppliers',
    v_supplier_id,
    jsonb_build_object('supplier_id', v_supplier_id)
  );

  return v_supplier_id;
end;
$function$;

commit;
