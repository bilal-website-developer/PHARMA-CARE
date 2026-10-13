begin;

revoke all on function public.pos_catalog() from public, anon, authenticated;
drop function if exists public.pos_catalog();

commit;
