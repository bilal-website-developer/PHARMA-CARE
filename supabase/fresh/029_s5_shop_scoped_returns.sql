-- Batch 029: bind return requests, review, processing, and policy settings to the caller's shop.
-- Query 030 confirmed all seven live RPC bodies already match these replacements.
-- Owner-run once only; the schema preflight requires the original global policy key.
BEGIN;
LOCK TABLE public.return_policy_settings IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_signature text;
  v_routine pg_catalog.pg_proc%rowtype;
  v_primary_key_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this migration as the reviewed database owner role with RLS bypass.';
  END IF;

  IF to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL THEN
    RAISE EXCEPTION 'S3 trusted shop-scope helpers are missing; inspect the deployed schema.';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.sale_for_return(text)',
    'public.request_sale_return(uuid,text,jsonb)',
    'public.pending_sale_returns()',
    'public.reject_sale_return(uuid,text)',
    'public.process_sale_return(uuid,jsonb)',
    'public.get_return_policy_settings()',
    'public.update_return_policy_settings(integer,integer)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Expected return RPC % is missing.', v_signature;
    END IF;

    SELECT * INTO v_routine
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure(v_signature);

    IF NOT v_routine.prosecdef
       OR v_routine.prorettype <> 'jsonb'::regtype
       OR NOT (coalesce(v_routine.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public'])
       OR NOT has_function_privilege('authenticated', v_routine.oid, 'EXECUTE')
       OR has_function_privilege('anon', v_routine.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Return RPC % has unexpected security settings or grants.', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT expected.table_name
    FROM (VALUES
      ('profiles'), ('return_policy_settings'), ('sale_returns'), ('sale_return_items'),
      ('sales'), ('sale_items'), ('sale_item_batch_allocations'), ('sale_payments'),
      ('stock_batches'), ('stock_movements'), ('customers'), ('medicines'),
      ('medicine_units'), ('khata_entries'), ('audit_logs')
    ) AS expected(table_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public'
        AND column_info.table_name = expected.table_name
        AND column_info.column_name = 'shop_id'
    )
  ) THEN
    RAISE EXCEPTION 'A return-workflow table lacks shop_id; do not apply Batch 029 before S3/S4.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class table_class
    WHERE table_class.oid = 'public.return_policy_settings'::regclass
      AND table_class.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'return_policy_settings must have RLS enabled before Batch 029.';
  END IF;

  SELECT count(*) INTO v_primary_key_count
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.return_policy_settings'::regclass
    AND constraint_row.contype = 'p'
    AND constraint_row.conname = 'return_policy_settings_pkey'
    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) = 'PRIMARY KEY (id)';
  IF v_primary_key_count <> 1 THEN
    RAISE EXCEPTION 'Expected the original global return_policy_settings primary key; inspect before applying Batch 029.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index index_row
    JOIN pg_catalog.pg_attribute attribute_row
      ON attribute_row.attrelid = index_row.indrelid
     AND attribute_row.attname = 'id'
     AND NOT attribute_row.attisdropped
    WHERE index_row.indrelid = 'public.return_policy_settings'::regclass
      AND index_row.indisunique
      AND index_row.indnkeyatts = 1
      AND index_row.indkey[0] = attribute_row.attnum
      AND index_row.indexrelid <> (
        SELECT constraint_row.conindid
        FROM pg_catalog.pg_constraint constraint_row
        WHERE constraint_row.conrelid = 'public.return_policy_settings'::regclass
          AND constraint_row.contype = 'p'
          AND constraint_row.conname = 'return_policy_settings_pkey'
      )
  ) THEN
    RAISE EXCEPTION 'An additional unique index on return_policy_settings.id would block per-shop rows; inspect before applying Batch 029.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint constraint_row
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.return_policy_settings'::regclass
  ) THEN
    RAISE EXCEPTION 'A foreign key references return_policy_settings; inspect before changing its primary key.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.return_policy_settings settings
    LEFT JOIN public.shops shop ON shop.id = settings.shop_id
    WHERE settings.id <> 1 OR settings.shop_id IS NULL OR shop.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Return policy rows contain an invalid id or shop assignment; inspect before proceeding.';
  END IF;
END;
$preflight$;

ALTER TABLE public.return_policy_settings
  DROP CONSTRAINT return_policy_settings_pkey;
ALTER TABLE public.return_policy_settings
  ADD CONSTRAINT return_policy_settings_pkey PRIMARY KEY (shop_id, id);

INSERT INTO public.return_policy_settings (
  shop_id, id, return_window_days, minimum_restock_shelf_life_days
)
SELECT shop.id, 1, 7, 90
FROM public.shops shop
WHERE NOT EXISTS (
  SELECT 1
  FROM public.return_policy_settings settings
  WHERE settings.shop_id = shop.id AND settings.id = 1
);
create or replace function public.get_return_policy_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_shop_id uuid := tenant_private.current_shop_id();
  v_settings public.return_policy_settings%rowtype;
begin
  if auth.uid() is null or v_shop_id is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and shop_id = v_shop_id and is_active and deleted_at is null
  ) or not public.has_any_permission(array['pos']::text[]) then
    raise exception 'You do not have permission to view return settings';
  end if;
  select * into v_settings from public.return_policy_settings
  where id = 1 and shop_id = v_shop_id;
  if not found then raise exception 'Return settings for this shop were not found'; end if;
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
  v_shop_id uuid := tenant_private.current_shop_id();
  v_settings public.return_policy_settings%rowtype;
begin
  if auth.uid() is null or v_shop_id is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and shop_id = v_shop_id
      and is_active and deleted_at is null and role = 'admin'
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
  where id = 1 and shop_id = v_shop_id
  returning * into v_settings;
  if not found then raise exception 'Return settings for this shop were not found'; end if;

  insert into public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  values (
    v_shop_id, auth.uid(), 'RETURN_POLICY_UPDATED', 'return_policy', gen_random_uuid(),
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

create or replace function public.sale_for_return(p_invoice_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_shop_id uuid := tenant_private.current_shop_id();
  v_sale_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null or v_shop_id is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and shop_id = v_shop_id and is_active and deleted_at is null
  ) or not public.has_any_permission(array['pos']::text[]) then
    raise exception 'You do not have permission to request a sale return';
  end if;

  select s.id into v_sale_id
  from public.sales s
  where s.invoice_number = nullif(btrim(p_invoice_number), '')
    and s.shop_id = v_shop_id
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
                and return_item.shop_id = v_shop_id
                and return_header.shop_id = v_shop_id
                and return_header.status in ('PENDING', 'COMPLETED')
            ), 0)
          ) order by allocation.expiry_date, allocation.batch_id), '[]'::jsonb)
          from public.sale_item_batch_allocations allocation
          where allocation.sale_item_id = si.id and allocation.shop_id = v_shop_id
        )
      ) order by si.created_at, si.id)
      from public.sale_items si
      join public.medicines medicine
        on medicine.id = si.medicine_id and medicine.shop_id = v_shop_id
      where si.sale_id = s.id and si.shop_id = v_shop_id
    ), '[]'::jsonb)
  )
  into v_result
  from public.sales s
  where s.id = v_sale_id and s.shop_id = v_shop_id;
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
  v_shop_id uuid := tenant_private.current_shop_id();
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
  if auth.uid() is null or v_shop_id is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and shop_id = v_shop_id and is_active and deleted_at is null
  ) or not public.has_any_permission(array['pos']::text[]) then
    raise exception 'You do not have permission to request a sale return';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Return reason is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'Select at least one item to return';
  end if;

  select invoice_number into v_invoice
  from public.sales
  where id = p_sale_id and shop_id = v_shop_id
    and status in ('COMPLETED', 'PARTIALLY_RETURNED')
  for update;
  if not found then raise exception 'Sale was not found or is not returnable'; end if;

  v_requested_count := jsonb_array_length(p_items);
  if (
    select count(distinct value->>'allocation_id')
    from jsonb_array_elements(p_items)
  ) <> v_requested_count then
    raise exception 'A sale batch allocation may appear only once in a return request';
  end if;

  insert into public.sale_returns (id, shop_id, sale_id, reason, requested_by)
  values (v_return_id, v_shop_id, p_sale_id, btrim(p_reason), auth.uid());

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_sale_item_id := nullif(v_item->>'sale_item_id', '')::uuid;
    v_allocation_id := nullif(v_item->>'allocation_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity_base_units', '')::integer;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Return quantity must be positive'; end if;

    perform 1
    from public.sale_items si
    where si.id = v_sale_item_id and si.sale_id = p_sale_id and si.shop_id = v_shop_id
    for update;
    if not found then raise exception 'A returned item does not belong to this sale'; end if;

    select allocation.quantity_base_units into v_sold
    from public.sale_item_batch_allocations allocation
    where allocation.id = v_allocation_id
      and allocation.sale_item_id = v_sale_item_id
      and allocation.shop_id = v_shop_id
    for update;
    if not found then raise exception 'A returned batch does not belong to this sale item'; end if;

    select coalesce(sum(return_item.quantity_base_units), 0) into v_already_returned
    from public.sale_return_items return_item
    join public.sale_returns return_header on return_header.id = return_item.return_id
    where return_item.sale_item_batch_allocation_id = v_allocation_id
      and return_item.shop_id = v_shop_id and return_header.shop_id = v_shop_id
      and return_header.status in ('PENDING', 'COMPLETED');
    if v_already_returned + v_quantity > v_sold then
      raise exception 'Return quantity exceeds the quantity sold from this batch';
    end if;

    insert into public.sale_return_items (
      shop_id, return_id, sale_item_id, sale_item_batch_allocation_id, batch_id,
      quantity_base_units, reason
    )
    select v_shop_id, v_return_id, v_sale_item_id, allocation.id, allocation.batch_id,
      v_quantity, btrim(p_reason)
    from public.sale_item_batch_allocations allocation
    where allocation.id = v_allocation_id and allocation.shop_id = v_shop_id;
  end loop;

  insert into public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  values (
    v_shop_id, auth.uid(), 'SALE_RETURN_REQUESTED', 'sale_return', v_return_id,
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
  v_shop_id uuid := tenant_private.current_shop_id();
  v_result jsonb;
begin
  if auth.uid() is null or v_shop_id is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and shop_id = v_shop_id and is_active and deleted_at is null
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
          where unit.medicine_id = medicine.id and unit.shop_id = v_shop_id
        )
      ) order by sale_item.product_name), '[]'::jsonb)
      from public.sale_return_items return_item
      join public.sale_items sale_item
        on sale_item.id = return_item.sale_item_id and sale_item.shop_id = v_shop_id
      join public.medicines medicine
        on medicine.id = sale_item.medicine_id and medicine.shop_id = v_shop_id
      join public.sale_item_batch_allocations allocation
        on allocation.id = return_item.sale_item_batch_allocation_id and allocation.shop_id = v_shop_id
      where return_item.return_id = return_header.id and return_item.shop_id = v_shop_id
    )
  ) order by return_header.requested_at), '[]'::jsonb)
  into v_result
  from public.sale_returns return_header
  join public.sales sale
    on sale.id = return_header.sale_id and sale.shop_id = v_shop_id
  left join public.profiles requester
    on requester.id = return_header.requested_by and requester.shop_id = v_shop_id
  where return_header.shop_id = v_shop_id and return_header.status = 'PENDING';

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
  v_shop_id uuid := tenant_private.current_shop_id();
  v_return public.sale_returns%rowtype;
begin
  if auth.uid() is null or v_shop_id is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and shop_id = v_shop_id and is_active and deleted_at is null
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
  where id = p_return_id and shop_id = v_shop_id and status = 'PENDING'
  returning * into v_return;
  if not found then
    raise exception 'Return request is missing or has already been processed';
  end if;

  insert into public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  values (
    v_shop_id, auth.uid(), 'SALE_RETURN_REJECTED', 'sale_return', p_return_id,
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
  v_shop_id uuid := tenant_private.current_shop_id();
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
  where id = auth.uid() and shop_id = v_shop_id and is_active and deleted_at is null;
  if auth.uid() is null or v_shop_id is null or v_actor.id is null or v_actor.role not in ('manager', 'admin')
     or not public.has_any_permission(array['sales_history']::text[]) then
    raise exception 'Only a Manager or Admin with Sales History access may process returns';
  end if;

  select * into v_return from public.sale_returns
  where id = p_return_id and shop_id = v_shop_id for update;
  if not found or v_return.status <> 'PENDING' then
    raise exception 'Return request is missing or has already been processed';
  end if;
  select * into v_sale from public.sales
  where id = v_return.sale_id and shop_id = v_shop_id for update;
  if not found then raise exception 'Sale for this return was not found'; end if;

  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array'
     or jsonb_array_length(p_decisions) <> (
       select count(*) from public.sale_return_items
       where return_id = p_return_id and shop_id = v_shop_id
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
  from public.return_policy_settings where id = 1 and shop_id = v_shop_id;
  if not found then raise exception 'Return settings for this shop were not found'; end if;

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
    join public.sale_items sale_item
      on sale_item.id = return_item.sale_item_id and sale_item.shop_id = v_shop_id
    join public.sale_item_batch_allocations allocation
      on allocation.id = return_item.sale_item_batch_allocation_id and allocation.shop_id = v_shop_id
    where return_item.id = nullif(v_decision->>'id', '')::uuid
      and return_item.return_id = p_return_id and return_item.shop_id = v_shop_id
    for update of return_item, sale_item, allocation;
    if not found then raise exception 'Return item was not found'; end if;

    select medicine.drug_class, medicine.storage_condition, medicine.brand_name
    into v_medicine
    from public.medicines medicine
    where medicine.id = v_item.medicine_id and medicine.shop_id = v_shop_id;

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
      where id = v_restock_unit and medicine_id = v_item.medicine_id and shop_id = v_shop_id;
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
      and return_item.shop_id = v_shop_id and return_header.shop_id = v_shop_id
      and return_header.status = 'COMPLETED';

    select coalesce(sum(return_item.quantity_base_units), 0)
    into v_pending_reserved
    from public.sale_return_items return_item
    join public.sale_returns return_header on return_header.id = return_item.return_id
    where return_item.sale_item_id = v_item.sale_item_id
      and return_item.shop_id = v_shop_id and return_header.shop_id = v_shop_id
      and return_header.status = 'PENDING'
      and return_header.id <> p_return_id;
    select coalesce(sum(return_item.quantity_base_units), 0)
    into v_request_reserved
    from public.sale_return_items return_item
    where return_item.sale_item_id = v_item.sale_item_id
      and return_item.return_id = p_return_id and return_item.shop_id = v_shop_id;
    if v_prior_returned + v_pending_reserved + v_request_reserved
       > v_item.sale_quantity_base_units then
      raise exception 'Return quantity exceeds the remaining quantity sold';
    end if;

    select coalesce(sum(return_item.quantity_base_units), 0)
    into v_prior_returned
    from public.sale_return_items return_item
    join public.sale_returns return_header on return_header.id = return_item.return_id
    where return_item.sale_item_id = v_item.sale_item_id
      and return_item.shop_id = v_shop_id and return_header.shop_id = v_shop_id
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
      where id = v_item.batch_id and shop_id = v_shop_id
        and expiry_date >= current_date + v_min_shelf
        and status not in ('EXPIRED', 'DAMAGED', 'RECALLED', 'QUARANTINE');
      if not found then raise exception 'Original batch is unavailable for safe restock'; end if;
    else
      insert into public.stock_batches (
        shop_id, medicine_id, supplier_id, batch_number, expiry_date, received_date,
        cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
        quantity_received, quantity_remaining, status
      )
      select v_shop_id, source.medicine_id, source.supplier_id,
        left(source.batch_number || '-RET-' || upper(substr(replace(p_return_id::text, '-', ''), 1, 8)), 120),
        source.expiry_date, current_date,
        source.cost_paisa_per_base_unit, source.mrp_paisa_per_base_unit,
        v_item.quantity_base_units, v_item.quantity_base_units, 'QUARANTINE'
      from public.stock_batches source
      where source.id = v_item.batch_id and source.shop_id = v_shop_id
      returning id into v_quarantine_batch;
      if v_quarantine_batch is null then raise exception 'Could not create a quarantine record'; end if;

      insert into public.stock_movements (
        shop_id, batch_id, movement_type, quantity_delta, reference_id, reason, created_by
      )
      values (
        v_shop_id, v_quarantine_batch, 'SALE_RETURN', v_item.quantity_base_units,
        p_return_id, 'Quarantined return: ' || v_reason, auth.uid()
      );

      if v_disposition = 'WRITE_OFF' then
        update public.stock_batches
        set quantity_remaining = 0, status = 'DAMAGED'
        where id = v_quarantine_batch and shop_id = v_shop_id;
        insert into public.stock_movements (
          shop_id, batch_id, movement_type, quantity_delta, reference_id, reason, created_by
        )
        values (
          v_shop_id, v_quarantine_batch, 'WRITE_OFF', -v_item.quantity_base_units,
          p_return_id, v_reason, auth.uid()
        );
      end if;
    end if;

    if v_disposition = 'RESTOCK' then
      insert into public.stock_movements (
        shop_id, batch_id, movement_type, quantity_delta, reference_id, reason, created_by
      )
      values (
        v_shop_id, v_item.batch_id, 'SALE_RETURN', v_item.quantity_base_units,
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
    where id = v_item.id and shop_id = v_shop_id;
    v_total_refund := v_total_refund + v_refund;
    v_quarantine_batch := null;
    v_processed_count := v_processed_count + 1;
  end loop;

  if exists (
    select 1 from public.sale_payments
    where sale_id = v_sale.id and shop_id = v_shop_id and payment_method = 'CREDIT'
  ) then
    if v_sale.customer_id is null then raise exception 'Credit return has no customer account'; end if;
    select * into v_updated_customer
    from public.customers
    where id = v_sale.customer_id and shop_id = v_shop_id
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
    where id = v_sale.customer_id and shop_id = v_shop_id
    returning * into v_updated_customer;

    insert into public.khata_entries (
      shop_id, customer_id, sale_id, entry_type, reference_number, description,
      debit_paisa, credit_paisa, created_by
    )
    values (
      v_shop_id, v_sale.customer_id, v_sale.id, 'RETURN', v_sale.invoice_number,
      'Sale return credit', 0, v_total_refund::integer, auth.uid()
    );
  end if;

  update public.sale_returns
  set status = 'COMPLETED',
      refund_method = case when exists (
        select 1 from public.sale_payments
        where sale_id = v_sale.id and shop_id = v_shop_id and payment_method = 'CREDIT'
      ) then 'CREDIT' else 'CASH' end,
      refund_total_paisa = v_total_refund::integer,
      approved_by = auth.uid(),
      processed_at = now()
  where id = p_return_id and shop_id = v_shop_id;

  update public.sales
  set status = case
    when not exists (
      select 1 from public.sale_items sale_item
      where sale_item.sale_id = v_sale.id and sale_item.shop_id = v_shop_id
        and sale_item.quantity_base_units > coalesce((
          select sum(return_item.quantity_base_units)
          from public.sale_return_items return_item
          join public.sale_returns return_header on return_header.id = return_item.return_id
          where return_item.sale_item_id = sale_item.id
            and return_item.shop_id = v_shop_id and return_header.shop_id = v_shop_id
            and return_header.status in ('COMPLETED', 'PENDING')
        ), 0)
    ) then 'RETURNED'
    else 'PARTIALLY_RETURNED'
  end
  where id = v_sale.id and shop_id = v_shop_id;

  insert into public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  values (
    v_shop_id, auth.uid(), 'SALE_RETURN_PROCESSED', 'sale_return', p_return_id,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'invoice_number', v_sale.invoice_number,
      'refund_total_paisa', v_total_refund::integer,
      'refund_method', case when exists (
        select 1 from public.sale_payments
        where sale_id = v_sale.id and shop_id = v_shop_id and payment_method = 'CREDIT'
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
      where sale_id = v_sale.id and shop_id = v_shop_id and payment_method = 'CREDIT'
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
      join public.sale_items sale_item
        on sale_item.id = return_item.sale_item_id and sale_item.shop_id = v_shop_id
      where return_item.return_id = p_return_id and return_item.shop_id = v_shop_id
    )
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.sale_for_return(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_sale_return(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pending_sale_returns() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_sale_return(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_sale_return(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_return_policy_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_return_policy_settings(integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sale_for_return(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_sale_return(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_sale_returns() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_sale_return(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_sale_return(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_return_policy_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_return_policy_settings(integer, integer) TO authenticated;

DO $postflight$
DECLARE
  v_signature text;
  v_definition text;
  v_routine pg_catalog.pg_proc%rowtype;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.sale_for_return(text)',
    'public.request_sale_return(uuid,text,jsonb)',
    'public.pending_sale_returns()',
    'public.reject_sale_return(uuid,text)',
    'public.process_sale_return(uuid,jsonb)',
    'public.get_return_policy_settings()',
    'public.update_return_policy_settings(integer,integer)'
  ] LOOP
    SELECT * INTO v_routine
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure(v_signature);
    v_definition := lower(pg_catalog.pg_get_functiondef(v_routine.oid));
    IF NOT v_routine.prosecdef
       OR v_routine.prorettype <> 'jsonb'::regtype
       OR NOT (coalesce(v_routine.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public'])
       OR position('tenant_private.current_shop_id()' IN v_definition) = 0
       OR position('shop_id = v_shop_id' IN v_definition) = 0
       OR has_function_privilege('anon', v_routine.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_routine.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Scoped return RPC % failed security or API grant postflight.', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.return_policy_settings'::regclass
      AND constraint_row.contype = 'p'
      AND constraint_row.conname = 'return_policy_settings_pkey'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) = 'PRIMARY KEY (shop_id, id)'
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'return_policy_settings'
      AND column_info.column_name = 'shop_id'
      AND column_info.is_nullable <> 'NO'
  ) OR EXISTS (
    SELECT 1
    FROM public.shops shop
    WHERE NOT EXISTS (
      SELECT 1 FROM public.return_policy_settings settings
      WHERE settings.shop_id = shop.id AND settings.id = 1
    )
  ) THEN
    RAISE EXCEPTION 'Per-shop return policy key or settings seed failed postflight.';
  END IF;
END;
$postflight$;

COMMIT;
