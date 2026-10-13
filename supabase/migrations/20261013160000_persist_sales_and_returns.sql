begin;

alter table public.sales
  add column if not exists rounding_paisa integer not null default 0,
  add column if not exists amount_tendered_paisa integer not null default 0,
  add column if not exists change_paisa integer not null default 0;

alter table public.sale_items
  add column if not exists line_discount_paisa integer not null default 0,
  add column if not exists line_adjustment_paisa integer not null default 0,
  add column if not exists unit_id uuid references public.medicine_units(id);

alter table public.stock_batches
  add column if not exists returned_quantity integer not null default 0;

alter table public.stock_batches
  drop constraint if exists stock_batches_check;

alter table public.stock_batches
  add constraint stock_batches_received_and_returned_check
  check (
    quantity_received >= 0
    and returned_quantity >= 0
    and quantity_remaining::bigint <= quantity_received::bigint + returned_quantity::bigint
  );

alter table public.customers
  add column if not exists store_credit_paisa integer not null default 0;

alter table public.customers
  drop constraint if exists customers_store_credit_paisa_check;

alter table public.customers
  add constraint customers_store_credit_paisa_check check (store_credit_paisa >= 0);

create table if not exists public.return_policy_settings (
  id integer primary key default 1 check (id = 1),
  return_window_days integer not null default 7 check (return_window_days between 0 and 365),
  minimum_restock_shelf_life_days integer not null default 90
    check (minimum_restock_shelf_life_days between 0 and 3650),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.return_policy_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'COMPLETED', 'REJECTED')),
  reason text not null,
  refund_method text check (refund_method in ('CASH', 'CREDIT')),
  refund_total_paisa integer not null default 0 check (refund_total_paisa >= 0),
  requested_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  decision_reason text
);

create table if not exists public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id),
  sale_item_batch_allocation_id uuid not null references public.sale_item_batch_allocations(id),
  batch_id uuid not null references public.stock_batches(id),
  quantity_base_units integer not null check (quantity_base_units > 0),
  disposition text check (disposition in ('RESTOCK', 'QUARANTINE', 'WRITE_OFF')),
  sealed_intact boolean not null default false,
  restock_unit_id uuid references public.medicine_units(id),
  refund_paisa integer not null default 0 check (refund_paisa >= 0),
  reason text not null default '',
  quarantine_batch_id uuid references public.stock_batches(id),
  created_at timestamptz not null default now()
);

create index if not exists sale_returns_sale_status_idx
  on public.sale_returns (sale_id, status, requested_at desc);

create index if not exists sale_return_items_sale_line_idx
  on public.sale_return_items (sale_item_id, return_id);

create index if not exists sale_return_items_allocation_idx
  on public.sale_return_items (sale_item_batch_allocation_id, return_id);

create or replace function public.pos_customers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.has_any_permission(array['pos']::text[]) then
    raise exception 'You do not have permission to use POS customers';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'phone', coalesce(c.phone, ''),
    'address', coalesce(c.address, ''),
    'creditLimitPaisa', c.credit_limit_paisa,
    'currentBalancePaisa', c.current_balance_paisa,
    'storeCreditPaisa', c.store_credit_paisa
  ) order by c.name, c.id), '[]'::jsonb)
  into v_result
  from public.customers c;

  return v_result;
end;
$function$;

create or replace function public.save_customer(
  p_name text,
  p_phone text default '',
  p_cnic text default null,
  p_address text default '',
  p_credit_limit_paisa integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_customer public.customers%rowtype;
begin
  if auth.uid() is null or not public.has_any_permission(array['customers']::text[]) then
    raise exception 'You do not have permission to manage customers';
  end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Customer name is required'; end if;
  if coalesce(p_credit_limit_paisa, 0) < 0 then raise exception 'Credit limit cannot be negative'; end if;

  insert into public.customers (name, phone, cnic, address, credit_limit_paisa)
  values (
    btrim(p_name),
    coalesce(btrim(p_phone), ''),
    nullif(btrim(p_cnic), ''),
    coalesce(btrim(p_address), ''),
    coalesce(p_credit_limit_paisa, 0)
  )
  returning * into v_customer;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(), 'CUSTOMER_CREATED', 'customer', v_customer.id,
    jsonb_build_object('name', v_customer.name)
  );

  return jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'phone', v_customer.phone,
    'address', v_customer.address,
    'creditLimitPaisa', v_customer.credit_limit_paisa,
    'currentBalancePaisa', v_customer.current_balance_paisa,
    'storeCreditPaisa', v_customer.store_credit_paisa
  );
end;
$function$;

create or replace function public.record_customer_payment(
  p_customer_id uuid,
  p_amount_paisa integer,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_customer public.customers%rowtype;
  v_reference text;
  v_balance integer;
begin
  if auth.uid() is null or not public.has_any_permission(array['customers']::text[]) then
    raise exception 'You do not have permission to record customer payments';
  end if;
  if p_amount_paisa is null or p_amount_paisa <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;
  if not found then raise exception 'Customer was not found'; end if;
  if p_amount_paisa > v_customer.current_balance_paisa then
    raise exception 'Payment cannot exceed the customer''s outstanding balance';
  end if;

  v_balance := v_customer.current_balance_paisa - p_amount_paisa;
  v_reference := 'RCP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  update public.customers
  set current_balance_paisa = v_balance
  where id = p_customer_id;

  insert into public.khata_entries (
    customer_id, entry_type, reference_number, description,
    debit_paisa, credit_paisa, created_by
  )
  values (
    p_customer_id, 'PAYMENT', v_reference, coalesce(nullif(btrim(p_note), ''), 'Customer payment'),
    0, p_amount_paisa, auth.uid()
  );

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(), 'CUSTOMER_PAYMENT_RECORDED', 'customer', p_customer_id,
    jsonb_build_object('amount_paisa', p_amount_paisa, 'reference', v_reference)
  );

  return jsonb_build_object(
    'referenceNo', v_reference,
    'dateTime', now(),
    'balanceAfterPaisa', v_balance,
    'storeCreditPaisa', v_customer.store_credit_paisa
  );
end;
$function$;

create or replace function public.customer_accounts_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.has_any_permission(array['customers']::text[]) then
    raise exception 'You do not have permission to view customer accounts';
  end if;

  select jsonb_build_object(
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'phone', coalesce(c.phone, ''),
        'cnic', c.cnic,
        'address', coalesce(c.address, ''),
        'creditLimitPaisa', c.credit_limit_paisa,
        'currentBalancePaisa', c.current_balance_paisa,
        'storeCreditPaisa', c.store_credit_paisa
      ) order by c.name, c.id)
      from public.customers c
    ), '[]'::jsonb),
    'ledgerEntries', coalesce((
      select jsonb_object_agg(grouped.customer_id::text, grouped.entries)
      from (
        select ke.customer_id,
          jsonb_agg(jsonb_build_object(
            'id', ke.id,
            'customerId', ke.customer_id,
            'date', ke.created_at::date,
            'type', ke.entry_type,
            'referenceNo', ke.reference_number,
            'description', ke.description,
            'debitPaisa', ke.debit_paisa,
            'creditPaisa', ke.credit_paisa,
            'runningBalancePaisa', ke.running_balance_paisa
          ) order by ke.created_at desc, ke.id desc) as entries
        from (
          select entry.*,
            sum(entry.debit_paisa - entry.credit_paisa) over (
              partition by entry.customer_id
              order by entry.created_at, entry.id
              rows between unbounded preceding and current row
            )::integer as running_balance_paisa
          from public.khata_entries entry
        ) ke
        group by ke.customer_id
      ) grouped
    ), '{}'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

create or replace function public.get_return_policy_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_settings public.return_policy_settings%rowtype;
begin
  if auth.uid() is null or not public.has_any_permission(array['pos']::text[]) then
    raise exception 'You do not have permission to view return settings';
  end if;
  select * into v_settings from public.return_policy_settings where id = 1;
  return jsonb_build_object(
    'returnWindowDays', v_settings.return_window_days,
    'minimumRestockShelfLifeDays', v_settings.minimum_restock_shelf_life_days
  );
end;
$function$;

create or replace function public.update_return_policy_settings(
  p_return_window_days integer,
  p_minimum_restock_shelf_life_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_settings public.return_policy_settings%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and deleted_at is null and role = 'admin'
  ) then
    raise exception 'Only an active Admin may update return settings';
  end if;
  if p_return_window_days is null or p_return_window_days not between 0 and 365
     or p_minimum_restock_shelf_life_days is null
     or p_minimum_restock_shelf_life_days not between 0 and 3650 then
    raise exception 'Return settings are outside the allowed range';
  end if;

  update public.return_policy_settings
  set return_window_days = p_return_window_days,
      minimum_restock_shelf_life_days = p_minimum_restock_shelf_life_days,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 1
  returning * into v_settings;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(), 'RETURN_POLICY_UPDATED', 'return_policy', gen_random_uuid(),
    jsonb_build_object(
      'return_window_days', v_settings.return_window_days,
      'minimum_restock_shelf_life_days', v_settings.minimum_restock_shelf_life_days
    )
  );

  return jsonb_build_object(
    'returnWindowDays', v_settings.return_window_days,
    'minimumRestockShelfLifeDays', v_settings.minimum_restock_shelf_life_days
  );
end;
$function$;

create or replace function public.post_sale(
  p_customer_id uuid,
  p_customer_name text,
  p_items jsonb,
  p_discount_paisa integer,
  p_rounding_paisa integer,
  p_tendered_paisa integer,
  p_payments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor public.profiles%rowtype;
  v_customer public.customers%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_invoice text;
  v_sale_time timestamptz := now();
  v_item jsonb;
  v_loop record;
  v_payment jsonb;
  v_batch record;
  v_medicine record;
  v_sale_item_id uuid;
  v_quantity integer;
  v_factor integer;
  v_base_quantity bigint;
  v_remaining bigint;
  v_take integer;
  v_line_gross bigint;
  v_subtotal bigint := 0;
  v_discount integer := coalesce(p_discount_paisa, 0);
  v_rounding integer := coalesce(p_rounding_paisa, 0);
  v_total bigint;
  v_max_discount_percent integer;
  v_max_discount_paisa integer;
  v_payment_sum bigint := 0;
  v_credit_amount bigint := 0;
  v_cash_amount bigint := 0;
  v_payment_method text;
  v_line_discount bigint;
  v_line_adjustment bigint;
  v_discount_allocated bigint := 0;
  v_adjustment_allocated bigint := 0;
  v_cost_total bigint;
  v_line_total bigint;
  v_item_count integer;
  v_index integer;
  v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and is_active and deleted_at is null;
  if auth.uid() is null or v_actor.id is null
     or not public.has_any_permission(array['pos']::text[]) then
    raise exception 'You do not have permission to post a sale';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'A sale must contain between 1 and 100 items';
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array'
     or jsonb_array_length(p_payments) = 0 or jsonb_array_length(p_payments) > 4 then
    raise exception 'Select a valid payment method';
  end if;
  if v_discount < 0 or abs(v_rounding) > 500 then
    raise exception 'Discount or rounding amount is invalid';
  end if;
  if coalesce(p_tendered_paisa, 0) < 0 then
    raise exception 'Tendered amount cannot be negative';
  end if;

  v_max_discount_percent := case v_actor.role
    when 'cashier' then 10
    when 'manager' then 15
    when 'admin' then 30
    when 'super_admin' then 30
    else 0
  end;
  if v_max_discount_percent = 0 and v_discount > 0 then
    raise exception 'This account cannot discount sales';
  end if;

  if p_customer_id is not null then
    select * into v_customer
    from public.customers
    where id = p_customer_id
    for update;
    if not found then raise exception 'Select a valid customer'; end if;
  elsif exists (
    select 1
    from jsonb_array_elements(p_payments) value
    where value->>'payment_method' = 'CREDIT'
  ) then
    raise exception 'Credit sales require a registered customer';
  end if;

  v_item_count := jsonb_array_length(p_items);
  for v_loop in
    select value, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_item := v_loop.value;
    v_index := v_loop.ordinality::integer;
    v_quantity := nullif(v_item->>'quantity_in_unit', '')::integer;
    if v_quantity is null or v_quantity <= 0 or v_quantity > 100000 then
      raise exception 'Sale quantity must be a positive whole number';
    end if;

    select medicine.id, medicine.brand_name, medicine.generic_name,
           medicine.drug_class, medicine.storage_condition,
           unit.id as unit_id, unit.name as unit_name,
           unit.conversion_factor, unit.price_paisa
    into v_medicine
    from public.medicines medicine
    join public.medicine_units unit on unit.medicine_id = medicine.id
    where medicine.id = nullif(v_item->>'medicine_id', '')::uuid
      and unit.id = nullif(v_item->>'unit_id', '')::uuid
      and medicine.is_active
    for share of medicine, unit;
    if not found then raise exception 'A selected medicine or sale unit is no longer available'; end if;

    v_factor := v_medicine.conversion_factor;
    v_base_quantity := v_quantity::bigint * v_factor;
    v_line_gross := v_quantity::bigint * v_medicine.price_paisa;
    if v_base_quantity > 2147483647 or v_line_gross > 2147483647 then
      raise exception 'Sale quantity or total exceeds the supported limit';
    end if;
    v_subtotal := v_subtotal + v_line_gross;
    if v_subtotal > 2147483647 then raise exception 'Sale total exceeds the supported limit'; end if;
  end loop;

  v_max_discount_paisa := least(20000, floor(v_subtotal * v_max_discount_percent / 100.0)::integer);
  if v_discount > v_subtotal or v_discount > v_max_discount_paisa then
    raise exception 'Discount exceeds the allowed limit';
  end if;
  v_total := v_subtotal - v_discount + v_rounding;
  if v_total < 0 or v_total > 2147483647 then raise exception 'Sale total is invalid'; end if;

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    v_payment_method := v_payment->>'payment_method';
    if v_payment_method not in ('CASH', 'CARD', 'EASYPAISA', 'JAZZCASH', 'CREDIT') then
      raise exception 'Payment method is invalid';
    end if;
    if coalesce(nullif(v_payment->>'amount_paisa', '')::integer, 0) <= 0 then
      raise exception 'Payment amounts must be greater than zero';
    end if;
    v_payment_sum := v_payment_sum + (v_payment->>'amount_paisa')::integer;
    if v_payment_method = 'CREDIT' then
      v_credit_amount := v_credit_amount + (v_payment->>'amount_paisa')::integer;
    end if;
  end loop;
  if v_payment_sum <> v_total then raise exception 'Payment amounts must equal the sale total'; end if;
  select coalesce(sum((value->>'amount_paisa')::integer), 0)
  into v_cash_amount
  from jsonb_array_elements(p_payments) value
  where value->>'payment_method' = 'CASH';
  if v_credit_amount > 0 and (
    v_credit_amount <> v_total or jsonb_array_length(p_payments) <> 1 or p_customer_id is null
  ) then
    raise exception 'Credit payment must be the only payment method and requires a registered customer';
  end if;
  if v_credit_amount > 0 and coalesce(p_tendered_paisa, 0) <> 0 then
    raise exception 'Credit sales cannot record cash tender';
  elsif v_cash_amount = v_total and jsonb_array_length(p_payments) = 1 then
    if coalesce(p_tendered_paisa, 0) < v_total then
      raise exception 'Cash tender cannot be less than the sale total';
    end if;
  elsif coalesce(p_tendered_paisa, 0) <> v_total then
    raise exception 'Online and split payments must record the exact sale total as tendered';
  end if;
  if (
    select count(distinct value->>'payment_method')
    from jsonb_array_elements(p_payments)
  ) <> jsonb_array_length(p_payments) then
    raise exception 'Each payment method may only appear once';
  end if;

  v_invoice := 'INV-' || replace(v_sale_id::text, '-', '');
  insert into public.sales (
    id, invoice_number, cashier_id, cashier_name, customer_id, customer_name,
    "timestamp", subtotal_paisa, discount_paisa, total_paisa, rounding_paisa,
    amount_tendered_paisa, change_paisa, status
  )
  values (
    v_sale_id, v_invoice, auth.uid(), coalesce(v_actor.full_name, 'Staff'),
    p_customer_id, case when p_customer_id is not null then v_customer.name
      else coalesce(nullif(btrim(p_customer_name), ''), 'Walk-in Customer') end,
    v_sale_time, v_subtotal::integer, v_discount, v_total::integer, v_rounding,
    coalesce(p_tendered_paisa, 0),
    case when v_cash_amount = v_total and jsonb_array_length(p_payments) = 1
      then greatest(coalesce(p_tendered_paisa, 0) - v_total::integer, 0)
      else 0 end,
    'COMPLETED'
  );

  v_discount_allocated := 0;
  v_adjustment_allocated := 0;
  for v_loop in
    select value, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_item := v_loop.value;
    v_index := v_loop.ordinality::integer;
    v_quantity := (v_item->>'quantity_in_unit')::integer;
    select medicine.id, medicine.brand_name, medicine.generic_name,
           medicine.drug_class, unit.id as unit_id, unit.name as unit_name,
           unit.conversion_factor, unit.price_paisa
    into v_medicine
    from public.medicines medicine
    join public.medicine_units unit on unit.medicine_id = medicine.id
    where medicine.id = (v_item->>'medicine_id')::uuid
      and unit.id = (v_item->>'unit_id')::uuid
      and medicine.is_active
    for share of medicine, unit;

    v_line_gross := v_quantity::bigint * v_medicine.price_paisa;
    if v_index = v_item_count then
      v_line_discount := v_discount - v_discount_allocated;
      v_line_adjustment := v_rounding - v_adjustment_allocated;
    else
      v_line_discount := floor(v_discount::numeric * v_line_gross / v_subtotal);
      v_line_adjustment := case when v_rounding < 0 then -1 else 1 end
        * floor(abs(v_rounding)::numeric * v_line_gross / v_subtotal);
      v_discount_allocated := v_discount_allocated + v_line_discount;
      v_adjustment_allocated := v_adjustment_allocated + v_line_adjustment;
    end if;

    v_line_total := v_line_gross - v_line_discount + v_line_adjustment;
    if v_line_total < 0 then raise exception 'Discount and rounding make an item total invalid'; end if;
    v_base_quantity := v_quantity::bigint * v_medicine.conversion_factor;
    v_cost_total := 0;
    v_remaining := v_base_quantity;

    insert into public.sale_items (
      sale_id, medicine_id, unit_id, product_name, generic_name, unit_name,
      conversion_factor, quantity_in_unit, quantity_base_units,
      price_paisa_per_unit, cost_paisa_per_base_unit, discount_percent,
      line_discount_paisa, line_adjustment_paisa, line_total_paisa
    )
    values (
      v_sale_id, v_medicine.id, v_medicine.unit_id, v_medicine.brand_name,
      coalesce(v_medicine.generic_name, ''),
      v_medicine.unit_name, v_medicine.conversion_factor, v_quantity,
      v_base_quantity::integer, v_medicine.price_paisa, 0,
      case when v_line_gross = 0 then 0 else round(v_line_discount * 100.0 / v_line_gross, 2) end,
      v_line_discount::integer, v_line_adjustment::integer, v_line_total::integer
    )
    returning id into v_sale_item_id;

    for v_batch in
      select stock.id, stock.batch_number, stock.expiry_date, stock.cost_paisa_per_base_unit,
             stock.quantity_remaining
      from public.stock_batches stock
      where stock.medicine_id = v_medicine.id
        and stock.quantity_remaining > 0
        and stock.expiry_date >= current_date
        and stock.status in ('ACTIVE', 'NEAR_EXPIRY')
      order by stock.expiry_date, stock.received_date, stock.id
      for update
    loop
      exit when v_remaining = 0;
      v_take := least(v_remaining, v_batch.quantity_remaining)::integer;
      update public.stock_batches
      set quantity_remaining = quantity_remaining - v_take,
          status = case when quantity_remaining - v_take = 0 then 'SOLD_OUT' else status end
      where id = v_batch.id;

      insert into public.sale_item_batch_allocations (
        sale_item_id, batch_id, quantity_base_units, cost_paisa_per_base_unit,
        batch_number, expiry_date
      )
      values (
        v_sale_item_id, v_batch.id, v_take, v_batch.cost_paisa_per_base_unit,
        v_batch.batch_number, v_batch.expiry_date
      );
      insert into public.stock_movements (
        batch_id, movement_type, quantity_delta, reference_id, reason, created_by
      )
      values (
        v_batch.id, 'SALE', -v_take, v_sale_id, 'POS sale ' || v_invoice, auth.uid()
      );

      v_cost_total := v_cost_total + v_take::bigint * v_batch.cost_paisa_per_base_unit;
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      raise exception 'Insufficient eligible stock for %', v_medicine.brand_name;
    end if;
    if v_line_total < v_cost_total then
      raise exception 'Discount is not allowed for one or more items';
    end if;
    update public.sale_items
    set cost_paisa_per_base_unit = case
      when quantity_base_units = 0 then 0
      else floor(v_cost_total::numeric / quantity_base_units)::integer
    end
    where id = v_sale_item_id;
  end loop;

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    insert into public.sale_payments (sale_id, payment_method, amount_paisa)
    values (v_sale_id, v_payment->>'payment_method', (v_payment->>'amount_paisa')::integer);
  end loop;

  if v_credit_amount > 0 then
    if v_customer.current_balance_paisa::bigint + v_credit_amount > 2147483647 then
      raise exception 'Customer balance exceeds the supported limit';
    end if;
    update public.customers
    set current_balance_paisa = current_balance_paisa + v_credit_amount::integer
    where id = p_customer_id;
    insert into public.khata_entries (
      customer_id, sale_id, entry_type, reference_number, description,
      debit_paisa, credit_paisa, created_by
    )
    values (
      p_customer_id, v_sale_id, 'INVOICE', v_invoice, 'POS credit sale',
      v_credit_amount::integer, 0, auth.uid()
    );
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(), 'SALE_POSTED', 'sale', v_sale_id,
    jsonb_build_object('invoice_number', v_invoice, 'total_paisa', v_total::integer)
  );

  select jsonb_build_object(
    'id', s.id,
    'invoiceNumber', s.invoice_number,
    'timestamp', s."timestamp",
    'cashierName', s.cashier_name,
    'customerId', s.customer_id,
    'customerName', s.customer_name,
    'customerPhone', coalesce(v_customer.phone, ''),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', si.medicine_id,
        'productName', si.product_name,
        'genericName', si.generic_name,
        'batchId', first_alloc.batch_id,
        'batchNumber', first_alloc.batch_number,
        'expiryDate', first_alloc.expiry_date,
        'drugClass', medicine.drug_class,
        'unitId', si.unit_id,
        'unitName', si.unit_name,
        'conversionFactor', si.conversion_factor,
        'quantityInUnit', si.quantity_in_unit,
        'mrpPaisaPerUnit', si.price_paisa_per_unit,
        'costPaisaPerUnit', null,
        'discountPercent', si.discount_percent,
        'lineTotalPaisa', si.line_total_paisa,
        'batchAllocations', (
          select jsonb_agg(jsonb_build_object(
            'batchId', allocation.batch_id,
            'batchNumber', allocation.batch_number,
            'expiryDate', allocation.expiry_date,
            'quantitySmallestUnit', allocation.quantity_base_units
          ) order by allocation.expiry_date, allocation.batch_id)
          from public.sale_item_batch_allocations allocation
          where allocation.sale_item_id = si.id
        )
      ) order by si.created_at, si.id)
      from public.sale_items si
      join public.medicines medicine on medicine.id = si.medicine_id
      left join lateral (
        select allocation.batch_id, allocation.batch_number, allocation.expiry_date
        from public.sale_item_batch_allocations allocation
        where allocation.sale_item_id = si.id
        order by allocation.expiry_date, allocation.batch_id
        limit 1
      ) first_alloc on true
      where si.sale_id = s.id
    ), '[]'::jsonb),
    'subtotalPaisa', s.subtotal_paisa,
    'discountPaisa', s.discount_paisa,
    'totalPaisa', s.total_paisa,
    'roundingPaisa', s.rounding_paisa,
    'paymentMethod', case
      when v_credit_amount > 0 then 'CREDIT'
      when (select count(*) from public.sale_payments payment where payment.sale_id = s.id) > 1 then 'SPLIT'
      else (select payment.payment_method from public.sale_payments payment where payment.sale_id = s.id limit 1)
    end,
    'amountTenderedPaisa', coalesce(p_tendered_paisa, 0),
    'changePaisa', greatest(coalesce(p_tendered_paisa, 0) - s.total_paisa, 0)
  )
  into v_result
  from public.sales s
  where s.id = v_sale_id;

  return v_result;
end;
$function$;

create or replace function public.sales_history(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if auth.uid() is null or not public.has_any_permission(array['sales_history']::text[]) then
    raise exception 'You do not have permission to view sales history';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', selected.id,
    'invoiceNumber', selected.invoice_number,
    'timestamp', selected."timestamp",
    'cashierName', selected.cashier_name,
    'customerId', selected.customer_id,
    'customerName', selected.customer_name,
    'customerPhone', coalesce(customer.phone, ''),
    'subtotalPaisa', selected.subtotal_paisa,
    'discountPaisa', selected.discount_paisa,
    'totalPaisa', selected.total_paisa,
    'roundingPaisa', selected.rounding_paisa,
    'amountTenderedPaisa', selected.amount_tendered_paisa,
    'changePaisa', selected.change_paisa,
    'paymentMethod', case
      when exists (
        select 1 from public.sale_payments payment
        where payment.sale_id = selected.id and payment.payment_method = 'CREDIT'
      ) then 'CREDIT'
      when (
        select count(*) from public.sale_payments payment where payment.sale_id = selected.id
      ) > 1 then 'SPLIT'
      else (
        select payment.payment_method from public.sale_payments payment
        where payment.sale_id = selected.id order by payment.created_at limit 1
      )
    end,
    'status', selected.status,
    'items', selected.items
  ) order by selected."timestamp" desc), '[]'::jsonb)
  into v_result
  from (
    select s.*,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'id', si.id,
        'medicineId', si.medicine_id,
        'unitId', si.unit_id,
        'productName', si.product_name,
        'genericName', si.generic_name,
        'unitName', si.unit_name,
        'conversionFactor', si.conversion_factor,
        'quantityInUnit', si.quantity_in_unit,
        'quantityBaseUnits', si.quantity_base_units,
        'pricePaisaPerUnit', si.price_paisa_per_unit,
        'drugClass', medicine.drug_class,
        'lineDiscountPaisa', si.line_discount_paisa,
        'lineTotalPaisa', si.line_total_paisa,
        'batchAllocations', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', allocation.id,
            'batchId', allocation.batch_id,
            'batchNumber', allocation.batch_number,
            'expiryDate', allocation.expiry_date,
            'quantityBaseUnits', allocation.quantity_base_units
          ) order by allocation.expiry_date, allocation.batch_id), '[]'::jsonb)
          from public.sale_item_batch_allocations allocation
          where allocation.sale_item_id = si.id
        )
      ) order by si.created_at, si.id), '[]'::jsonb)
       from public.sale_items si
       join public.medicines medicine on medicine.id = si.medicine_id
       where si.sale_id = s.id) as items
    from public.sales s
    order by s."timestamp" desc, s.id desc
    limit v_limit
  ) selected
  left join public.customers customer on customer.id = selected.customer_id;
  return v_result;
end;
$function$;

create or replace function public.sale_for_return(p_invoice_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sale_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null or not public.has_any_permission(array['pos']::text[]) then
    raise exception 'You do not have permission to request a sale return';
  end if;

  select s.id into v_sale_id
  from public.sales s
  where s.invoice_number = nullif(btrim(p_invoice_number), '')
    and s.status in ('COMPLETED', 'PARTIALLY_RETURNED')
  limit 1;
  if v_sale_id is null then raise exception 'Sale was not found or is not returnable'; end if;

  select jsonb_build_object(
    'id', s.id,
    'invoiceNumber', s.invoice_number,
    'saleDate', s."timestamp"::date,
    'customerId', s.customer_id,
    'customerName', s.customer_name,
    'totalPaisa', s.total_paisa,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleItemId', si.id,
        'medicineId', si.medicine_id,
        'productName', si.product_name,
        'genericName', si.generic_name,
        'unitName', si.unit_name,
        'conversionFactor', si.conversion_factor,
        'quantityInUnit', si.quantity_in_unit,
        'quantityBaseUnits', si.quantity_base_units,
        'lineTotalPaisa', si.line_total_paisa,
        'drugClass', medicine.drug_class,
        'storageCondition', medicine.storage_condition,
        'allocations', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'allocationId', allocation.id,
            'batchId', allocation.batch_id,
            'batchNumber', allocation.batch_number,
            'expiryDate', allocation.expiry_date,
            'quantityBaseUnits', allocation.quantity_base_units,
            'alreadyReturnedBaseUnits', coalesce((
              select sum(return_item.quantity_base_units)
              from public.sale_return_items return_item
              join public.sale_returns return_header on return_header.id = return_item.return_id
              where return_item.sale_item_batch_allocation_id = allocation.id
                and return_header.status in ('PENDING', 'COMPLETED')
            ), 0)
          ) order by allocation.expiry_date, allocation.batch_id), '[]'::jsonb)
          from public.sale_item_batch_allocations allocation
          where allocation.sale_item_id = si.id
        )
      ) order by si.created_at, si.id)
      from public.sale_items si
      join public.medicines medicine on medicine.id = si.medicine_id
      where si.sale_id = s.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.sales s
  where s.id = v_sale_id;
  return v_result;
end;
$function$;

create or replace function public.request_sale_return(
  p_sale_id uuid,
  p_reason text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_return_id uuid := gen_random_uuid();
  v_invoice text;
  v_item jsonb;
  v_sale_item_id uuid;
  v_allocation_id uuid;
  v_quantity integer;
  v_sold integer;
  v_already_returned bigint;
  v_requested_count integer;
begin
  if auth.uid() is null or not public.has_any_permission(array['pos']::text[]) then
    raise exception 'You do not have permission to request a sale return';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Return reason is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'Select at least one item to return';
  end if;

  select invoice_number into v_invoice
  from public.sales
  where id = p_sale_id and status in ('COMPLETED', 'PARTIALLY_RETURNED')
  for update;
  if not found then raise exception 'Sale was not found or is not returnable'; end if;

  v_requested_count := jsonb_array_length(p_items);
  if (
    select count(distinct value->>'allocation_id')
    from jsonb_array_elements(p_items)
  ) <> v_requested_count then
    raise exception 'A sale batch allocation may appear only once in a return request';
  end if;

  insert into public.sale_returns (id, sale_id, reason, requested_by)
  values (v_return_id, p_sale_id, btrim(p_reason), auth.uid());

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_sale_item_id := nullif(v_item->>'sale_item_id', '')::uuid;
    v_allocation_id := nullif(v_item->>'allocation_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity_base_units', '')::integer;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Return quantity must be positive'; end if;

    perform 1
    from public.sale_items si
    where si.id = v_sale_item_id and si.sale_id = p_sale_id
    for update;
    if not found then raise exception 'A returned item does not belong to this sale'; end if;

    select allocation.quantity_base_units into v_sold
    from public.sale_item_batch_allocations allocation
    where allocation.id = v_allocation_id
      and allocation.sale_item_id = v_sale_item_id
    for update;
    if not found then raise exception 'A returned batch does not belong to this sale item'; end if;

    select coalesce(sum(return_item.quantity_base_units), 0) into v_already_returned
    from public.sale_return_items return_item
    join public.sale_returns return_header on return_header.id = return_item.return_id
    where return_item.sale_item_batch_allocation_id = v_allocation_id
      and return_header.status in ('PENDING', 'COMPLETED');
    if v_already_returned + v_quantity > v_sold then
      raise exception 'Return quantity exceeds the quantity sold from this batch';
    end if;

    insert into public.sale_return_items (
      return_id, sale_item_id, sale_item_batch_allocation_id, batch_id,
      quantity_base_units, reason
    )
    select v_return_id, v_sale_item_id, allocation.id, allocation.batch_id,
      v_quantity, btrim(p_reason)
    from public.sale_item_batch_allocations allocation
    where allocation.id = v_allocation_id;
  end loop;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(), 'SALE_RETURN_REQUESTED', 'sale_return', v_return_id,
    jsonb_build_object('sale_id', p_sale_id, 'invoice_number', v_invoice, 'reason', btrim(p_reason))
  );

  return jsonb_build_object('id', v_return_id, 'status', 'PENDING', 'invoiceNumber', v_invoice);
end;
$function$;

create or replace function public.pending_sale_returns()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and deleted_at is null
      and (
        role = 'admin'
        or (role = 'manager' and permissions && array['sales_history']::text[])
      )
  ) then
    raise exception 'Only a Manager or Admin with Sales History access may review returns';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', return_header.id,
    'saleId', sale.id,
    'invoiceNumber', sale.invoice_number,
    'saleDate', sale."timestamp"::date,
    'customerName', sale.customer_name,
    'reason', return_header.reason,
    'requestedBy', coalesce(requester.full_name, 'Staff'),
    'requestedAt', return_header.requested_at,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', return_item.id,
        'saleItemId', return_item.sale_item_id,
        'medicineId', sale_item.medicine_id,
        'productName', sale_item.product_name,
        'unitName', sale_item.unit_name,
        'conversionFactor', sale_item.conversion_factor,
        'quantityBaseUnits', return_item.quantity_base_units,
        'batchId', return_item.batch_id,
        'batchNumber', allocation.batch_number,
        'expiryDate', allocation.expiry_date,
        'drugClass', medicine.drug_class,
        'storageCondition', medicine.storage_condition,
        'medicineUnits', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', unit.id,
            'name', unit.name,
            'conversionFactor', unit.conversion_factor
          ) order by unit.conversion_factor desc, unit.name), '[]'::jsonb)
          from public.medicine_units unit
          where unit.medicine_id = medicine.id
        )
      ) order by sale_item.product_name), '[]'::jsonb)
      from public.sale_return_items return_item
      join public.sale_items sale_item on sale_item.id = return_item.sale_item_id
      join public.medicines medicine on medicine.id = sale_item.medicine_id
      join public.sale_item_batch_allocations allocation
        on allocation.id = return_item.sale_item_batch_allocation_id
      where return_item.return_id = return_header.id
    )
  ) order by return_header.requested_at), '[]'::jsonb)
  into v_result
  from public.sale_returns return_header
  join public.sales sale on sale.id = return_header.sale_id
  left join public.profiles requester on requester.id = return_header.requested_by
  where return_header.status = 'PENDING';

  return v_result;
end;
$function$;

create or replace function public.reject_sale_return(
  p_return_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_return public.sale_returns%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and deleted_at is null
      and role in ('manager', 'admin')
      and permissions && array['sales_history']::text[]
  ) then
    raise exception 'Only a Manager or Admin with Sales History access may reject returns';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A rejection reason is required';
  end if;

  update public.sale_returns
  set status = 'REJECTED',
      approved_by = auth.uid(),
      processed_at = now(),
      decision_reason = btrim(p_reason)
  where id = p_return_id and status = 'PENDING'
  returning * into v_return;
  if not found then
    raise exception 'Return request is missing or has already been processed';
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(), 'SALE_RETURN_REJECTED', 'sale_return', p_return_id,
    jsonb_build_object(
      'sale_id', v_return.sale_id,
      'reason', v_return.decision_reason
    )
  );

  return jsonb_build_object('id', p_return_id, 'status', 'REJECTED');
end;
$function$;

create or replace function public.process_sale_return(
  p_return_id uuid,
  p_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor public.profiles%rowtype;
  v_return public.sale_returns%rowtype;
  v_sale public.sales%rowtype;
  v_item record;
  v_decision jsonb;
  v_disposition text;
  v_reason text;
  v_sealed boolean;
  v_restock_unit uuid;
  v_pack_factor integer;
  v_line record;
  v_prior_returned bigint;
  v_refund integer;
  v_total_refund bigint := 0;
  v_quarantine_batch uuid;
  v_medicine record;
  v_updated_customer public.customers%rowtype;
  v_pending_reserved bigint;
  v_request_reserved bigint;
  v_return_window integer;
  v_min_shelf integer;
  v_processed_count integer := 0;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and is_active and deleted_at is null;
  if auth.uid() is null or v_actor.id is null or v_actor.role not in ('manager', 'admin')
     or not public.has_any_permission(array['sales_history']::text[]) then
    raise exception 'Only a Manager or Admin with Sales History access may process returns';
  end if;

  select * into v_return from public.sale_returns where id = p_return_id for update;
  if not found or v_return.status <> 'PENDING' then
    raise exception 'Return request is missing or has already been processed';
  end if;
  select * into v_sale from public.sales where id = v_return.sale_id for update;

  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array'
     or jsonb_array_length(p_decisions) <> (
       select count(*) from public.sale_return_items where return_id = p_return_id
     ) then
    raise exception 'Every return item needs exactly one disposition';
  end if;
  if (
    select count(distinct value->>'id') from jsonb_array_elements(p_decisions)
  ) <> jsonb_array_length(p_decisions) then
    raise exception 'A return item may only be decided once';
  end if;

  select return_window_days, minimum_restock_shelf_life_days
  into v_return_window, v_min_shelf
  from public.return_policy_settings where id = 1;

  for v_decision in select value from jsonb_array_elements(p_decisions)
  loop
    v_disposition := v_decision->>'disposition';
    v_reason := coalesce(nullif(btrim(v_decision->>'reason'), ''), v_return.reason);
    v_sealed := coalesce((v_decision->>'sealedIntact')::boolean, false);
    v_restock_unit := nullif(v_decision->>'restockUnitId', '')::uuid;
    if v_disposition not in ('RESTOCK', 'QUARANTINE', 'WRITE_OFF') then
      raise exception 'Return disposition is invalid';
    end if;

    select return_item.*, sale_item.medicine_id, sale_item.conversion_factor,
           sale_item.quantity_base_units as sale_quantity_base_units,
           sale_item.line_total_paisa, sale_item.unit_name, sale_item.price_paisa_per_unit,
           allocation.quantity_base_units as allocation_sold_quantity,
           allocation.batch_number, allocation.expiry_date as allocation_expiry
    into v_item
    from public.sale_return_items return_item
    join public.sale_items sale_item on sale_item.id = return_item.sale_item_id
    join public.sale_item_batch_allocations allocation
      on allocation.id = return_item.sale_item_batch_allocation_id
    where return_item.id = nullif(v_decision->>'id', '')::uuid
      and return_item.return_id = p_return_id
    for update of return_item, sale_item, allocation;
    if not found then raise exception 'Return item was not found'; end if;

    select medicine.drug_class, medicine.storage_condition, medicine.brand_name
    into v_medicine
    from public.medicines medicine
    where medicine.id = v_item.medicine_id;

    if v_disposition = 'RESTOCK' then
      if not v_sealed then raise exception 'Restock requires a sealed, intact original pack'; end if;
      if v_medicine.drug_class in ('CONTROLLED', 'NARCOTIC')
         or v_medicine.storage_condition = 'COLD_REFRIGERATED' then
        raise exception 'This medicine cannot be restocked';
      end if;
      if v_sale."timestamp"::date < current_date - v_return_window then
        raise exception 'Return is outside the configured return window for restock';
      end if;
      if v_item.allocation_expiry < current_date + v_min_shelf then
        raise exception 'Medicine does not have enough remaining shelf life to be restocked';
      end if;
      if v_restock_unit is null then raise exception 'Select the sealed return package type'; end if;
      select conversion_factor into v_pack_factor
      from public.medicine_units
      where id = v_restock_unit and medicine_id = v_item.medicine_id;
      if v_pack_factor is null
         or v_item.quantity_base_units % v_pack_factor <> 0 then
        raise exception 'Returned quantity must contain whole configured packages';
      end if;
      if not public.has_any_permission(array['stock_inventory']::text[]) then
        raise exception 'Stock Inventory permission is required to approve a restock';
      end if;
    end if;

    select coalesce(sum(return_item.quantity_base_units), 0)
    into v_prior_returned
    from public.sale_return_items return_item
    join public.sale_returns return_header on return_header.id = return_item.return_id
    where return_item.sale_item_id = v_item.sale_item_id
      and return_header.status = 'COMPLETED';

    select coalesce(sum(return_item.quantity_base_units), 0)
    into v_pending_reserved
    from public.sale_return_items return_item
    join public.sale_returns return_header on return_header.id = return_item.return_id
    where return_item.sale_item_id = v_item.sale_item_id
      and return_header.status = 'PENDING'
      and return_header.id <> p_return_id;
    select coalesce(sum(return_item.quantity_base_units), 0)
    into v_request_reserved
    from public.sale_return_items return_item
    where return_item.sale_item_id = v_item.sale_item_id
      and return_item.return_id = p_return_id;
    if v_prior_returned + v_pending_reserved + v_request_reserved
       > v_item.sale_quantity_base_units then
      raise exception 'Return quantity exceeds the remaining quantity sold';
    end if;

    select coalesce(sum(return_item.quantity_base_units), 0)
    into v_prior_returned
    from public.sale_return_items return_item
    join public.sale_returns return_header on return_header.id = return_item.return_id
    where return_item.sale_item_id = v_item.sale_item_id
      and (
        return_header.status = 'COMPLETED'
        or (return_header.id = p_return_id and return_item.id < v_item.id)
      );
    v_refund := (
      floor(v_item.line_total_paisa::numeric
        * (v_prior_returned + v_item.quantity_base_units) / v_item.sale_quantity_base_units)
      - floor(v_item.line_total_paisa::numeric * v_prior_returned / v_item.sale_quantity_base_units)
    )::integer;

    if v_disposition = 'RESTOCK' then
      update public.stock_batches
      set quantity_remaining = quantity_remaining + v_item.quantity_base_units,
          returned_quantity = returned_quantity + v_item.quantity_base_units,
          status = 'ACTIVE'
      where id = v_item.batch_id
        and expiry_date >= current_date + v_min_shelf
        and status not in ('EXPIRED', 'DAMAGED', 'RECALLED', 'QUARANTINE');
      if not found then raise exception 'Original batch is unavailable for safe restock'; end if;
    else
      insert into public.stock_batches (
        medicine_id, supplier_id, batch_number, expiry_date, received_date,
        cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
        quantity_received, quantity_remaining, status
      )
      select source.medicine_id, source.supplier_id,
        left(source.batch_number || '-RET-' || upper(substr(replace(p_return_id::text, '-', ''), 1, 8)), 120),
        source.expiry_date, current_date,
        source.cost_paisa_per_base_unit, source.mrp_paisa_per_base_unit,
        v_item.quantity_base_units, v_item.quantity_base_units, 'QUARANTINE'
      from public.stock_batches source
      where source.id = v_item.batch_id
      returning id into v_quarantine_batch;
      if v_quarantine_batch is null then raise exception 'Could not create a quarantine record'; end if;

      insert into public.stock_movements (
        batch_id, movement_type, quantity_delta, reference_id, reason, created_by
      )
      values (
        v_quarantine_batch, 'SALE_RETURN', v_item.quantity_base_units,
        p_return_id, 'Quarantined return: ' || v_reason, auth.uid()
      );

      if v_disposition = 'WRITE_OFF' then
        update public.stock_batches
        set quantity_remaining = 0, status = 'DAMAGED'
        where id = v_quarantine_batch;
        insert into public.stock_movements (
          batch_id, movement_type, quantity_delta, reference_id, reason, created_by
        )
        values (
          v_quarantine_batch, 'WRITE_OFF', -v_item.quantity_base_units,
          p_return_id, v_reason, auth.uid()
        );
      end if;
    end if;

    if v_disposition = 'RESTOCK' then
      insert into public.stock_movements (
        batch_id, movement_type, quantity_delta, reference_id, reason, created_by
      )
      values (
        v_item.batch_id, 'SALE_RETURN', v_item.quantity_base_units,
        p_return_id, 'Approved sale return: ' || v_reason, auth.uid()
      );
    end if;

    update public.sale_return_items
    set disposition = v_disposition,
        sealed_intact = v_sealed,
        restock_unit_id = v_restock_unit,
        refund_paisa = v_refund,
        reason = v_reason,
        quarantine_batch_id = v_quarantine_batch
    where id = v_item.id;
    v_total_refund := v_total_refund + v_refund;
    v_quarantine_batch := null;
    v_processed_count := v_processed_count + 1;
  end loop;

  if exists (
    select 1 from public.sale_payments
    where sale_id = v_sale.id and payment_method = 'CREDIT'
  ) then
    if v_sale.customer_id is null then raise exception 'Credit return has no customer account'; end if;
    select * into v_updated_customer
    from public.customers
    where id = v_sale.customer_id
    for update;
    if not found then raise exception 'Customer account for this credit sale was not found'; end if;
    if v_updated_customer.store_credit_paisa::bigint
       + greatest(0, v_total_refund - v_updated_customer.current_balance_paisa) > 2147483647 then
      raise exception 'Customer store credit exceeds the supported limit';
    end if;

    update public.customers
    set current_balance_paisa = greatest(0, current_balance_paisa - v_total_refund::integer),
        store_credit_paisa = store_credit_paisa
          + greatest(0, v_total_refund::integer - current_balance_paisa)
    where id = v_sale.customer_id
    returning * into v_updated_customer;

    insert into public.khata_entries (
      customer_id, sale_id, entry_type, reference_number, description,
      debit_paisa, credit_paisa, created_by
    )
    values (
      v_sale.customer_id, v_sale.id, 'RETURN', v_sale.invoice_number,
      'Sale return credit', 0, v_total_refund::integer, auth.uid()
    );
  end if;

  update public.sale_returns
  set status = 'COMPLETED',
      refund_method = case when exists (
        select 1 from public.sale_payments
        where sale_id = v_sale.id and payment_method = 'CREDIT'
      ) then 'CREDIT' else 'CASH' end,
      refund_total_paisa = v_total_refund::integer,
      approved_by = auth.uid(),
      processed_at = now()
  where id = p_return_id;

  update public.sales
  set status = case
    when not exists (
      select 1 from public.sale_items sale_item
      where sale_item.sale_id = v_sale.id
        and sale_item.quantity_base_units > coalesce((
          select sum(return_item.quantity_base_units)
          from public.sale_return_items return_item
          join public.sale_returns return_header on return_header.id = return_item.return_id
          where return_item.sale_item_id = sale_item.id
            and return_header.status in ('COMPLETED', 'PENDING')
        ), 0)
    ) then 'RETURNED'
    else 'PARTIALLY_RETURNED'
  end
  where id = v_sale.id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(), 'SALE_RETURN_PROCESSED', 'sale_return', p_return_id,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'invoice_number', v_sale.invoice_number,
      'refund_total_paisa', v_total_refund::integer,
      'refund_method', case when exists (
        select 1 from public.sale_payments
        where sale_id = v_sale.id and payment_method = 'CREDIT'
      ) then 'CREDIT' else 'CASH' end,
      'item_count', v_processed_count
    )
  );

  return jsonb_build_object(
    'id', p_return_id,
    'invoiceNumber', v_sale.invoice_number,
    'status', 'COMPLETED',
    'refundMethod', case when exists (
      select 1 from public.sale_payments
      where sale_id = v_sale.id and payment_method = 'CREDIT'
    ) then 'CREDIT' else 'CASH' end,
    'refundTotalPaisa', v_total_refund::integer,
    'customerBalancePaisa', case when v_sale.customer_id is null then null else v_updated_customer.current_balance_paisa end,
    'customerStoreCreditPaisa', case when v_sale.customer_id is null then null else v_updated_customer.store_credit_paisa end,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'productName', sale_item.product_name,
        'unitName', sale_item.unit_name,
        'quantityBaseUnits', return_item.quantity_base_units,
        'disposition', return_item.disposition,
        'refundPaisa', return_item.refund_paisa
      ) order by sale_item.product_name), '[]'::jsonb)
      from public.sale_return_items return_item
      join public.sale_items sale_item on sale_item.id = return_item.sale_item_id
      where return_item.return_id = p_return_id
    )
  );
end;
$function$;

revoke all on function public.pos_customers() from public, anon;
revoke all on function public.save_customer(text, text, text, text, integer) from public, anon;
revoke all on function public.record_customer_payment(uuid, integer, text) from public, anon;
revoke all on function public.customer_accounts_summary() from public, anon;
revoke all on function public.get_return_policy_settings() from public, anon;
revoke all on function public.update_return_policy_settings(integer, integer) from public, anon;
revoke all on function public.post_sale(uuid, text, jsonb, integer, integer, integer, jsonb) from public, anon;
revoke all on function public.sales_history(integer) from public, anon;
revoke all on function public.sale_for_return(text) from public, anon;
revoke all on function public.request_sale_return(uuid, text, jsonb) from public, anon;
revoke all on function public.pending_sale_returns() from public, anon;
revoke all on function public.reject_sale_return(uuid, text) from public, anon;
revoke all on function public.process_sale_return(uuid, jsonb) from public, anon;

grant execute on function public.pos_customers() to authenticated;
grant execute on function public.save_customer(text, text, text, text, integer) to authenticated;
grant execute on function public.record_customer_payment(uuid, integer, text) to authenticated;
grant execute on function public.customer_accounts_summary() to authenticated;
grant execute on function public.get_return_policy_settings() to authenticated;
grant execute on function public.update_return_policy_settings(integer, integer) to authenticated;
grant execute on function public.post_sale(uuid, text, jsonb, integer, integer, integer, jsonb) to authenticated;
grant execute on function public.sales_history(integer) to authenticated;
grant execute on function public.sale_for_return(text) to authenticated;
grant execute on function public.request_sale_return(uuid, text, jsonb) to authenticated;
grant execute on function public.pending_sale_returns() to authenticated;
grant execute on function public.reject_sale_return(uuid, text) to authenticated;
grant execute on function public.process_sale_return(uuid, jsonb) to authenticated;

commit;
