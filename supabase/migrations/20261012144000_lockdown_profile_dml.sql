begin;

revoke all privileges on table public.profiles from anon;
revoke insert, update, delete, truncate on table public.profiles from authenticated;

commit;
