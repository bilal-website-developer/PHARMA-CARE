begin;

create table public.trash_bin_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  entity_type text not null check (entity_type in ('profile', 'medicine', 'supplier', 'purchase')),
  entity_id uuid not null,
  action text not null check (action in ('deleted', 'deactivated', 'voided', 'restored')),
  display_name text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index trash_bin_events_created_at_idx on public.trash_bin_events (created_at desc);
create index trash_bin_events_entity_idx on public.trash_bin_events (entity_type, entity_id, created_at desc);
alter table public.trash_bin_events enable row level security;
revoke all on table public.trash_bin_events from public, anon, authenticated;
grant insert on table public.trash_bin_events to service_role;

insert into public.trash_bin_events (
  actor_id, entity_type, entity_id, action, display_name, metadata, created_at
)
select
  audit.actor_id,
  'profile',
  profile.id,
  'deleted',
  coalesce(nullif(profile.full_name, ''), nullif(profile.username, ''), nullif(profile.email, ''), 'Unknown user'),
  jsonb_build_object('role', profile.role),
  audit.created_at
from public.profiles profile
cross join lateral (
  select log.actor_id, log.action, log.created_at
  from public.audit_logs log
  where log.entity = 'profile'
    and log.entity_id = profile.id
    and log.action in ('delete', 'restore')
  order by log.created_at desc, log.id desc
  limit 1
) audit
where profile.deleted_at is not null
  and audit.action = 'delete';

with product_status_events as (
  select
    log.actor_id,
    log.action,
    log.created_at,
    selected.id::uuid as entity_id,
    row_number() over (
      partition by selected.id
      order by log.created_at desc, log.id desc
    ) as event_rank
  from public.audit_logs log
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(log.details->'ids') = 'array' then log.details->'ids'
      else '[]'::jsonb
    end
  ) as selected(id)
  where log.entity = 'medicines'
    and log.action in ('products_bulk_deactivate', 'products_bulk_activate')
)
insert into public.trash_bin_events (
  actor_id, entity_type, entity_id, action, display_name, created_at
)
select
  status_event.actor_id,
  'medicine',
  medicine.id,
  'deactivated',
  concat_ws(' ', nullif(medicine.brand_name, ''), nullif(medicine.generic_name, '')),
  status_event.created_at
from product_status_events status_event
join public.medicines medicine on medicine.id = status_event.entity_id
where status_event.event_rank = 1
  and status_event.action = 'products_bulk_deactivate'
  and medicine.is_active = false;

insert into public.trash_bin_events (
  actor_id, entity_type, entity_id, action, display_name, created_at
)
select
  latest.actor_id,
  'supplier',
  supplier.id,
  'deactivated',
  supplier.name,
  latest.created_at
from public.suppliers supplier
cross join lateral (
  select log.actor_id, log.created_at
  from public.audit_logs log
  where log.entity = 'suppliers'
    and log.entity_id = supplier.id
    and log.action = 'supplier_deactivated'
  order by log.created_at desc, log.id desc
  limit 1
) latest
where supplier.is_active = false;

insert into public.trash_bin_events (
  actor_id, entity_type, entity_id, action, display_name, reason, created_at
)
select
  movement.created_by,
  'purchase',
  purchase.id,
  'voided',
  purchase.pr_no,
  purchase.void_reason,
  movement.created_at
from public.purchases purchase
cross join lateral (
  select stock_movement.created_by, stock_movement.created_at
  from public.stock_movements stock_movement
  where stock_movement.reference_id = purchase.id
    and stock_movement.movement_type = 'RECEIPT'
    and stock_movement.reason like 'Void ' || purchase.pr_no || ':%'
  order by stock_movement.created_at desc, stock_movement.id desc
  limit 1
) movement
where purchase.status = 'void'
  and purchase.void_reason is not null;

create or replace function public.capture_trash_bin_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_table_name = 'medicines' then
    if old.is_active is true and new.is_active is false then
      insert into public.trash_bin_events (
        actor_id, entity_type, entity_id, action, display_name
      ) values (
        auth.uid(), 'medicine', new.id, 'deactivated',
        concat_ws(' ', nullif(new.brand_name, ''), nullif(new.generic_name, ''))
      );
    elsif old.is_active is false and new.is_active is true then
      insert into public.trash_bin_events (
        actor_id, entity_type, entity_id, action, display_name
      ) values (
        auth.uid(), 'medicine', new.id, 'restored',
        concat_ws(' ', nullif(new.brand_name, ''), nullif(new.generic_name, ''))
      );
    end if;
  elsif tg_table_name = 'suppliers' then
    if old.is_active is true and new.is_active is false then
      insert into public.trash_bin_events (
        actor_id, entity_type, entity_id, action, display_name
      ) values (auth.uid(), 'supplier', new.id, 'deactivated', new.name);
    elsif old.is_active is false and new.is_active is true then
      insert into public.trash_bin_events (
        actor_id, entity_type, entity_id, action, display_name
      ) values (auth.uid(), 'supplier', new.id, 'restored', new.name);
    end if;
  elsif tg_table_name = 'purchases' and old.status is distinct from new.status and new.status = 'void' then
    insert into public.trash_bin_events (
      actor_id, entity_type, entity_id, action, display_name, reason
    ) values (auth.uid(), 'purchase', new.id, 'voided', new.pr_no, new.void_reason);
  end if;

  return new;
end;
$function$;

create trigger medicines_trash_bin_event
  after update of is_active on public.medicines
  for each row execute function public.capture_trash_bin_event();
create trigger suppliers_trash_bin_event
  after update of is_active on public.suppliers
  for each row execute function public.capture_trash_bin_event();
create trigger purchases_trash_bin_event
  after update of status on public.purchases
  for each row execute function public.capture_trash_bin_event();

create or replace function public.trash_bin_events_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_events jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active and deleted_at is null
  ) or not public.is_admin() then
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
              where p.id = event.entity_id and p.deleted_at is not null
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'medicine'
            then exists (
              select 1 from public.medicines m
              where m.id = event.entity_id and m.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          when event.action = 'deactivated' and event.entity_type = 'supplier'
            then exists (
              select 1 from public.suppliers s
              where s.id = event.entity_id and s.is_active = false
            ) and not exists (
              select 1 from public.trash_bin_events later
              where later.entity_type = event.entity_type
                and later.entity_id = event.entity_id
                and (later.created_at, later.id) > (event.created_at, event.id)
            )
          else false
        end
      ) as value
    from public.trash_bin_events event
    left join public.profiles actor on actor.id = event.actor_id
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
  v_supplier_id uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  update public.suppliers
  set is_active = true
  where id = p_supplier_id and is_active = false
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
  v_medicine_id uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  update public.medicines
  set is_active = true
  where id = p_medicine_id and is_active = false
  returning id into v_medicine_id;
  if not found then raise exception 'Inactive product not found.'; end if;
  return v_medicine_id;
end;
$function$;

revoke all on function public.capture_trash_bin_event() from public, anon, authenticated;
revoke all on function public.trash_bin_events_list() from public, anon, authenticated;
revoke all on function public.restore_trash_supplier(uuid) from public, anon, authenticated;
revoke all on function public.restore_trash_medicine(uuid) from public, anon, authenticated;
grant execute on function public.trash_bin_events_list() to authenticated;
grant execute on function public.restore_trash_supplier(uuid) to authenticated;
grant execute on function public.restore_trash_medicine(uuid) to authenticated;

commit;
