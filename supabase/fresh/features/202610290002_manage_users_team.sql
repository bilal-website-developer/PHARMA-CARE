alter table public.profiles
  add column if not exists created_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_created_by_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_created_by_fkey
      foreign key (created_by)
      references public.profiles (id)
      on delete set null;
  end if;
end
$$;

create index if not exists profiles_created_by_idx
  on public.profiles (created_by);

comment on column public.profiles.created_by is
  'Creator attribution for Admin team scoping; legacy rows remain unassigned.';

create or replace function public.manage_users_current_active_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.is_active
    and profile.deleted_at is null
  limit 1;
$$;

revoke all on function public.manage_users_current_active_profile_role() from public, anon;
grant execute on function public.manage_users_current_active_profile_role() to authenticated;

create or replace function public.manage_users_team_member_access(
  p_actor_id uuid,
  p_target_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_target public.profiles%rowtype;
  v_next_active boolean;
  v_next_deleted_at timestamptz;
  v_active_admin_count bigint;
  v_active_super_admin_count bigint;
  v_super_admin_count bigint;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  if p_action is null or p_action not in ('deactivate', 'reactivate', 'remove_access') then
    raise exception using errcode = '22023', message = 'Invalid account access action.';
  end if;

  select profile.role
    into v_actor_role
  from public.profiles as profile
  where profile.id = p_actor_id
    and profile.is_active
    and profile.deleted_at is null;
  if not found or v_actor_role is distinct from 'super_admin' then
    raise exception using errcode = '42501', message = 'An active super_admin is required.';
  end if;
  if p_target_id = p_actor_id then
    raise exception using errcode = 'P0001', message = 'You cannot change your own account status.';
  end if;

  perform pg_advisory_xact_lock(202610290002);
  select profile.*
    into v_target
  from public.profiles as profile
  where profile.id = p_target_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'User not found.';
  end if;
  if v_target.role is null
    or v_target.role not in ('cashier', 'manager', 'accountant', 'admin', 'super_admin') then
    raise exception using errcode = 'P0001', message = 'User has an invalid role.';
  end if;
  if v_target.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'User is already removed.';
  end if;
  if p_action = 'deactivate' and v_target.is_active is not true then
    raise exception using errcode = 'P0001', message = 'User is already deactivated.';
  end if;
  if p_action = 'reactivate' and v_target.is_active is true then
    raise exception using errcode = 'P0001', message = 'User is already active.';
  end if;

  select
    count(*) filter (where role = 'admin' and is_active and deleted_at is null),
    count(*) filter (where role = 'super_admin' and is_active and deleted_at is null),
    count(*) filter (where role = 'super_admin' and deleted_at is null)
  into v_active_admin_count, v_active_super_admin_count, v_super_admin_count
  from public.profiles;

  if v_target.role = 'admin'
    and v_target.is_active
    and p_action in ('deactivate', 'remove_access')
    and v_active_admin_count <= 1 then
    raise exception using errcode = 'P0001', message = 'Cannot deactivate or remove the last active admin.';
  end if;
  if v_target.role = 'super_admin'
    and p_action = 'deactivate'
    and v_active_super_admin_count <= 1 then
    raise exception using errcode = 'P0001', message = 'Cannot deactivate the last super_admin.';
  end if;
  if v_target.role = 'super_admin'
    and p_action = 'remove_access'
    and (
      v_super_admin_count <= 1
      or (v_target.is_active and v_active_super_admin_count <= 1)
    ) then
    raise exception using errcode = 'P0001', message = 'Cannot remove the last super_admin.';
  end if;

  v_next_active := p_action = 'reactivate';
  v_next_deleted_at := case
    when p_action = 'remove_access' then clock_timestamp()
    else null
  end;
  v_before := jsonb_build_object(
    'role', v_target.role,
    'permissions', v_target.permissions,
    'is_active', v_target.is_active,
    'deleted_at', v_target.deleted_at
  );
  v_after := jsonb_build_object(
    'role', v_target.role,
    'permissions', v_target.permissions,
    'is_active', v_next_active,
    'deleted_at', v_next_deleted_at
  );

  update public.profiles
  set is_active = v_next_active,
      deleted_at = v_next_deleted_at
  where id = p_target_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    p_actor_id,
    p_action,
    'profile',
    p_target_id,
    jsonb_build_object('before', v_before, 'after', v_after)
  );

  if p_action = 'remove_access' then
    insert into public.trash_bin_events (
      actor_id, entity_type, entity_id, action, display_name, metadata
    ) values (
      p_actor_id,
      'profile',
      p_target_id,
      'deleted',
      coalesce(nullif(v_target.full_name, ''), nullif(v_target.username, ''), nullif(v_target.email, ''), 'Unknown user'),
      jsonb_build_object('role', v_target.role, 'status', 'removed')
    );
  end if;
end
$$;

revoke all on function public.manage_users_team_member_access(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.manage_users_team_member_access(uuid, uuid, text) to service_role;

create or replace function public.trash_bin_events_list()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := public.manage_users_current_active_profile_role();
  v_events jsonb;
begin
  if v_actor is null or v_actor_role is null or v_actor_role not in ('admin', 'super_admin') then
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
        'actor_name', case
          when v_actor_role = 'super_admin'
            or actor.id = v_actor
            or actor.created_by = v_actor
          then coalesce(
            nullif(actor.username, ''),
            nullif(actor.full_name, ''),
            nullif(actor.email, ''),
            'Unknown user'
          )
          else 'Unknown user'
        end,
        'entity_type', event.entity_type,
        'entity_id', event.entity_id,
        'entity_role', event.metadata->>'role',
        'action', event.action,
        'display_name', event.display_name,
        'reason', event.reason,
        'created_at', event.created_at,
        'can_restore', case
          when event.action = 'deleted' and event.entity_type = 'profile' then
            v_actor_role = 'super_admin'
            and exists (
              select 1 from public.profiles as profile
              where profile.id = event.entity_id and profile.deleted_at is not null
            )
            and not exists (
              select 1 from public.trash_bin_events as later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'medicine' then
            exists (
              select 1 from public.medicines as medicine
              where medicine.id = event.entity_id and medicine.is_active = false
            )
            and not exists (
              select 1 from public.trash_bin_events as later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'supplier' then
            exists (
              select 1 from public.suppliers as supplier
              where supplier.id = event.entity_id and supplier.is_active = false
            )
            and not exists (
              select 1 from public.trash_bin_events as later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          else false
        end
      ) as value
    from public.trash_bin_events as event
    left join public.profiles as actor on actor.id = event.actor_id
    where event.entity_type <> 'profile'
      or v_actor_role = 'super_admin'
      or exists (
        select 1 from public.profiles as member
        where member.id = event.entity_id
          and member.created_by = v_actor
      )
    order by event.created_at desc
    limit 1000
  ) as event_row;

  return v_events;
end
$$;

drop policy if exists "profiles read own profile or admin reads all" on public.profiles;
create policy "profiles read own profile or assigned team" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.manage_users_current_active_profile_role() = 'super_admin'
    or (
      public.manage_users_current_active_profile_role() = 'admin'
      and created_by = auth.uid()
    )
  );

drop policy if exists "profiles admin can add profiles" on public.profiles;
drop policy if exists "profiles admin can delete profiles" on public.profiles;
drop policy if exists "profiles admin can edit profiles" on public.profiles;
