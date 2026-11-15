-- Rollback for S6 package 064.
-- Revert the manage-users Edge Function before running this file.
begin;
set transaction isolation level serializable;
lock table public.profiles in share row exclusive mode;

drop function if exists public.manage_users_profile_update(uuid, uuid, text, text, text, text, text[], boolean, uuid);

create or replace function public.manage_users_team_member_access(
  p_actor_id uuid,
  p_target_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
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

  perform pg_catalog.pg_advisory_xact_lock(202610290002);
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
    when p_action = 'remove_access' then pg_catalog.clock_timestamp()
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
$function$;

revoke all on function public.manage_users_team_member_access(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.manage_users_team_member_access(uuid, uuid, text)
  to service_role;

commit;

with rollback_state as (
  select
    to_regprocedure('public.manage_users_profile_update(uuid,uuid,text,text,text,text,text[],boolean,uuid)') is null
      as new_profile_update_rpc_absent,
    exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'manage_users_team_member_access'
        and procedure.prosrc like '%count(*) filter (where role = ''admin'' and is_active and deleted_at is null)%'
        and procedure.prosrc not like '%profile.shop_id = v_target.shop_id%'
    ) as legacy_status_rpc_restored,
    pg_catalog.has_function_privilege(
      'service_role',
      'public.manage_users_team_member_access(uuid,uuid,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.manage_users_team_member_access(uuid,uuid,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.manage_users_team_member_access(uuid,uuid,text)',
      'EXECUTE'
    )
    and not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) as acl
      where namespace.nspname = 'public'
        and procedure.proname = 'manage_users_team_member_access'
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as status_rpc_service_role_only
)
select jsonb_build_object(
  'stage', 'S6 package 064 rollback check',
  'status', case
    when new_profile_update_rpc_absent
      and legacy_status_rpc_restored
      and status_rpc_service_role_only
    then 'PASS' else 'FAIL' end,
  'new_profile_update_rpc_absent', new_profile_update_rpc_absent,
  'legacy_status_rpc_restored', legacy_status_rpc_restored,
  'status_rpc_service_role_only', status_rpc_service_role_only
) as s6_manage_users_transactional_admin_guard_rollback_check
from rollback_state;
