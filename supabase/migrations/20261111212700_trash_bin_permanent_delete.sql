begin;

create or replace function public.trash_bin_events_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_events jsonb;
begin
  select role into v_actor_role
  from public.profiles
  where id = v_actor and is_active and deleted_at is null;

  if v_actor is null or v_actor_role not in ('admin', 'super_admin') or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  select coalesce(jsonb_agg(event_row.value order by event_row.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select
      event.created_at,
      jsonb_build_object(
        'id', event.id,
        'actor_id', event.actor_id,
        'actor_name', coalesce(
          nullif(actor.username, ''),
          nullif(actor.full_name, ''),
          nullif(actor.email, ''),
          'Unknown user'
        ),
        'entity_type', event.entity_type,
        'entity_id', event.entity_id,
        'entity_role', event.metadata->>'role',
        'action', event.action,
        'display_name', event.display_name,
        'reason', event.reason,
        'created_at', event.created_at,
        'can_restore', case
          when event.action = 'deleted' and event.entity_type = 'profile'
            then exists (
              select 1 from public.profiles p
              where p.id = event.entity_id and p.deleted_at is not null
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'medicine'
            then exists (
              select 1 from public.medicines m
              where m.id = event.entity_id and m.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'supplier'
            then exists (
              select 1 from public.suppliers s
              where s.id = event.entity_id and s.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          else false
        end,
        'can_permanently_delete', case
          when event.action = 'deleted' and event.entity_type = 'profile'
            then (
              exists (
                select 1 from public.profiles p
                where p.id = event.entity_id
                  and p.deleted_at is not null
                  and p.id <> v_actor
                  and (
                    v_actor_role = 'super_admin'
                    or (
                      v_actor_role = 'admin'
                      and p.created_by = v_actor
                      and p.role in ('cashier', 'manager', 'accountant')
                    )
                  )
              )
              or (
                v_actor_role = 'super_admin'
                and event.entity_id <> v_actor
                and not exists (select 1 from public.profiles p where p.id = event.entity_id)
                and not exists (select 1 from auth.users u where u.id = event.entity_id)
              )
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'medicine'
            then exists (
              select 1 from public.medicines m
              where m.id = event.entity_id and m.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'supplier'
            then exists (
              select 1 from public.suppliers s
              where s.id = event.entity_id and s.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          else false
        end
      ) as value
    from public.trash_bin_events event
    left join public.profiles actor on actor.id = event.actor_id
    order by event.created_at desc
    limit 1000
  ) event_row;

  return v_events;
end;
$function$;

create or replace function public.trash_bin_permanently_delete(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_event public.trash_bin_events%rowtype;
  v_actor_role text;
  v_entity_name text;
begin
  select role into v_actor_role
  from public.profiles
  where id = v_actor and is_active and deleted_at is null;

  if v_actor is null or v_actor_role not in ('admin', 'super_admin') or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  select * into v_event
  from public.trash_bin_events
  where id = p_event_id
  for update;

  if not found or v_event.action <> 'deactivated'
    or v_event.entity_type not in ('medicine', 'supplier') then
    raise exception 'This Trash Bin item cannot be permanently deleted.';
  end if;

  if exists (
    select 1 from public.trash_bin_events later
    where later.entity_type = v_event.entity_type
      and later.entity_id = v_event.entity_id
      and (later.created_at, later.id) > (v_event.created_at, v_event.id)
  ) then
    raise exception 'This Trash Bin item is no longer the latest event and cannot be permanently deleted.';
  end if;

  if v_event.entity_type = 'medicine' then
    select concat_ws(' ', nullif(brand_name, ''), nullif(generic_name, ''))
      into v_entity_name
    from public.medicines
    where id = v_event.entity_id and is_active = false
    for update;
    if not found then raise exception 'Inactive product not found.'; end if;

    begin
      delete from public.medicines where id = v_event.entity_id and is_active = false;
    exception when foreign_key_violation then
      raise exception 'This product is still referenced by stock or transaction history and cannot be permanently deleted.';
    end;
  else
    select name into v_entity_name
    from public.suppliers
    where id = v_event.entity_id and is_active = false
    for update;
    if not found then raise exception 'Inactive supplier not found.'; end if;

    begin
      delete from public.suppliers where id = v_event.entity_id and is_active = false;
    exception when foreign_key_violation then
      raise exception 'This supplier is still referenced by purchase or stock history and cannot be permanently deleted.';
    end;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    v_actor,
    'permanent_delete',
    v_event.entity_type,
    v_event.entity_id,
    jsonb_build_object(
      'trash_event_id', v_event.id,
      'display_name', coalesce(v_entity_name, v_event.display_name)
    )
  );

  delete from public.trash_bin_events
  where entity_type = v_event.entity_type and entity_id = v_event.entity_id;

  return jsonb_build_object('message', coalesce(v_entity_name, v_event.display_name) || ' permanently deleted.');
end;
$function$;

create or replace function public.trash_bin_finalize_profile_purge(
  p_event_id uuid,
  p_target_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_event public.trash_bin_events%rowtype;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and is_active and deleted_at is null and role in ('admin', 'super_admin')
  ) then
    raise exception 'An active admin or super_admin profile is required.';
  end if;
  if exists (select 1 from auth.users where id = p_target_id)
    or exists (select 1 from public.profiles where id = p_target_id) then
    raise exception 'The user account has not been permanently deleted.';
  end if;

  select * into v_event
  from public.trash_bin_events
  where id = p_event_id
    and entity_type = 'profile'
    and entity_id = p_target_id
    and action = 'deleted'
  for update;
  if not found then raise exception 'Deleted user Trash Bin event not found.'; end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    p_actor_id,
    'permanent_delete',
    'profile',
    p_target_id,
    jsonb_build_object(
      'trash_event_id', v_event.id,
      'display_name', v_event.display_name,
      'role', v_event.metadata->>'role'
    )
  );

  delete from public.trash_bin_events
  where entity_type = 'profile' and entity_id = p_target_id;
end;
$function$;

revoke all on function public.trash_bin_permanently_delete(uuid) from public, anon, authenticated;
grant execute on function public.trash_bin_permanently_delete(uuid) to authenticated;

revoke all on function public.trash_bin_finalize_profile_purge(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.trash_bin_finalize_profile_purge(uuid, uuid, uuid) to service_role;

commit;
