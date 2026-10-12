begin;

revoke insert, update, delete, truncate on table public.suppliers from authenticated;

commit;
