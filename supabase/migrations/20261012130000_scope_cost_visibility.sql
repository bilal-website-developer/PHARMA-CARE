begin;

create or replace function public.can_view_cost()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active = true
      and deleted_at is null
      and (
        role in ('admin', 'super_admin')
        or (
          role = 'manager'
          and permissions && array[
            'products', 'stock_inventory', 'purchases', 'purchase_history'
          ]::text[]
        )
        or (
          role = 'accountant'
          and permissions && array['purchase_history', 'reports']::text[]
        )
      )
  );
$function$;

revoke execute on function public.can_view_cost()
  from public, anon, authenticated;

commit;
