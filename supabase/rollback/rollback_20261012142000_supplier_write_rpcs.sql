begin;

drop function if exists public.deactivate_supplier(uuid);
drop function if exists public.save_supplier(uuid, text, text, text, text, text);

commit;
