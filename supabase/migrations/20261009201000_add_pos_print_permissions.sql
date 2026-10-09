begin;

alter table public.profiles
  drop constraint if exists profiles_permissions_valid;

alter table public.profiles
  add constraint profiles_permissions_valid
  check (
    permissions <@ array[
      'pos',
      'products',
      'categories',
      'suppliers',
      'customers',
      'sales_history',
      'purchase_history',
      'purchases',
      'expenses',
      'stock_inventory',
      'reports',
      'manage_users',
      'pos_print_sale',
      'pos_print_payment'
    ]::text[]
    and (
      not (permissions && array['pos_print_sale', 'pos_print_payment']::text[])
      or permissions @> array['pos']::text[]
    )
  );

update public.profiles as profile
set permissions = profile.permissions || array(
  select permission_key
  from unnest(array['pos_print_sale', 'pos_print_payment']::text[]) as permission_keys(permission_key)
  where not (profile.permissions @> array[permission_key]::text[])
)
where profile.role not in ('admin', 'super_admin')
  and profile.permissions @> array['pos']::text[]
  and not (
    profile.permissions @> array['pos_print_sale', 'pos_print_payment']::text[]
  );

commit;
