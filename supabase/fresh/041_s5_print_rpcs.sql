-- 041: tenant-scope all existing print-request RPCs. No receipt payload shape or ACL is broadened.
-- Included by 051/052; do not run this source fragment by itself.
DO $preflight$ DECLARE s text; o oid; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Owner role with RLS bypass required'; END IF;
 IF to_regprocedure('tenant_private.current_shop_id()') IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['public.request_print(text,text,jsonb)','public.decide_print_request(uuid,text,text)','public.pending_print_count()','public.mark_printed_request(uuid)','public.list_print_requests()','public.modify_print_request(uuid,jsonb,bigint)']) AS expected(signature) WHERE to_regprocedure(expected.signature) IS NULL) THEN RAISE EXCEPTION 'Print RPC or tenant helper missing; stop'; END IF;
 IF (SELECT count(*) FROM public.print_requests)<>4 OR (SELECT count(*) FROM public.print_requests WHERE status='pending')<>0 OR (SELECT count(DISTINCT shop_id) FROM public.print_requests)<>1 OR EXISTS(SELECT 1 FROM public.print_requests WHERE shop_id IS NULL) OR to_regclass('public.print_requests_one_pending_per_receipt') IS NULL THEN RAISE EXCEPTION 'Print request facts/index changed from reviewed 050B; rerun preflight'; END IF;
 FOREACH s IN ARRAY ARRAY['public.request_print(text,text,jsonb)','public.decide_print_request(uuid,text,text)','public.pending_print_count()','public.mark_printed_request(uuid)','public.list_print_requests()','public.modify_print_request(uuid,jsonb,bigint)'] LOOP
  o:=to_regprocedure(s);
  IF o IS NULL OR NOT (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public']::text[]
       AND has_function_privilege('authenticated',p.oid,'EXECUTE')
       AND has_function_privilege('service_role',p.oid,'EXECUTE')
       AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
       AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
       FROM pg_catalog.pg_proc p WHERE p.oid=o) THEN
   RAISE EXCEPTION 'Print RPC % differs from reviewed signature/security/grants.',s;
  END IF;
 END LOOP;
 IF position('(to_jsonb(v_request) - ''shop_id'')' IN
      lower(pg_catalog.pg_get_functiondef(to_regprocedure('public.request_print(text,text,jsonb)')))) = 0 THEN
  RAISE EXCEPTION 'request_print does not contain the reviewed S3 shop_id response redaction.';
 END IF;
END; $preflight$;
DO $index_preflight$
BEGIN
 IF NOT EXISTS (
   SELECT 1
   FROM pg_catalog.pg_index index_info
   WHERE index_info.indexrelid = to_regclass('public.print_requests_one_pending_per_receipt')
     AND index_info.indrelid = 'public.print_requests'::regclass
     AND index_info.indisunique
     AND index_info.indisvalid
     AND pg_catalog.pg_get_indexdef(index_info.indexrelid) ILIKE '%(type, receipt_ref)%'
     AND pg_catalog.pg_get_expr(index_info.indpred, index_info.indrelid) ILIKE '%status = ''pending''%'
 ) THEN
   RAISE EXCEPTION 'The reviewed pending print-request index definition changed; rerun 050B.';
 END IF;
END;
$index_preflight$;
DROP INDEX IF EXISTS public.print_requests_one_pending_per_receipt;
CREATE UNIQUE INDEX print_requests_one_pending_per_shop_receipt
  ON public.print_requests (shop_id,type,receipt_ref) WHERE status='pending';
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
  v_shop_id uuid := tenant_private.current_shop_id();
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
  IF v_shop_id IS NULL OR v_profile.shop_id IS DISTINCT FROM v_shop_id OR v_profile.role='super_admin' THEN RAISE EXCEPTION 'An active shop user is required.'; END IF;

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
    and shop_id = v_shop_id
  for update;

  if found then
    v_reused := true;
  else
    insert into public.print_requests (shop_id, type, receipt_ref, payload, requested_by)
    values (v_shop_id, p_type, btrim(p_receipt_ref), p_payload, v_actor)
    on conflict (shop_id, type, receipt_ref) where status = 'pending' do nothing
    returning * into v_request;

    if not found then
      select * into v_request
      from public.print_requests
      where type = p_type
        and receipt_ref = btrim(p_receipt_ref)
        and status = 'pending'
        and shop_id = v_shop_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Receipt reference is already used by another shop.'; END IF;
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
  return to_jsonb(v_request) - 'shop_id';
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
  v_shop_id uuid := tenant_private.current_shop_id();
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
  IF v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'The decision note cannot exceed 1000 characters.';
  end if;

  select * into v_request
  from public.print_requests
  where id = p_request_id and shop_id = v_shop_id
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
  where id = p_request_id and shop_id = v_shop_id
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
  v_shop_id uuid := tenant_private.current_shop_id();
  v_count bigint;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active = true and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;
  IF v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;


  select count(*) into v_count
  from public.print_requests
  where status = 'pending' and shop_id = v_shop_id;

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
  v_shop_id uuid := tenant_private.current_shop_id();
  v_request public.print_requests%rowtype;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active = true and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;
  IF v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;


  update public.print_requests
  set printed_at = coalesce(printed_at, now())
  where id = p_request_id
    and shop_id = v_shop_id
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

create or replace function public.list_print_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_requests jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles
    where id = v_actor and is_active = true and deleted_at is null
  ) or not public.is_admin() then
    raise exception 'An active admin or super_admin profile is required.';
  end if;
  IF v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;


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
    where shop_id = v_shop_id
    order by requested_at desc
    limit 200
  ) request
  left join public.profiles profile on profile.id = request.requested_by
    and profile.shop_id = v_shop_id;

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
  v_shop_id uuid := tenant_private.current_shop_id();
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
  IF v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'A modified receipt must contain between 1 and 100 items.';
  end if;
  if p_discount_paisa is null or p_discount_paisa < 0 then
    raise exception 'Discount must be a non-negative amount in paisa.';
  end if;

  select * into v_request
  from public.print_requests
  where id = p_request_id and shop_id = v_shop_id
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
  where id = p_request_id and shop_id = v_shop_id
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
