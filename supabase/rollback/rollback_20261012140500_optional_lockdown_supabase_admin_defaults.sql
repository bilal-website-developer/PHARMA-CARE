begin;

alter default privileges for role supabase_admin in schema public
  grant all on tables to anon, authenticated;
alter default privileges for role supabase_admin in schema public
  grant all on sequences to anon;

commit;
