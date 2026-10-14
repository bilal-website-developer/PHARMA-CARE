begin;

alter default privileges for role supabase_admin
  grant execute on functions to public;

alter default privileges for role supabase_admin in schema public
  grant execute on functions to anon;

commit;
