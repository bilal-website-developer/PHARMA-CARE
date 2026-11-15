-- Final metadata and definition check for S6 package 064.
with routines as (
  select
    procedure.proname,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.prosrc,
    procedure.proacl,
    procedure.proowner,
    procedure.oid
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and (
      (procedure.proname = 'manage_users_team_member_access'
        and pg_catalog.pg_get_function_identity_arguments(procedure.oid)
          = 'p_actor_id uuid, p_target_id uuid, p_action text')
      or (procedure.proname = 'manage_users_profile_update'
        and pg_catalog.pg_get_function_identity_arguments(procedure.oid)
          = 'p_actor_id uuid, p_target_id uuid, p_full_name text, p_username text, p_email text, p_role text, p_permissions text[], p_is_active boolean, p_shop_id uuid')
    )
),
checks as (
  select
    count(*) = 2 as both_routines_exist,
    bool_and(prosecdef) as both_security_definer,
    bool_and(proconfig @> array['search_path=""']::text[]) as both_empty_search_path,
    bool_and(pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')) as service_role_execute,
    bool_and(not pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')) as anon_execute_revoked,
    bool_and(not pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')) as authenticated_execute_revoked,
    bool_and(not exists (
      select 1
      from pg_catalog.aclexplode(coalesce(routines.proacl, pg_catalog.acldefault('f', routines.proowner))) as acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )) as public_execute_revoked,
    bool_and(pg_catalog.strpos(prosrc, 'pg_advisory_xact_lock') > 0) as both_use_account_lock,
    bool_and(
      proname <> 'manage_users_team_member_access'
      or (
        pg_catalog.strpos(prosrc, 'profile.shop_id = v_target.shop_id') > 0
        and pg_catalog.strpos(prosrc, 'v_active_admin_count <= 1') > 0
      )
    ) as status_guard_is_shop_scoped,
    bool_and(
      proname <> 'manage_users_profile_update'
      or (
        pg_catalog.strpos(prosrc, 'profile.shop_id = v_target.shop_id') > 0
        and pg_catalog.strpos(prosrc, 'Cannot move or demote the last active admin in this shop.') > 0
      )
    ) as profile_update_guard_is_shop_scoped
  from routines
)
select jsonb_build_object(
  'stage', 'S6 package 064 final check',
  'status', case when coalesce(both_routines_exist, false)
    and coalesce(both_security_definer, false)
    and coalesce(both_empty_search_path, false)
    and coalesce(service_role_execute, false)
    and coalesce(anon_execute_revoked, false)
    and coalesce(authenticated_execute_revoked, false)
    and coalesce(public_execute_revoked, false)
    and coalesce(both_use_account_lock, false)
    and coalesce(status_guard_is_shop_scoped, false)
    and coalesce(profile_update_guard_is_shop_scoped, false)
    then 'PASS' else 'FAIL' end,
  'routine_count', (select count(*) from routines),
  'both_security_definer', both_security_definer,
  'both_empty_search_path', both_empty_search_path,
  'service_role_execute', service_role_execute,
  'anon_execute_revoked', anon_execute_revoked,
  'authenticated_execute_revoked', authenticated_execute_revoked,
  'public_execute_revoked', public_execute_revoked,
  'both_use_account_lock', both_use_account_lock,
  'status_guard_is_shop_scoped', status_guard_is_shop_scoped,
  'profile_update_guard_is_shop_scoped', profile_update_guard_is_shop_scoped
) as s6_manage_users_transactional_admin_guard_final_check
from checks;
