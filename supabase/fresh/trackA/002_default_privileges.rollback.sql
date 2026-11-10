-- Track A / A2 rollback
-- Do not run until the preflight output has been reviewed and this rollback matches that exact baseline.
-- The original public-schema Q6 output does not show global defaults and is not sufficient by itself.
-- Restore default privileges for future objects created by the same role used in the SQL Editor.
-- Replace postgres below with the role you used in the live run.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO authenticated, service_role;
