-- Owner-run repair for the stale permission allowlist in package 064.
begin;

do $preflight$
declare
  v_definition text;
  v_pattern text := $pattern$'manage_users'\s*,\s*'settings'\s*,\s*'pos_print_sale'\s*,\s*'pos_print_payment'$pattern$;
  v_new_keys text[] := array[
    'settings_shop_profile',
    'settings_receipt_memo',
    'settings_receipt_qr',
    'settings_operations',
    'settings_demo_data',
    'settings_whatsapp_templates'
  ];
begin
  if to_regprocedure('public.manage_users_profile_update(uuid,uuid,text,text,text,text,text[],boolean,uuid)') is null
    or to_regclass('public.profiles') is null then
    raise exception 'The reviewed Manage Users schema or profile-update RPC is missing.';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.manage_users_profile_update(uuid,uuid,text,text,text,text,text[],boolean,uuid)'::regprocedure
  ) into v_definition;
  if not exists (
    select 1 from unnest(v_new_keys) as setting_key(key)
    where position(setting_key.key in v_definition) = 0
  ) then
    raise exception 'All Settings permission keys already appear in the RPC; inspect the function instead of applying this repair.';
  end if;
  if v_definition !~ $pattern$'manage_users'\s*,\s*'settings'\s*,\s*'pos_print_sale'\s*,\s*'pos_print_payment'$pattern$ then
    raise exception 'The RPC permission allowlist differs from the reviewed old definition; stop and inspect it.';
  end if;
  if exists (
    select 1
    from unnest(v_new_keys) as setting_key(key)
    where not exists (
      select 1
      from pg_catalog.pg_constraint as permission_constraint
      where permission_constraint.conrelid = 'public.profiles'::regclass
        and permission_constraint.conname = 'profiles_permissions_valid'
        and pg_catalog.pg_get_constraintdef(permission_constraint.oid) like '%' || setting_key.key || '%'
    )
  ) then
    raise exception 'The profiles permission constraint does not allow every Settings section key; review the Settings-controls SQL package first.';
  end if;
end
$preflight$;

do $repair$
declare
  v_definition text;
  v_updated_definition text;
  v_pattern text := $pattern$'manage_users'\s*,\s*'settings'\s*,\s*'pos_print_sale'\s*,\s*'pos_print_payment'$pattern$;
  v_replacement text := $replacement$'manage_users', 'settings', 'settings_shop_profile', 'settings_receipt_memo', 'settings_receipt_qr', 'settings_operations', 'settings_demo_data', 'settings_whatsapp_templates', 'pos_print_sale', 'pos_print_payment'$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.manage_users_profile_update(uuid,uuid,text,text,text,text,text[],boolean,uuid)'::regprocedure
  ) into v_definition;
  v_updated_definition := regexp_replace(v_definition, v_pattern, v_replacement);
  if v_updated_definition = v_definition then
    raise exception 'The expected permission allowlist was not replaced.';
  end if;
  execute v_updated_definition;
end
$repair$;

commit;
