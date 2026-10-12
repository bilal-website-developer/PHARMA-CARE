begin;

-- D runs after A, so anon profile privileges must remain revoked here.
-- Authenticated had SELECT only before D and retains SELECT; do not restore
-- INSERT, UPDATE, DELETE, or TRUNCATE. Profile writes use manage-users.
revoke all privileges on table public.profiles from anon;
revoke insert, update, delete, truncate on table public.profiles from authenticated;

commit;
