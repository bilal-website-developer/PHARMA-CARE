-- S6 package 064. Apply only after reviewing the owner-run 063 preflight.
-- Serializes status and profile changes that could reduce a shop's active Admin count.
begin;
set transaction isolation level serializable;

lock table public.profiles in share row exclusive mode;

do $preflight$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Run package 064 as the reviewed database owner role with RLS bypass.';
  end if;
  if to_regprocedure('public.manage_users_team_member_access(uuid,uuid,text)') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.shops') is null then
    raise exception 'The reviewed 063 account/shop schema is missing; rerun the read-only preflight.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'shop_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'shop_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trash_bin_events' and column_name = 'shop_id'
  ) then
    raise exception 'A required shop_id column is missing; do not apply package 064.';
  end if;
end
$preflight$;

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
  v_actor public.profiles%rowtype;
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

  perform pg_catalog.pg_advisory_xact_lock(202610290002);

  select profile.*
    into v_actor
  from public.profiles as profile
  where profile.id = p_actor_id
    and profile.is_active
    and profile.deleted_at is null
  for update;
  if not found or v_actor.role is distinct from 'super_admin' or v_actor.shop_id is not null then
    raise exception using errcode = '42501', message = 'An active platform super_admin is required.';
  end if;
  if p_target_id = p_actor_id then
    raise exception using errcode = 'P0001', message = 'You cannot change your own account status.';
  end if;

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
  if (v_target.role = 'super_admin' and v_target.shop_id is not null)
    or (v_target.role <> 'super_admin' and v_target.shop_id is null) then
    raise exception using errcode = 'P0001', message = 'User has an invalid shop assignment.';
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
    count(*) filter (
      where profile.role = 'admin'
        and profile.is_active
        and profile.deleted_at is null
        and profile.shop_id = v_target.shop_id
    ),
    count(*) filter (
      where profile.role = 'super_admin'
        and profile.is_active
        and profile.deleted_at is null
    ),
    count(*) filter (
      where profile.role = 'super_admin'
        and profile.deleted_at is null
    )
  into v_active_admin_count, v_active_super_admin_count, v_super_admin_count
  from public.profiles as profile;

  if v_target.role = 'admin'
    and v_target.is_active
    and p_action in ('deactivate', 'remove_access')
    and v_active_admin_count <= 1 then
    raise exception using errcode = 'P0001', message = 'Cannot deactivate or remove the last active admin in this shop.';
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

  insert into public.audit_logs (actor_id, action, entity, entity_id, details, shop_id)
  values (
    p_actor_id,
    p_action,
    'profile',
    p_target_id,
    jsonb_build_object('before', v_before, 'after', v_after),
    v_target.shop_id
  );

  if p_action = 'remove_access' then
    insert into public.trash_bin_events (
      actor_id, entity_type, entity_id, action, display_name, metadata, shop_id
    ) values (
      p_actor_id,
      'profile',
      p_target_id,
      'deleted',
      coalesce(nullif(v_target.full_name, ''), nullif(v_target.username, ''), nullif(v_target.email, ''), 'Unknown user'),
      jsonb_build_object('role', v_target.role, 'status', 'removed'),
      v_target.shop_id
    );
  end if;
end
$function$;

create or replace function public.manage_users_profile_update(
  p_actor_id uuid,
  p_target_id uuid,
  p_full_name text,
  p_username text,
  p_email text,
  p_role text,
  p_permissions text[],
  p_is_active boolean,
  p_shop_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_active_admin_count bigint;
  v_active_super_admin_count bigint;
  v_super_admin_count bigint;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  if p_actor_id is null or p_target_id is null then
    raise exception using errcode = '22023', message = 'Actor and target are required.';
  end if;
  if p_role is null or p_role not in ('cashier', 'manager', 'accountant', 'admin', 'super_admin') then
    raise exception using errcode = '22023', message = 'User role is invalid.';
  end if;
  if p_full_name is null or pg_catalog.btrim(p_full_name) = ''
    or p_username is null or pg_catalog.btrim(p_username) = ''
    or p_email is null
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Name, username, and a valid email are required.';
  end if;
  if p_is_active is null or p_permissions is null then
    raise exception using errcode = '22023', message = 'Account status and permissions are required.';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(p_permissions) as permission_row(permission)
    where permission_row.permission is null
      or permission_row.permission not in (
      'pos', 'products', 'categories', 'suppliers', 'customers', 'sales_history',
      'purchase_history', 'purchases', 'expenses', 'stock_inventory', 'reports',
      'manage_users', 'settings', 'pos_print_sale', 'pos_print_payment'
    )
  ) then
    raise exception using errcode = '22023', message = 'Permissions contain an invalid permission key.';
  end if;
  if p_role = 'super_admin' and (
    p_shop_id is not null or pg_catalog.cardinality(p_permissions) <> 0
  ) then
    raise exception using errcode = '22023', message = 'Super Admin accounts must be platform-only and have no shop permissions.';
  end if;
  if p_role <> 'super_admin' and p_shop_id is null then
    raise exception using errcode = '22023', message = 'A shop assignment is required for this role.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(202610290002);

  select profile.*
    into v_actor
  from public.profiles as profile
  where profile.id = p_actor_id
    and profile.is_active
    and profile.deleted_at is null
  for update;
  if not found
    or v_actor.role not in ('admin', 'super_admin')
    or (v_actor.role = 'super_admin' and v_actor.shop_id is not null)
    or (v_actor.role = 'admin' and v_actor.shop_id is null) then
    raise exception using errcode = '42501', message = 'An active Admin or platform Super Admin is required.';
  end if;

  select profile.*
    into v_target
  from public.profiles as profile
  where profile.id = p_target_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'User not found.';
  end if;
  if v_target.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'Restore this user before editing.';
  end if;
  if p_is_active is distinct from v_target.is_active then
    raise exception using errcode = '22023', message = 'Use the dedicated account status action to change account status.';
  end if;
  if (v_target.role = 'super_admin' and v_target.shop_id is not null)
    or (v_target.role <> 'super_admin' and v_target.shop_id is null) then
    raise exception using errcode = 'P0001', message = 'User has an invalid shop assignment.';
  end if;

  if v_actor.role = 'super_admin' then
    if p_target_id = p_actor_id then
      if v_target.role <> 'super_admin'
        or p_role <> 'super_admin'
        or p_shop_id is not null
        or p_permissions is distinct from v_target.permissions then
        raise exception using errcode = '42501', message = 'Super Admins cannot change their own role, permissions, or shop assignment.';
      end if;
    elsif v_target.role <> 'admin' or p_role <> 'admin' then
      raise exception using errcode = '42501', message = 'Super Admins may edit Admin accounts only.';
    elsif not exists (
      select 1 from public.shops as shop
      where shop.id = p_shop_id and shop.status = 'active'
    ) then
      raise exception using errcode = '22023', message = 'Select an active shop for this Admin account.';
    end if;
  else
    if not exists (
      select 1 from public.shops as shop
      where shop.id = v_actor.shop_id and shop.status = 'active'
    ) then
      raise exception using errcode = '42501', message = 'The Admin shop is not active.';
    end if;
    if p_target_id = p_actor_id then
      if v_target.role <> 'admin'
        or p_role <> 'admin'
        or p_shop_id is distinct from v_actor.shop_id
        or p_permissions is distinct from v_target.permissions then
        raise exception using errcode = '42501', message = 'Admins cannot change their own role, permissions, or shop assignment.';
      end if;
    elsif v_target.created_by is distinct from p_actor_id
      or v_target.shop_id is distinct from v_actor.shop_id
      or v_target.role not in ('cashier', 'manager')
      or p_role not in ('cashier', 'manager')
      or p_shop_id is distinct from v_actor.shop_id then
      raise exception using errcode = '42501', message = 'Admins may edit only their own same-shop Cashier and Manager accounts.';
    elsif p_permissions @> array['manage_users']::text[]
      or exists (
        select 1
        from pg_catalog.unnest(p_permissions) as permission_row(permission)
        where not (
          permission_row.permission = any(v_actor.permissions)
          or permission_row.permission = any(v_target.permissions)
        )
      ) then
      raise exception using errcode = '42501', message = 'Admins may grant only permissions they hold or the target already has.';
    end if;
  end if;

  if p_role <> 'super_admin' and not exists (
    select 1 from public.shops as shop
    where shop.id = p_shop_id and shop.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'The selected shop is not active.';
  end if;

  if v_target.role = 'admin'
    and v_target.is_active
    and v_target.deleted_at is null
    and (
      p_role <> 'admin'
      or p_shop_id is distinct from v_target.shop_id
      or p_is_active is not true
    ) then
    select count(*)
      into v_active_admin_count
    from public.profiles as profile
    where profile.role = 'admin'
      and profile.is_active
      and profile.deleted_at is null
      and profile.shop_id = v_target.shop_id;
    if v_active_admin_count <= 1 then
      raise exception using errcode = 'P0001', message = 'Cannot move or demote the last active admin in this shop.';
    end if;
  end if;

  select
    count(*) filter (
      where profile.role = 'super_admin'
        and profile.is_active
        and profile.deleted_at is null
    ),
    count(*) filter (
      where profile.role = 'super_admin'
        and profile.deleted_at is null
    )
  into v_active_super_admin_count, v_super_admin_count
  from public.profiles as profile;

  if v_target.role = 'super_admin'
    and (
      p_role <> 'super_admin'
      or p_is_active is not true
    )
    and (
      v_super_admin_count <= 1
      or (v_target.is_active and v_active_super_admin_count <= 1)
    ) then
    raise exception using errcode = 'P0001', message = 'Cannot remove the last super_admin.';
  end if;

  v_before := jsonb_build_object(
    'role', v_target.role,
    'permissions', v_target.permissions,
    'is_active', v_target.is_active
  );
  v_after := jsonb_build_object(
    'role', p_role,
    'permissions', p_permissions,
    'is_active', p_is_active
  );

  update public.profiles
  set full_name = p_full_name,
      username = p_username,
      email = p_email,
      role = p_role,
      permissions = p_permissions,
      is_active = p_is_active,
      shop_id = p_shop_id
  where id = p_target_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details, shop_id)
  values (
    p_actor_id,
    'update',
    'profile',
    p_target_id,
    jsonb_build_object('before', v_before, 'after', v_after),
    coalesce(v_target.shop_id, p_shop_id)
  );
end
$function$;

revoke all on function public.manage_users_team_member_access(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.manage_users_team_member_access(uuid, uuid, text)
  to service_role;

revoke all on function public.manage_users_profile_update(uuid, uuid, text, text, text, text, text[], boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.manage_users_profile_update(uuid, uuid, text, text, text, text, text[], boolean, uuid)
  to service_role;

commit;
