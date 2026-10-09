begin;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null,
  entity text not null,
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from public, anon, authenticated;
grant select on table public.audit_logs to authenticated;

create table public.print_requests (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('sale', 'payment')),
  receipt_ref text not null,
  payload jsonb not null check (
    octet_length(payload::text) <= 65536
  ),
  requested_by uuid not null default auth.uid() references auth.users(id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  note text,
  printed_at timestamptz
);

create unique index print_requests_one_pending_per_receipt
  on public.print_requests (type, receipt_ref)
  where status = 'pending';

alter table public.print_requests enable row level security;
revoke all on table public.print_requests from public, anon, authenticated;
grant select on table public.print_requests to authenticated;

create policy print_requests_read_own_or_admin
  on public.print_requests
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and is_active = true
        and deleted_at is null
    )
    and (requested_by = auth.uid() or public.is_admin())
  );

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'audit_logs_admin_select'
  ) then
    create policy audit_logs_admin_select
      on public.audit_logs
      for select
      to authenticated
      using (public.is_admin());
  end if;
end
$$;

create or replace function public.request_print(
  p_type text,
  p_receipt_ref text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_request public.print_requests%rowtype;
  v_permission text;
  v_reused boolean := false;
begin
  if v_actor is null then
    raise exception 'An authenticated user is required.';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_actor
    and is_active = true
    and deleted_at is null;
  if not found then
    raise exception 'An active profile is required.';
  end if;

  if p_type is null or p_type not in ('sale', 'payment') then
    raise exception 'Print request type must be sale or payment.';
  end if;
  if nullif(btrim(p_receipt_ref), '') is null then
    raise exception 'A receipt reference is required.';
  end if;
  if length(btrim(p_receipt_ref)) > 200 then
    raise exception 'Receipt reference cannot exceed 200 characters.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A receipt snapshot object is required.';
  end if;
  if octet_length(p_payload::text) > 65536 then
    raise exception 'Receipt snapshot exceeds the 64 KB limit.';
  end if;
  if coalesce(jsonb_typeof(p_payload->'data'), '') <> 'object'
    or coalesce(jsonb_typeof(p_payload->'settings'), '') <> 'object'
    or coalesce(jsonb_typeof(p_payload->'data'->'lines'), '') <> 'array'
    or coalesce(jsonb_typeof(p_payload->'settings'->'notes'), '') <> 'array' then
    raise exception 'Receipt snapshot has an invalid structure.';
  end if;
  if (p_payload - array['data', 'settings', 'format', 'template']::text[]) <> '{}'::jsonb
    or ((p_payload->'data') - array[
      'kind', 'memoNo', 'originalMemoNo', 'dateTime', 'customerName', 'lines',
      'discountPaisa', 'roundingPaisa', 'salesTaxPaisa', 'paidPaisa', 'isCredit',
      'changePaisa', 'paymentMode', 'isDuplicate', 'cashier', 'role', 'terminal',
      'amountReceivedPaisa', 'balanceAfterPaisa'
    ]::text[]) <> '{}'::jsonb
    or ((p_payload->'settings') - array[
      'storeName', 'address', 'phone', 'notes', 'terminalName', 'showBatchExpiry',
      'roundNet', 'printTax', 'duplicateLabel', 'numberDigits'
    ]::text[]) <> '{}'::jsonb then
    raise exception 'Receipt snapshot contains fields outside the approved receipt schema.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload->'data'->'lines') as receipt_line(line)
    where coalesce(jsonb_typeof(line), '') <> 'object'
      or (line - array['qty', 'name', 'ratePaisa', 'batch', 'expiry']::text[]) <> '{}'::jsonb
      or coalesce(jsonb_typeof(line->'qty'), '') <> 'number'
      or coalesce(jsonb_typeof(line->'name'), '') <> 'string'
      or coalesce(jsonb_typeof(line->'ratePaisa'), '') <> 'number'
      or (line ? 'batch' and jsonb_typeof(line->'batch') <> 'string')
      or (line ? 'expiry' and jsonb_typeof(line->'expiry') <> 'string')
      or (line->>'qty')::numeric < 0
      or (line->>'ratePaisa')::numeric < 0
  ) then
    raise exception 'Receipt snapshot contains an invalid line item.';
  end if;
  if jsonb_array_length(p_payload->'settings'->'notes') <> 3
    or exists (
      select 1
      from jsonb_array_elements(p_payload->'settings'->'notes') as receipt_note(note)
      where jsonb_typeof(note) <> 'string'
    ) then
    raise exception 'Receipt snapshot must contain exactly three text notes.';
  end if;
  if coalesce(jsonb_typeof(p_payload->'format'), '') <> 'string'
    or p_payload->>'format' not in ('thermal58', 'thermal80', 'a4')
    or coalesce(jsonb_typeof(p_payload->'template'), '') <> 'string'
    or p_payload->>'template' not in ('simple', 'classic', 'professional', 'modern', 'pharmacy-memo')
    or coalesce(jsonb_typeof(p_payload->'data'->'memoNo'), '') <> 'string'
    or coalesce(jsonb_typeof(p_payload->'data'->'dateTime'), '') <> 'string'
    or coalesce(jsonb_typeof(p_payload->'data'->'discountPaisa'), '') <> 'number'
    or coalesce(jsonb_typeof(p_payload->'data'->'cashier'), '') <> 'string'
    or coalesce(jsonb_typeof(p_payload->'data'->'role'), '') <> 'string'
    or coalesce(jsonb_typeof(p_payload->'data'->'terminal'), '') <> 'string'
    or coalesce(jsonb_typeof(p_payload->'settings'->'storeName'), '') <> 'string'
    or coalesce(jsonb_typeof(p_payload->'settings'->'address'), '') <> 'string'
    or coalesce(jsonb_typeof(p_payload->'settings'->'phone'), '') <> 'string'
    or coalesce(jsonb_typeof(p_payload->'settings'->'terminalName'), '') <> 'string'
    or coalesce(jsonb_typeof(p_payload->'settings'->'showBatchExpiry'), '') <> 'boolean'
    or coalesce(jsonb_typeof(p_payload->'settings'->'printTax'), '') <> 'boolean'
    or coalesce(jsonb_typeof(p_payload->'settings'->'duplicateLabel'), '') <> 'boolean'
    or coalesce(jsonb_typeof(p_payload->'settings'->'numberDigits'), '') <> 'number'
    or coalesce(jsonb_typeof(p_payload->'settings'->'roundNet'), '') <> 'string'
    or p_payload->'settings'->>'roundNet' not in ('none', '1', '5', '10') then
    raise exception 'Receipt snapshot has invalid required values.';
  end if;
  if p_payload->'data'->>'kind' is null
    or (p_type = 'payment' and p_payload->'data'->>'kind' <> 'PAYMENT')
    or (p_type = 'sale' and p_payload->'data'->>'kind' not in ('SALE', 'RETURN')) then
    raise exception 'Receipt type does not match the snapshot.';
  end if;
  if v_profile.role in ('admin', 'super_admin') then
    raise exception 'Administrators can print receipts directly.';
  end if;

  v_permission := case when p_type = 'sale' then 'pos_print_sale' else 'pos_print_payment' end;
  if p_type = 'sale'
    and not (coalesce(v_profile.permissions, '{}'::text[]) @> array['pos']::text[]) then
    raise exception 'POS Billing permission is required to request a sale receipt.';
  end if;
  if p_type = 'payment'
    and not (coalesce(v_profile.permissions, '{}'::text[]) && array['pos', 'customers']::text[]) then
    raise exception 'Customer or POS permission is required to request a payment receipt.';
  end if;
  if coalesce(v_profile.permissions, '{}'::text[]) @> array[v_permission]::text[] then
    raise exception 'You are permitted to print this receipt directly.';
  end if;

  select * into v_request
  from public.print_requests
  where type = p_type
    and receipt_ref = btrim(p_receipt_ref)
    and status = 'pending'
  for update;

  if found then
    v_reused := true;
  else
    insert into public.print_requests (type, receipt_ref, payload, requested_by)
    values (p_type, btrim(p_receipt_ref), p_payload, v_actor)
    on conflict (type, receipt_ref) where status = 'pending' do nothing
    returning * into v_request;

    if not found then
      select * into v_request
      from public.print_requests
      where type = p_type
        and receipt_ref = btrim(p_receipt_ref)
        and status = 'pending';
      v_reused := true;
    end if;
  end if;

  if v_reused and v_request.requested_by <> v_actor then
    insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values (
      v_actor,
      'print_request_duplicate_found',
      'print_request',
      v_request.id,
      jsonb_build_object('type', p_type, 'receipt_ref', btrim(p_receipt_ref))
    );
    return jsonb_build_object(
      'id', v_request.id,
      'type', v_request.type,
      'receipt_ref', v_request.receipt_ref,
      'status', v_request.status,
      'reused_by_other', true
    );
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    v_actor,
    'print_request_created',
    'print_request',
    v_request.id,
    jsonb_build_object('type', p_type, 'receipt_ref', btrim(p_receipt_ref), 'reused', v_reused)
  );
  return to_jsonb(v_request);
end;
$$;

create or replace function public.decide_print_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_request public.print_requests%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  if v_actor is null then
    raise exception 'An authenticated user is required.';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_actor
    and is_active = true
    and deleted_at is null;
  if not found or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'The decision note cannot exceed 1000 characters.';
  end if;

  select * into v_request
  from public.print_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Print request was not found.';
  end if;
  if v_request.requested_by = v_actor then
    raise exception 'You cannot decide your own print request.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only pending print requests can be decided.';
  end if;

  update public.print_requests
  set status = p_decision,
      decided_by = v_actor,
      decided_at = now(),
      note = v_note
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    v_actor,
    case when p_decision = 'approved' then 'print_request_approved' else 'print_request_rejected' end,
    'print_request',
    v_request.id,
    jsonb_build_object('type', v_request.type, 'receipt_ref', v_request.receipt_ref, 'note', v_note)
  );

  return jsonb_build_object(
    'id', v_request.id,
    'type', v_request.type,
    'receipt_ref', v_request.receipt_ref,
    'status', v_request.status,
    'note', v_request.note,
    'payload', case when p_decision = 'approved' then v_request.payload else null end
  );
end;
$$;

create or replace function public.pending_print_count()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count bigint;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active = true and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  select count(*) into v_count
  from public.print_requests
  where status = 'pending';

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    v_actor,
    'print_request_count_viewed',
    'print_requests',
    v_actor,
    jsonb_build_object('pending_count', v_count)
  );
  return v_count;
end;
$$;

create or replace function public.mark_printed_request(p_request_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.print_requests%rowtype;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active = true and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  update public.print_requests
  set printed_at = coalesce(printed_at, now())
  where id = p_request_id
    and status = 'approved'
  returning * into v_request;
  if not found then
    raise exception 'Only approved print requests can be marked as printed.';
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    v_actor,
    'print_dialog_completed',
    'print_request',
    v_request.id,
    jsonb_build_object('type', v_request.type, 'receipt_ref', v_request.receipt_ref)
  );
  return v_request.printed_at;
end;
$$;

revoke all on function public.request_print(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.decide_print_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.pending_print_count() from public, anon, authenticated;
revoke all on function public.mark_printed_request(uuid) from public, anon, authenticated;
grant execute on function public.request_print(text, text, jsonb) to authenticated;
grant execute on function public.decide_print_request(uuid, text, text) to authenticated;
grant execute on function public.pending_print_count() to authenticated;
grant execute on function public.mark_printed_request(uuid) to authenticated;

commit;
