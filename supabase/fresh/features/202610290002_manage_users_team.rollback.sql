begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'created_by'
  ) then
    raise exception 'Rollback stopped: public.profiles.created_by does not exist.';
  end if;

  if exists (
    select 1
    from public.profiles
    where created_by is not null
  ) then
    raise exception 'Rollback stopped: created_by attribution is populated; preserve it or explicitly archive it before rollback.';
  end if;
end
$$;

create or replace function public.trash_bin_events_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_events jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active and deleted_at is null
  ) or not public.is_admin() then
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

drop policy if exists "profiles read own profile or assigned team" on public.profiles;
drop function if exists public.manage_users_team_member_access(uuid, uuid, text);
drop function if exists public.manage_users_current_active_profile_role();
drop index if exists public.profiles_created_by_idx;
alter table public.profiles
  drop constraint if exists profiles_created_by_fkey;
alter table public.profiles
  drop column created_by;

create policy "profiles admin can add profiles" on public.profiles
  for insert to authenticated
  with check (public.is_admin());
create policy "profiles admin can delete profiles" on public.profiles
  for delete to authenticated
  using (public.is_admin());
create policy "profiles admin can edit profiles" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy "profiles read own profile or admin reads all" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

commit;
