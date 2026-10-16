begin;

create or replace function public.activate_supplier(p_supplier_id uuid)
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
  set is_active = true
  where id = p_supplier_id and is_active = false
  returning id into v_supplier_id;
  if not found then raise exception 'Inactive supplier not found'; end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    v_actor,
    'supplier_activated',
    'suppliers',
    v_supplier_id,
    jsonb_build_object('supplier_id', v_supplier_id)
  );

  return v_supplier_id;
end;
$function$;

revoke execute on function public.activate_supplier(uuid) from public, anon;
grant execute on function public.activate_supplier(uuid) to authenticated;

commit;
