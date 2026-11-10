begin;

-- Confirm this rollback matches the saved global and public defaults from
-- 002_default_privilege_preflight.sql before executing it.
do $$
begin
  if not pg_has_role(current_user, 'supabase_admin', 'MEMBER') then
    raise exception 'Current SQL role is not a member of supabase_admin; cannot restore its default privileges.';
  end if;
end;
$$;

alter default privileges for role supabase_admin in schema public
  grant all on tables to anon, authenticated;
alter default privileges for role supabase_admin in schema public
  grant execute on functions to anon, authenticated;
alter default privileges for role supabase_admin in schema public
  grant all on sequences to anon, authenticated;

commit;
