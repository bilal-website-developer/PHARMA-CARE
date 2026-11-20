-- Owner-run rollback. This restores the older allowlist and reintroduces the Settings edit failure.
begin;

do $rollback$
declare
  v_definition text;
  v_updated_definition text;
  v_pattern text := $pattern$'manage_users'\s*,\s*'settings'\s*,\s*'settings_shop_profile'\s*,\s*'settings_receipt_memo'\s*,\s*'settings_receipt_qr'\s*,\s*'settings_operations'\s*,\s*'settings_demo_data'\s*,\s*'settings_whatsapp_templates'\s*,\s*'pos_print_sale'\s*,\s*'pos_print_payment'$pattern$;
  v_replacement text := $replacement$'manage_users', 'settings', 'pos_print_sale', 'pos_print_payment'$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.manage_users_profile_update(uuid,uuid,text,text,text,text,text[],boolean,uuid)'::regprocedure
  ) into v_definition;
  v_updated_definition := regexp_replace(v_definition, v_pattern, v_replacement);
  if v_updated_definition = v_definition then
    raise exception 'The RPC does not match the Settings permission repair; inspect it before rollback.';
  end if;
  execute v_updated_definition;
end
$rollback$;

commit;
