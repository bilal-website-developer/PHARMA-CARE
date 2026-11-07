-- Track A / A2 (optional)
-- Optional because it only affects future objects created by the role connected in the SQL Editor.
-- Run SELECT current_user, session_user; first to confirm the active role before executing.
-- Replace postgres below with the role you actually use in the SQL Editor.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;

-- Keep explicit authenticated grants for future functions as appropriate.
-- If the connected role in your SQL Editor is not postgres, repeat the ALTER DEFAULT PRIVILEGES block above
-- for that exact role instead.

-- Risk in plain words:
-- This is only for future objects created by the connected role in the SQL Editor.
-- If that role is a project admin, the new default is applied to anything that role creates later.
-- It does not repair the current public functions already exposed; A1 must still be run.
