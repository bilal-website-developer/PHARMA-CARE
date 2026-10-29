select jsonb_build_object(
  'created_by_column_exists',
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'created_by'
    ),
  'created_by_is_nullable',
    coalesce((
      select not attnotnull
      from pg_attribute
      where attrelid = 'public.profiles'::regclass
        and attname = 'created_by'
        and not attisdropped
    ), false),
  'created_by_has_default',
    coalesce((
      select atthasdef
      from pg_attribute
      where attrelid = 'public.profiles'::regclass
        and attname = 'created_by'
        and not attisdropped
    ), false),
  'created_by_foreign_key_exists',
    exists (
      select 1
      from pg_constraint
      where conrelid = 'public.profiles'::regclass
        and conname = 'profiles_created_by_fkey'
        and contype = 'f'
    ),
  'created_by_index_exists',
    to_regclass('public.profiles_created_by_idx') is not null,
  'profile_read_policy_scoped',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'profiles'
        and policyname = 'profiles read own profile or assigned team'
        and qual like '%manage_users_current_active_profile_role%'
    ),
  'profile_role_helper_is_security_definer',
    exists (
      select 1
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'manage_users_current_active_profile_role'
        and procedure.prosecdef
    ),
  'access_rpc_is_security_definer',
    exists (
      select 1
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'manage_users_team_member_access'
        and procedure.prosecdef
    ),
  'access_rpc_is_service_role_only',
    has_function_privilege(
      'service_role',
      'public.manage_users_team_member_access(uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.manage_users_team_member_access(uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.manage_users_team_member_access(uuid,uuid,text)',
      'EXECUTE'
    ),
  'trash_bin_profile_events_are_team_scoped',
    exists (
      select 1
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'trash_bin_events_list'
        and procedure.prosecdef
        and procedure.prosrc like '%member.created_by%'
    ),
  'authenticated_profile_write_policy_count',
    (
      select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename = 'profiles'
        and cmd in ('INSERT', 'UPDATE', 'DELETE')
        and roles && array['authenticated', 'public']::name[]
    ),
  'authenticated_profile_select_policy_count',
    (
      select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename = 'profiles'
        and cmd = 'SELECT'
        and roles && array['authenticated', 'public']::name[]
    ),
  'attributed_profile_count',
    (select count(*) from public.profiles where created_by is not null),
  'unassigned_profile_count',
    (select count(*) from public.profiles where created_by is null)
) as manage_users_team_migration_check;
