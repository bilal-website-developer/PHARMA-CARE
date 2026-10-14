begin;

alter default privileges for role supabase_admin
  revoke execute on functions from public;

alter default privileges for role supabase_admin in schema public
  revoke execute on functions from anon;

commit;
