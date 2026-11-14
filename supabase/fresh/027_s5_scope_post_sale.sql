-- Batch 027: bind POS sale posting and every related read/write to the caller's shop.
-- Owner-run only. Apply before 20261112190000_pos_customer_details.sql.
BEGIN;

DO $preflight$
DECLARE
  v_routine pg_catalog.pg_proc%rowtype;
  v_definition text;
BEGIN
  IF to_regprocedure('public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL THEN
    RAISE EXCEPTION 'S5 sale-scope prerequisites are missing; inspect the deployed schema before applying';
  END IF;

  SELECT * INTO v_routine
  FROM pg_catalog.pg_proc
  WHERE oid = to_regprocedure('public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)');
  v_definition := pg_catalog.pg_get_functiondef(v_routine.oid);
  IF NOT v_routine.prosecdef
     OR v_routine.prorettype <> 'jsonb'::regtype
     OR NOT (coalesce(v_routine.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'The existing post_sale routine does not match the reviewed protected JSON RPC';
  END IF;
  IF position('tenant_private.current_shop_id()' IN lower(v_definition)) > 0 THEN
    RAISE EXCEPTION 'post_sale already contains shop scoping; inspect the deployed definition instead of reapplying Batch 027';
  END IF;

  IF EXISTS (
    SELECT expected.table_name
    FROM (VALUES
      ('profiles'), ('sales'), ('customers'), ('medicines'), ('medicine_units'),
      ('stock_batches'), ('sale_items'), ('sale_payments'),
      ('sale_item_batch_allocations'), ('stock_movements'), ('khata_entries'), ('audit_logs')
    ) AS expected(table_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public'
        AND column_info.table_name = expected.table_name
        AND column_info.column_name = 'shop_id'
    )
  ) THEN
    RAISE EXCEPTION 'A required POS table lacks shop_id; do not apply Batch 027 before the S3/S4 schema';
  END IF;
END;
$preflight$;

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
  v_shop_id uuid := tenant_private.current_shop_id();
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
  where id = auth.uid() and shop_id = v_shop_id and is_active and deleted_at is null;
  if auth.uid() is null or v_shop_id is null or v_actor.id is null
     or v_actor.shop_id is distinct from v_shop_id
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
    where id = p_customer_id and shop_id = v_shop_id
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
    join public.medicine_units unit
      on unit.medicine_id = medicine.id and unit.shop_id = v_shop_id
    where medicine.id = nullif(v_item->>'medicine_id', '')::uuid
      and unit.id = nullif(v_item->>'unit_id', '')::uuid
      and medicine.shop_id = v_shop_id
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
    id, shop_id, invoice_number, cashier_id, cashier_name, customer_id, customer_name,
    "timestamp", subtotal_paisa, discount_paisa, total_paisa, rounding_paisa,
    amount_tendered_paisa, change_paisa, status
  )
  values (
    v_sale_id, v_shop_id, v_invoice, auth.uid(), coalesce(v_actor.full_name, 'Staff'),
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
    join public.medicine_units unit
      on unit.medicine_id = medicine.id and unit.shop_id = v_shop_id
    where medicine.id = (v_item->>'medicine_id')::uuid
      and unit.id = (v_item->>'unit_id')::uuid
      and medicine.shop_id = v_shop_id
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
      shop_id, sale_id, medicine_id, unit_id, product_name, generic_name, unit_name,
      conversion_factor, quantity_in_unit, quantity_base_units,
      price_paisa_per_unit, cost_paisa_per_base_unit, discount_percent,
      line_discount_paisa, line_adjustment_paisa, line_total_paisa
    )
    values (
      v_shop_id, v_sale_id, v_medicine.id, v_medicine.unit_id, v_medicine.brand_name,
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
        and stock.shop_id = v_shop_id
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
      where id = v_batch.id and shop_id = v_shop_id;

      insert into public.sale_item_batch_allocations (
        shop_id, sale_item_id, batch_id, quantity_base_units, cost_paisa_per_base_unit,
        batch_number, expiry_date
      )
      values (
        v_shop_id, v_sale_item_id, v_batch.id, v_take, v_batch.cost_paisa_per_base_unit,
        v_batch.batch_number, v_batch.expiry_date
      );
      insert into public.stock_movements (
        shop_id, batch_id, movement_type, quantity_delta, reference_id, reason, created_by
      )
      values (
        v_shop_id, v_batch.id, 'SALE', -v_take, v_sale_id, 'POS sale ' || v_invoice, auth.uid()
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
    where id = v_sale_item_id and shop_id = v_shop_id;
  end loop;

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    insert into public.sale_payments (shop_id, sale_id, payment_method, amount_paisa)
    values (v_shop_id, v_sale_id, v_payment->>'payment_method', (v_payment->>'amount_paisa')::integer);
  end loop;

  if v_credit_amount > 0 then
    if v_customer.current_balance_paisa::bigint + v_credit_amount > 2147483647 then
      raise exception 'Customer balance exceeds the supported limit';
    end if;
    update public.customers
    set current_balance_paisa = current_balance_paisa + v_credit_amount::integer
    where id = p_customer_id and shop_id = v_shop_id;
    insert into public.khata_entries (
      shop_id, customer_id, sale_id, entry_type, reference_number, description,
      debit_paisa, credit_paisa, created_by
    )
    values (
      v_shop_id, p_customer_id, v_sale_id, 'INVOICE', v_invoice, 'POS credit sale',
      v_credit_amount::integer, 0, auth.uid()
    );
  end if;

  insert into public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  values (
    v_shop_id, auth.uid(), 'SALE_POSTED', 'sale', v_sale_id,
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
            and allocation.shop_id = v_shop_id
        )
      ) order by si.created_at, si.id)
      from public.sale_items si
      join public.medicines medicine
        on medicine.id = si.medicine_id and medicine.shop_id = v_shop_id
      left join lateral (
        select allocation.batch_id, allocation.batch_number, allocation.expiry_date
        from public.sale_item_batch_allocations allocation
        where allocation.sale_item_id = si.id
            and allocation.shop_id = v_shop_id
        order by allocation.expiry_date, allocation.batch_id
        limit 1
      ) first_alloc on true
      where si.sale_id = s.id and si.shop_id = v_shop_id
    ), '[]'::jsonb),
    'subtotalPaisa', s.subtotal_paisa,
    'discountPaisa', s.discount_paisa,
    'totalPaisa', s.total_paisa,
    'roundingPaisa', s.rounding_paisa,
    'paymentMethod', case
      when v_credit_amount > 0 then 'CREDIT'
      when (select count(*) from public.sale_payments payment where payment.sale_id = s.id and payment.shop_id = v_shop_id) > 1 then 'SPLIT'
      else (select payment.payment_method from public.sale_payments payment where payment.sale_id = s.id and payment.shop_id = v_shop_id limit 1)
    end,
    'amountTenderedPaisa', coalesce(p_tendered_paisa, 0),
    'changePaisa', greatest(coalesce(p_tendered_paisa, 0) - s.total_paisa, 0)
  )
  into v_result
  from public.sales s
  where s.id = v_sale_id and s.shop_id = v_shop_id;

  return v_result;
end;
$function$;

REVOKE ALL ON FUNCTION public.post_sale(uuid, text, jsonb, integer, integer, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_sale(uuid, text, jsonb, integer, integer, integer, jsonb)
  TO authenticated;

DO $postflight$
DECLARE
  v_routine pg_catalog.pg_proc%rowtype;
  v_definition text;
BEGIN
  SELECT * INTO v_routine
  FROM pg_catalog.pg_proc
  WHERE oid = to_regprocedure('public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)');
  v_definition := lower(pg_catalog.pg_get_functiondef(v_routine.oid));

  IF NOT v_routine.prosecdef
     OR v_routine.prorettype <> 'jsonb'::regtype
     OR NOT (coalesce(v_routine.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public'])
     OR position('tenant_private.current_shop_id()' IN v_definition) = 0
     OR position('medicine.shop_id = v_shop_id' IN v_definition) = 0
     OR position('unit.shop_id = v_shop_id' IN v_definition) = 0
     OR position('stock.shop_id = v_shop_id' IN v_definition) = 0
     OR has_function_privilege('anon', v_routine.oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_routine.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Scoped post_sale definition or API grants failed postflight verification';
  END IF;
END;
$postflight$;

COMMIT;
