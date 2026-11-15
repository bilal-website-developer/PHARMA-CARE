-- 042: shop-scope Trash Bin routines; keep service-only profile purge unchanged.
-- Included by 051/052; do not run this source fragment by itself.
DO $preflight$ DECLARE s text; o oid; BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Owner role with RLS bypass required'; END IF; IF to_regprocedure('tenant_private.current_shop_id()') IS NULL OR (SELECT count(*) FROM public.trash_bin_events)<>56 OR (SELECT count(DISTINCT shop_id) FROM public.trash_bin_events)<>1 OR EXISTS(SELECT 1 FROM public.trash_bin_events WHERE shop_id IS NULL) THEN RAISE EXCEPTION 'Trash facts differ from reviewed preflight'; END IF; IF to_regprocedure('public.restore_trash_medicine(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'restore_trash_medicine unexpectedly exists; inspect before repair'; END IF; IF to_regprocedure('public.trash_bin_finalize_profile_purge(uuid,uuid,uuid)') IS NULL OR NOT has_function_privilege('service_role',to_regprocedure('public.trash_bin_finalize_profile_purge(uuid,uuid,uuid)'),'EXECUTE') OR has_function_privilege('authenticated',to_regprocedure('public.trash_bin_finalize_profile_purge(uuid,uuid,uuid)'),'EXECUTE') THEN RAISE EXCEPTION 'Profile purge service-only ACL changed'; END IF;
 FOREACH s IN ARRAY ARRAY['public.trash_bin_events_list()','public.restore_trash_supplier(uuid)','public.trash_bin_permanently_delete(uuid)'] LOOP
  o:=to_regprocedure(s);
  IF o IS NULL OR NOT (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public']::text[]
       AND has_function_privilege('authenticated',p.oid,'EXECUTE')
       AND has_function_privilege('service_role',p.oid,'EXECUTE')
       AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
       AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
       FROM pg_catalog.pg_proc p WHERE p.oid=o) THEN RAISE EXCEPTION 'Trash RPC % differs from reviewed security/grants.',s; END IF;
 END LOOP;
 END; $preflight$;
create or replace function public.capture_trash_bin_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
 v_shop_id uuid := tenant_private.current_shop_id();
begin
  if v_shop_id is null then
    raise exception 'An active shop user is required';
  end if;
  if tg_table_name = 'medicines' then
    if old.is_active is true and new.is_active is false then
      insert into public.trash_bin_events (
        actor_id, shop_id, entity_type, entity_id, action, display_name
      ) values (
        auth.uid(), v_shop_id, 'medicine', new.id, 'deactivated',
        concat_ws(' ', nullif(new.brand_name, ''), nullif(new.generic_name, ''))
      );
    elsif old.is_active is false and new.is_active is true then
      insert into public.trash_bin_events (
        actor_id, shop_id, entity_type, entity_id, action, display_name
      ) values (
        auth.uid(), v_shop_id, 'medicine', new.id, 'restored',
        concat_ws(' ', nullif(new.brand_name, ''), nullif(new.generic_name, ''))
      );
    end if;
  elsif tg_table_name = 'suppliers' then
    if old.is_active is true and new.is_active is false then
      insert into public.trash_bin_events (
        actor_id, shop_id, entity_type, entity_id, action, display_name
      ) values (auth.uid(), v_shop_id, 'supplier', new.id, 'deactivated', new.name);
    elsif old.is_active is false and new.is_active is true then
      insert into public.trash_bin_events (
        actor_id, shop_id, entity_type, entity_id, action, display_name
      ) values (auth.uid(), v_shop_id, 'supplier', new.id, 'restored', new.name);
    end if;
  elsif tg_table_name = 'purchases' and old.status is distinct from new.status and new.status = 'void' then
    insert into public.trash_bin_events (
      actor_id, shop_id, entity_type, entity_id, action, display_name, reason
    ) values (auth.uid(), v_shop_id, 'purchase', new.id, 'voided', new.pr_no, new.void_reason);
  end if;

  return new;
end;
$function$;

create or replace function public.trash_bin_events_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_actor_role text;
  v_events jsonb;
begin
  select role into v_actor_role
  from public.profiles
  where id = v_actor and shop_id=v_shop_id and role<>'super_admin' and is_active and deleted_at is null;

  if v_actor is null or v_shop_id is null or coalesce(v_actor_role, '') not in ('admin', 'super_admin') or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  select coalesce(jsonb_agg(event_row.value order by event_row.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select
      event.created_at,
      jsonb_build_object(
        'id', event.id,
        'actor_id', event.actor_id,
        'actor_name', coalesce(
          nullif(actor.username, ''),
          nullif(actor.full_name, ''),
          nullif(actor.email, ''),
          'Unknown user'
        ),
        'entity_type', event.entity_type,
        'entity_id', event.entity_id,
        'entity_role', event.metadata->>'role',
        'action', event.action,
        'display_name', event.display_name,
        'reason', event.reason,
        'created_at', event.created_at,
        'can_restore', case
          when event.action = 'deleted' and event.entity_type = 'profile'
            then exists (
              select 1 from public.profiles p
              where p.id=event.entity_id and p.shop_id=v_shop_id and p.deleted_at is not null
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.shop_id=v_shop_id and later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'medicine'
            then exists (
              select 1 from public.medicines m
              where m.id=event.entity_id and m.shop_id=v_shop_id and m.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.shop_id=v_shop_id and later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'supplier'
            then exists (
              select 1 from public.suppliers s
              where s.id=event.entity_id and s.shop_id=v_shop_id and s.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.shop_id=v_shop_id and later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          else false
        end,
        'can_permanently_delete', case
          when event.action = 'deleted' and event.entity_type = 'profile'
            then (
              exists (
                select 1 from public.profiles p
                where p.id = event.entity_id
                 and p.shop_id = v_shop_id
                  and p.deleted_at is not null
                  and p.id <> v_actor
                  and (
                    v_actor_role = 'super_admin'
                    or (
                      v_actor_role = 'admin'
                      and p.created_by = v_actor
                      and p.role in ('cashier', 'manager', 'accountant')
                    )
                  )
              )
              or (
                v_actor_role = 'super_admin'
                and event.entity_id <> v_actor
                and not exists (select 1 from public.profiles p where p.id = event.entity_id)
                and not exists (select 1 from auth.users u where u.id = event.entity_id)
              )
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.shop_id=v_shop_id and later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'medicine'
            then exists (
              select 1 from public.medicines m
              where m.id=event.entity_id and m.shop_id=v_shop_id and m.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.shop_id=v_shop_id and later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'supplier'
            then exists (
              select 1 from public.suppliers s
              where s.id=event.entity_id and s.shop_id=v_shop_id and s.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.shop_id=v_shop_id and later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          else false
        end
      ) as value
    from public.trash_bin_events event
    left join public.profiles actor on actor.id = event.actor_id
      and actor.shop_id = v_shop_id
    where event.shop_id=v_shop_id
    order by event.created_at desc
    limit 1000
  ) event_row;

  return v_events;
end;
$function$;

create or replace function public.restore_trash_supplier(p_supplier_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_supplier_id uuid;
begin
  if v_actor is null or v_shop_id is null or not exists (
    select 1 from public.profiles
    where id = v_actor and shop_id=v_shop_id and role<>'super_admin' and is_active and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  update public.suppliers
  set is_active = true
  where id=p_supplier_id and shop_id=v_shop_id and is_active=false
  returning id into v_supplier_id;
  if not found then raise exception 'Inactive supplier not found.'; end if;
  return v_supplier_id;
end;
$function$;

create or replace function public.restore_trash_medicine(p_medicine_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_medicine_id uuid;
begin
  if v_actor is null or v_shop_id is null or not exists (
    select 1 from public.profiles
    where id = v_actor and shop_id=v_shop_id and role<>'super_admin' and is_active and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  update public.medicines
  set is_active = true
  where id=p_medicine_id and shop_id=v_shop_id and is_active=false
  returning id into v_medicine_id;
  if not found then raise exception 'Inactive product not found.'; end if;
  return v_medicine_id;
end;
$function$;

create or replace function public.trash_bin_permanently_delete(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_event public.trash_bin_events%rowtype;
  v_actor_role text;
  v_entity_name text;
begin
  select role into v_actor_role
  from public.profiles
  where id = v_actor and shop_id=v_shop_id and role<>'super_admin' and is_active and deleted_at is null;

  if v_actor is null or v_shop_id is null or coalesce(v_actor_role, '') not in ('admin', 'super_admin') or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  select * into v_event
  from public.trash_bin_events
  where id=p_event_id and shop_id=v_shop_id
  for update;

  if not found or v_event.action <> 'deactivated'
    or v_event.entity_type not in ('medicine', 'supplier') then
    raise exception 'This Trash Bin item cannot be permanently deleted.';
  end if;

  if exists (
    select 1 from public.trash_bin_events later
    where later.shop_id=v_shop_id and later.entity_type=v_event.entity_type
      and later.entity_id = v_event.entity_id
      and (later.created_at, later.id) > (v_event.created_at, v_event.id)
  ) then
    raise exception 'This Trash Bin item is no longer the latest event and cannot be permanently deleted.';
  end if;

  if v_event.entity_type = 'medicine' then
    select concat_ws(' ', nullif(brand_name, ''), nullif(generic_name, ''))
      into v_entity_name
    from public.medicines
    where id=v_event.entity_id and shop_id=v_shop_id and is_active=false
    for update;
    if not found then raise exception 'Inactive product not found.'; end if;

    begin
      delete from public.medicines where id=v_event.entity_id and shop_id=v_shop_id and is_active=false;
    exception when foreign_key_violation then
      raise exception 'This product is still referenced by stock or transaction history and cannot be permanently deleted.';
    end;
  else
    select name into v_entity_name
    from public.suppliers
    where id=v_event.entity_id and shop_id=v_shop_id and is_active=false
    for update;
    if not found then raise exception 'Inactive supplier not found.'; end if;

    begin
      delete from public.suppliers where id=v_event.entity_id and shop_id=v_shop_id and is_active=false;
    exception when foreign_key_violation then
      raise exception 'This supplier is still referenced by purchase or stock history and cannot be permanently deleted.';
    end;
  end if;

  insert into public.audit_logs (actor_id, shop_id, action, entity, entity_id, details)
  values (
    v_actor,
    v_shop_id,
    'permanent_delete',
    v_event.entity_type,
    v_event.entity_id,
    jsonb_build_object(
      'trash_event_id', v_event.id,
      'display_name', coalesce(v_entity_name, v_event.display_name)
    )
  );

  delete from public.trash_bin_events
  where shop_id=v_shop_id and entity_type=v_event.entity_type and entity_id=v_event.entity_id;

  return jsonb_build_object('message', coalesce(v_entity_name, v_event.display_name) || ' permanently deleted.');
end;
$function$;
REVOKE ALL ON FUNCTION public.restore_trash_medicine(uuid) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.restore_trash_medicine(uuid) TO authenticated,service_role;
