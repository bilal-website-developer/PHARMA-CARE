-- Rollback-only smoke test for S6 package 064.
begin;
set local request.jwt.claim.role = 'service_role';

do $smoke$
declare
  v_actor_id uuid;
  v_shop_id uuid;
  v_admin_ids uuid[];
  v_admin_count bigint;
  v_index integer;
  v_last_admin_index integer;
  v_admin public.profiles%rowtype;
  v_permissions text[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Smoke setup did not set the service-role claim.';
  end if;

  select profile.id
    into v_actor_id
  from public.profiles as profile
  where profile.role = 'super_admin'
    and profile.shop_id is null
    and profile.is_active
    and profile.deleted_at is null
  order by profile.id
  limit 1;
  if v_actor_id is null then
    raise exception 'Smoke test requires an active platform Super Admin.';
  end if;

  select profile.shop_id, count(*), array_agg(profile.id order by profile.id)
    into v_shop_id, v_admin_count, v_admin_ids
  from public.profiles as profile
  where profile.role = 'admin'
    and profile.shop_id is not null
    and profile.is_active
    and profile.deleted_at is null
  group by profile.shop_id
  order by count(*) desc, profile.shop_id
  limit 1;
  if v_admin_count is null or v_admin_count < 1 then
    raise exception 'Smoke test requires at least one active shop Admin.';
  end if;

  if v_admin_count >= 2 then
    v_last_admin_index := array_length(v_admin_ids, 1);
    for v_index in 1 .. (v_last_admin_index - 1) loop
      perform public.manage_users_team_member_access(v_actor_id, v_admin_ids[v_index], 'deactivate');
    end loop;

    begin
      perform public.manage_users_team_member_access(v_actor_id, v_admin_ids[v_last_admin_index], 'deactivate');
      raise exception using errcode = 'ZX001', message = 'Expected last-active-Admin deactivation to be denied.';
    exception
      when sqlstate 'P0001' then
        null;
    end;

    begin
      perform public.manage_users_team_member_access(v_actor_id, v_admin_ids[v_last_admin_index], 'remove_access');
      raise exception using errcode = 'ZX001', message = 'Expected last-active-Admin removal to be denied.';
    exception
      when sqlstate 'P0001' then
        null;
    end;

    for v_index in 1 .. (v_last_admin_index - 1) loop
      perform public.manage_users_team_member_access(v_actor_id, v_admin_ids[v_index], 'reactivate');
    end loop;
  else
    begin
      perform public.manage_users_team_member_access(v_actor_id, v_admin_ids[1], 'deactivate');
      raise exception using errcode = 'ZX001', message = 'Expected sole active Admin deactivation to be denied.';
    exception
      when sqlstate 'P0001' then
        null;
    end;

    begin
      perform public.manage_users_team_member_access(v_actor_id, v_admin_ids[1], 'remove_access');
      raise exception using errcode = 'ZX001', message = 'Expected sole active Admin removal to be denied.';
    exception
      when sqlstate 'P0001' then
        null;
    end;
  end if;

  select profile.*
    into v_admin
  from public.profiles as profile
  where profile.id = v_admin_ids[1];

  select coalesce(array_agg(permission_row.permission), array[]::text[])
    into v_permissions
  from (
    select distinct permission_row.permission
    from pg_catalog.unnest(v_admin.permissions) as permission_row(permission)
    where permission_row.permission in (
      'pos', 'products', 'categories', 'suppliers', 'customers', 'sales_history',
      'purchase_history', 'purchases', 'expenses', 'stock_inventory', 'reports',
      'manage_users', 'settings', 'pos_print_sale', 'pos_print_payment'
    )
  ) as permission_row;

  perform public.manage_users_profile_update(
    v_actor_id,
    v_admin.id,
    v_admin.full_name,
    coalesce(nullif(v_admin.username, ''), 's6-smoke-' || replace(v_admin.id::text, '-', '')),
    coalesce(nullif(v_admin.email, ''), 's6-smoke-' || replace(v_admin.id::text, '-', '') || '@example.invalid'),
    'admin',
    v_permissions,
    v_admin.is_active,
    v_shop_id
  );
end
$smoke$;

rollback;

select jsonb_build_object(
  'stage', 'S6 package 064 transactional Admin guard smoke test',
  'status', 'PASS',
  'rollback_only', true,
  'tested_shop_scope', 'same-shop active Admin count',
  'tested_profile_update', 'same-shop Admin edit through the guarded RPC'
) as s6_manage_users_transactional_admin_guard_smoke;
