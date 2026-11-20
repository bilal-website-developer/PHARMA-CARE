-- Read-only metadata smoke test; execute as the database owner after applying the repair.
do $test$
declare
  v_definition text;
  v_function regprocedure := to_regprocedure(
    'public.manage_users_profile_update(uuid,uuid,text,text,text,text,text[],boolean,uuid)'
  );
  v_required_keys text[] := array[
    'settings_shop_profile',
    'settings_receipt_memo',
    'settings_receipt_qr',
    'settings_operations',
    'settings_demo_data',
    'settings_whatsapp_templates'
  ];
begin
  if v_function is null then
    raise exception 'FAIL: Manage Users profile-update RPC is missing.';
  end if;
  select pg_catalog.pg_get_functiondef(v_function) into v_definition;
  if exists (
    select 1 from unnest(v_required_keys) as required_key(key)
    where position(required_key.key in v_definition) = 0
  ) then
    raise exception 'FAIL: one or more Settings permission keys are missing from the RPC allowlist.';
  end if;
  if position('Service-role access is required.' in v_definition) = 0
    or position('An active Admin or platform Super Admin is required.' in v_definition) = 0 then
    raise exception 'FAIL: the existing authorization guards changed.';
  end if;
  if not has_function_privilege('service_role', v_function, 'EXECUTE')
    or has_function_privilege('authenticated', v_function, 'EXECUTE')
    or has_function_privilege('anon', v_function, 'EXECUTE') then
    raise exception 'FAIL: the profile-update RPC grants changed.';
  end if;
  raise notice 'PASS: Settings section grants are accepted without changing the existing service-role authorization.';
end
$test$;
