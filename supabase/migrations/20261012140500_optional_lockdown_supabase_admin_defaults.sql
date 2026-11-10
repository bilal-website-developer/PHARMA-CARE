begin;

do $$
begin
  if not pg_has_role(current_user, 'supabase_admin', 'MEMBER') then
    raise exception 'Current SQL role is not a member of supabase_admin; do not apply this optional default-privilege change.';
  end if;
end;
$$;

alter default privileges for role supabase_admin in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role supabase_admin
  revoke execute on functions from public;
alter default privileges for role supabase_admin in schema public
  revoke all on functions from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all on sequences from public, anon, authenticated;

commit;
