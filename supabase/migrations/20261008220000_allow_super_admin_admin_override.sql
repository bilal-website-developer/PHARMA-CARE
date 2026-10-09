begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and deleted_at is null
      and role in ('admin', 'super_admin')
  );
$function$;

create or replace function public.has_any_permission(perms text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.deleted_at is null
      and (p.role in ('admin', 'super_admin') or p.permissions && perms)
  );
$function$;

commit;
