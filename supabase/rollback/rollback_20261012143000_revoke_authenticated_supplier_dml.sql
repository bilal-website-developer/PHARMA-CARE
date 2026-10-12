begin;

grant insert, update, delete, truncate on table public.suppliers to authenticated;

commit;
