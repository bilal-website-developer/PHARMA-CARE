begin;

-- PostgreSQL's built-in function EXECUTE default for PUBLIC is global;
-- an IN SCHEMA revoke cannot override that global default.
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

commit;
