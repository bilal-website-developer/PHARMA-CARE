-- Track A / A2 (optional)
-- Optional because it only affects future objects created by the role connected in the SQL Editor.
-- Run SELECT current_user, session_user; first to confirm the active role before executing.
-- Replace postgres below with the role you actually use in the SQL Editor.
-- The PUBLIC function revoke is role-wide across schemas; review it before applying this optional step.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

-- Keep service_role defaults intact. Grant authenticated only on future API functions
-- that have been reviewed and are intended to be callable.
-- If the connected role in your SQL Editor is not postgres, repeat the ALTER DEFAULT PRIVILEGES block above
-- for that exact role instead.

-- Risk in plain words:
-- This is only for future objects created by the connected role in the SQL Editor.
-- If that role is a project admin, the new default is applied to anything that role creates later.
-- It does not repair the current public functions already exposed; A1 must still be run.
