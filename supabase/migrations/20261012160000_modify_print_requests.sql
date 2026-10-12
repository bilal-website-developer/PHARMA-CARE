begin;

create or replace function public.list_print_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_requests jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active = true and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', request.id,
      'type', request.type,
      'receipt_ref', request.receipt_ref,
      'payload', request.payload,
      'requested_by', request.requested_by,
      'requester_name', coalesce(
        nullif(profile.username, ''),
        nullif(profile.full_name, ''),
        nullif(profile.email, ''),
        'Unknown user'
      ),
      'requested_at', request.requested_at,
      'status', request.status,
      'decided_by', request.decided_by,
      'decided_at', request.decided_at,
      'note', request.note,
      'printed_at', request.printed_at
    ) order by request.requested_at desc
  ), '[]'::jsonb)
  into v_requests
  from (
    select * from public.print_requests
    order by requested_at desc
    limit 200
  ) request
  left join public.profiles profile on profile.id = request.requested_by;

  return v_requests;
end;
$$;

create or replace function public.modify_print_request(
  p_request_id uuid,
  p_lines jsonb,
  p_discount_paisa bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.print_requests%rowtype;
  v_line jsonb;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_rounding_unit numeric := 0;
  v_rounding numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_previous_payload jsonb;
  v_updated_payload jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active = true and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'A modified receipt must contain between 1 and 100 items.';
  end if;
  if p_discount_paisa is null or p_discount_paisa < 0 then
    raise exception 'Discount must be a non-negative amount in paisa.';
  end if;

  select * into v_request
  from public.print_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Print request was not found.';
  end if;
  if v_request.status <> 'pending' or v_request.type <> 'sale'
    or v_request.payload->'data'->>'kind' <> 'SALE' then
    raise exception 'Only pending sale print requests can be modified.';
  end if;
  if v_request.requested_by = v_actor then
    raise exception 'You cannot modify your own print request.';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) is distinct from 'object'
      or (v_line - array['qty', 'name', 'ratePaisa', 'batch', 'expiry']::text[]) <> '{}'::jsonb
      or jsonb_typeof(v_line->'qty') is distinct from 'number'
      or jsonb_typeof(v_line->'name') is distinct from 'string'
      or jsonb_typeof(v_line->'ratePaisa') is distinct from 'number'
      or (v_line ? 'batch' and jsonb_typeof(v_line->'batch') is distinct from 'string')
      or (v_line ? 'expiry' and jsonb_typeof(v_line->'expiry') is distinct from 'string')
      or coalesce(length(btrim(v_line->>'name')), 0) = 0
      or (v_line->>'qty')::numeric <= 0
      or (v_line->>'qty')::numeric > 1000000
      or trunc((v_line->>'qty')::numeric) <> (v_line->>'qty')::numeric
      or (v_line->>'ratePaisa')::numeric < 0
      or (v_line->>'ratePaisa')::numeric > 9007199254740991
      or trunc((v_line->>'ratePaisa')::numeric) <> (v_line->>'ratePaisa')::numeric then
      raise exception 'Modified receipt contains an invalid item.';
    end if;
    v_gross := v_gross + round((v_line->>'qty')::numeric * (v_line->>'ratePaisa')::numeric);
    if v_gross > 9007199254740991 then
      raise exception 'Modified receipt total is too large.';
    end if;
  end loop;
  if p_discount_paisa > v_gross then
    raise exception 'Discount cannot exceed the items subtotal.';
  end if;
  if jsonb_typeof(v_request.payload->'data'->'salesTaxPaisa') = 'number' then
    v_tax := (v_request.payload->'data'->>'salesTaxPaisa')::numeric;
  end if;
  if jsonb_typeof(v_request.payload->'data'->'paidPaisa') = 'number' then
    v_paid := greatest(0, (v_request.payload->'data'->>'paidPaisa')::numeric);
  end if;
  if v_request.payload->'settings'->>'roundNet' in ('1', '5', '10') then
    v_rounding_unit := (v_request.payload->'settings'->>'roundNet')::numeric * 100;
  end if;

  v_total := v_gross - p_discount_paisa + v_tax;
  if v_total < 0 then
    raise exception 'Modified receipt total cannot be negative.';
  end if;
  if v_rounding_unit > 0 then
    v_rounding := floor(v_total / v_rounding_unit + 0.5) * v_rounding_unit - v_total;
  end if;
  v_total := v_total + v_rounding;

  v_updated_payload := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(v_request.payload, '{data,lines}', p_lines, false),
        '{data,discountPaisa}', to_jsonb(p_discount_paisa), false
      ),
      '{data,roundingPaisa}', to_jsonb(v_rounding), true
    ),
    '{data,changePaisa}', to_jsonb(greatest(0, v_paid - v_total)), true
  );
  v_updated_payload := jsonb_set(
    v_updated_payload,
    '{data,isCredit}',
    to_jsonb(v_paid < v_total),
    true
  );

  v_previous_payload := v_request.payload;
  update public.print_requests
  set payload = v_updated_payload
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    v_actor,
    'print_request_modified',
    'print_request',
    v_request.id,
    jsonb_build_object(
      'type', v_request.type,
      'receipt_ref', v_request.receipt_ref,
      'previous_lines', v_previous_payload->'data'->'lines',
      'updated_lines', p_lines,
      'previous_discount_paisa', v_previous_payload->'data'->'discountPaisa',
      'updated_discount_paisa', p_discount_paisa
    )
  );

  return jsonb_build_object('id', v_request.id, 'payload', v_updated_payload);
end;
$$;

revoke all on function public.list_print_requests() from public, anon, authenticated;
revoke all on function public.modify_print_request(uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.list_print_requests() to authenticated;
grant execute on function public.modify_print_request(uuid, jsonb, bigint) to authenticated;

commit;
