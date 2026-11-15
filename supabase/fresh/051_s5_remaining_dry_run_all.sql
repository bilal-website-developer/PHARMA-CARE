-- S5 remaining: dry-run all four groups in one SQL Editor transaction.
-- All objects/data changes are rolled back at the end.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- 040: shop-scope purchase workflows and convert the singleton counter to per-shop keys.
-- Included by 051/052; do not run this source fragment by itself.
DO $preflight$
DECLARE v_sig text; v_oid oid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Owner role with RLS bypass required'; END IF;
 PERFORM set_config('request.jwt.claim.sub','',true); PERFORM set_config('request.jwt.claims','{}',true);
 IF (SELECT count(*) FROM public.purchase_number_state)<>1 OR (SELECT count(*) FROM public.purchase_number_state WHERE id=1 AND shop_id IS NOT NULL AND last_number=0)<>1 OR (SELECT count(*) FROM public.purchases)<>0 OR (SELECT count(*) FROM public.suppliers)<>4 OR (SELECT count(DISTINCT shop_id) FROM public.suppliers)<>1 OR EXISTS(SELECT 1 FROM public.suppliers WHERE shop_id IS NULL) OR NOT EXISTS(SELECT 1 FROM public.purchase_number_state counter JOIN public.suppliers supplier ON supplier.shop_id=counter.shop_id WHERE counter.id=1) THEN RAISE EXCEPTION 'Purchase/counter/supplier preflight facts changed; rerun 050'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid='public.purchases'::regclass AND i.indisunique AND i.indisvalid AND pg_catalog.pg_get_indexdef(i.indexrelid) ILIKE '%(shop_id, pr_no)%') THEN RAISE EXCEPTION 'Valid unique (shop_id,pr_no) index missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.purchase_number_state'::regclass AND c.contype='p' AND pg_catalog.pg_get_constraintdef(c.oid) ILIKE '%(id)%') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.purchase_number_state'::regclass AND c.contype='c' AND pg_catalog.pg_get_constraintdef(c.oid) ILIKE '%id = 1%') THEN RAISE EXCEPTION 'Counter structure changed from reviewed singleton'; END IF;
 IF EXISTS(SELECT 1 FROM public.purchases p JOIN public.suppliers s ON s.id=p.supplier_id WHERE p.shop_id IS DISTINCT FROM s.shop_id) OR EXISTS(SELECT 1 FROM public.purchase_items i JOIN public.purchases p ON p.id=i.purchase_id WHERE i.shop_id IS DISTINCT FROM p.shop_id) OR EXISTS(SELECT 1 FROM public.purchase_items i JOIN public.stock_batches b ON b.id=i.stock_batch_id JOIN public.purchases p ON p.id=i.purchase_id WHERE b.shop_id IS DISTINCT FROM p.shop_id) OR EXISTS(SELECT 1 FROM public.supplier_ledger l JOIN public.purchases p ON p.id=l.purchase_id WHERE l.shop_id IS DISTINCT FROM p.shop_id) THEN RAISE EXCEPTION 'Purchase reference mismatch; stop'; END IF;
 FOREACH v_sig IN ARRAY ARRAY[
  'public.post_purchase(uuid,text,date,integer,text,jsonb,integer,text)',
  'public.purchase_catalog()',
  'public.purchase_history(text,text,date,date,integer,integer,boolean)',
  'public.purchase_detail(uuid)',
  'public.void_purchase(uuid,text)'
 ] LOOP
  v_oid := to_regprocedure(v_sig);
  IF v_oid IS NULL OR NOT (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
       AND has_function_privilege('authenticated',p.oid,'EXECUTE')
       AND has_function_privilege('service_role',p.oid,'EXECUTE')
       AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
       AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
       FROM pg_catalog.pg_proc p WHERE p.oid=v_oid) THEN
    RAISE EXCEPTION 'Purchase RPC % differs from reviewed signature/security/grants.',v_sig;
  END IF;
 END LOOP;
END; $preflight$;
LOCK TABLE public.shops,public.purchase_number_state,public.purchases IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.purchase_number_state ALTER COLUMN shop_id SET NOT NULL;
DO $pk$ DECLARE n text; BEGIN SELECT conname INTO n FROM pg_catalog.pg_constraint WHERE conrelid='public.purchase_number_state'::regclass AND contype='p'; EXECUTE format('ALTER TABLE public.purchase_number_state DROP CONSTRAINT %I',n); ALTER TABLE public.purchase_number_state ADD CONSTRAINT purchase_number_state_pkey PRIMARY KEY(shop_id); END; $pk$;
INSERT INTO public.purchase_number_state(id,shop_id,last_number) SELECT 1,s.id,coalesce(max(substring(p.pr_no FROM '^PR-([0-9]+)$')::bigint),0) FROM public.shops s LEFT JOIN public.purchases p ON p.shop_id=s.id GROUP BY s.id ON CONFLICT(shop_id) DO NOTHING;
create or replace function public.post_purchase(
  p_supplier_id uuid,
  p_invoice_number text,
  p_purchase_date date,
  p_paid_paisa integer,
  p_notes text,
  p_items jsonb,
  p_discount_paisa integer,
  p_payment_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_purchase_id uuid;
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_pr_no text;
  v_item jsonb;
  v_date date := coalesce(p_purchase_date, current_date);
  v_paid integer := coalesce(p_paid_paisa, 0);
  v_discount integer := coalesce(p_discount_paisa, 0);
  v_subtotal bigint := 0;
  v_total bigint;
  v_medicine_id uuid;
  v_unit_id uuid;
  v_factor integer;
  v_qty integer;
  v_bonus integer;
  v_unit_cost integer;
  v_mrp integer;
  v_expiry date;
  v_batch_no text;
  v_base_qty bigint;
  v_batch_id uuid;
  v_next_number bigint;
begin
  if auth.uid() is null
     or not public.has_any_permission(array['purchases']::text[])
     or not public.can_view_cost() then
    raise exception 'You do not have permission to post purchases';
  end if;
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;


  if p_payment_type is null or p_payment_type not in ('cash', 'credit') then
    raise exception 'Payment type must be cash or credit';
  end if;
  if p_discount_paisa is null or v_discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'A purchase needs at least one item';
  end if;

  perform 1 from public.suppliers where id=p_supplier_id and shop_id=v_shop_id and is_active for update;
  if not found then
    raise exception 'Select an active supplier';
  end if;

  insert into public.purchase_number_state (id,shop_id,last_number) values (1,v_shop_id,0) on conflict (shop_id) do nothing;
  loop
    update public.purchase_number_state set last_number=last_number+1 where shop_id=v_shop_id
    returning last_number into v_next_number;
    if v_next_number is null then
      raise exception 'Purchase number counter is not initialized';
    end if;
    v_pr_no := 'PR-' || lpad(
      v_next_number::text,
      greatest(4, length(v_next_number::text)),
      '0'
    );
    exit when not exists (
      select 1 from public.purchases where shop_id=v_shop_id and pr_no=v_pr_no
    );
  end loop;

  insert into public.purchases (
    shop_id, pr_no, supplier_id, invoice_number, purchase_date,
    subtotal_paisa, discount_paisa, total_paisa, paid_paisa,
    payment_type, payment_status, status, notes, created_by
  )
  values (
    v_shop_id, v_pr_no, p_supplier_id, nullif(trim(p_invoice_number), ''), v_date,
    0, v_discount, 0, 0, p_payment_type, 'unpaid', 'posted',
    p_notes, auth.uid()
  )
  returning id into v_purchase_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_medicine_id := nullif(v_item->>'medicine_id', '')::uuid;
    v_unit_id := nullif(v_item->>'unit_id', '')::uuid;
    v_batch_no := nullif(trim(v_item->>'batch_number'), '');
    v_expiry := nullif(v_item->>'expiry_date', '')::date;
    v_qty := nullif(v_item->>'quantity', '')::integer;
    v_bonus := coalesce(nullif(v_item->>'bonus_qty', '')::integer, 0);
    v_unit_cost := nullif(v_item->>'unit_cost_paisa', '')::integer;
    v_mrp := nullif(v_item->>'mrp_paisa', '')::integer;

    if v_batch_no is null then raise exception 'Batch number is required'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be greater than zero'; end if;
    if v_bonus < 0 then raise exception 'Bonus quantity cannot be negative'; end if;
    if v_unit_cost is null or v_unit_cost < 0 then raise exception 'Cost cannot be negative'; end if;
    if v_mrp is null or v_mrp < 0 then raise exception 'MRP cannot be negative'; end if;
    if v_expiry is null or v_expiry <= v_date then raise exception 'Batch expiry must be after the purchase date'; end if;

    select conversion_factor into v_factor
    from public.medicine_units
    where id=v_unit_id and medicine_id=v_medicine_id and shop_id=v_shop_id
      and exists (
        select 1 from public.medicines medicine
        where medicine.id = v_medicine_id and medicine.shop_id = v_shop_id
      );
    if v_factor is null then
      raise exception 'Purchase unit does not belong to the selected medicine';
    end if;

    v_base_qty := (v_qty::bigint + v_bonus::bigint) * v_factor;
    if v_base_qty > 2147483647 then raise exception 'Quantity exceeds the supported stock limit'; end if;
    v_subtotal := v_subtotal + (v_qty::bigint * v_unit_cost);
    if v_subtotal > 2147483647 then raise exception 'Purchase total exceeds the supported limit'; end if;

    insert into public.stock_batches (
      shop_id, medicine_id, supplier_id, batch_number, expiry_date, received_date,
      cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
      quantity_received, quantity_remaining
    )
    values (
      v_shop_id, v_medicine_id, p_supplier_id, v_batch_no, v_expiry, v_date,
      round(v_unit_cost::numeric / v_factor)::integer,
      round(v_mrp::numeric / v_factor)::integer,
      v_base_qty::integer, v_base_qty::integer
    )
    returning id into v_batch_id;

    insert into public.stock_movements (
      shop_id, batch_id, movement_type, quantity_delta, reference_id, reason, created_by
    )
    values (
      v_shop_id, v_batch_id, 'RECEIPT', v_base_qty::integer, v_purchase_id,
      'Purchase ' || v_pr_no, auth.uid()
    );

    if exists (
      select 1
      from pg_attribute
      where attrelid = 'public.purchase_items'::regclass
        and attname = 'line_total_paisa'
        and attgenerated <> ''
        and not attisdropped
    ) then
      insert into public.purchase_items (
        shop_id, purchase_id, medicine_id, unit_id, batch_number, expiry_date,
        quantity, bonus_qty, conversion_factor, unit_cost_paisa,
        mrp_paisa, stock_batch_id
      )
      values (
        v_shop_id, v_purchase_id, v_medicine_id, v_unit_id, v_batch_no, v_expiry,
        v_qty, v_bonus, v_factor, v_unit_cost, v_mrp, v_batch_id
      );
    else
      insert into public.purchase_items (
        shop_id, purchase_id, medicine_id, unit_id, batch_number, expiry_date,
        quantity, bonus_qty, conversion_factor, unit_cost_paisa,
        mrp_paisa, line_total_paisa, stock_batch_id
      )
      values (
        v_shop_id, v_purchase_id, v_medicine_id, v_unit_id, v_batch_no, v_expiry,
        v_qty, v_bonus, v_factor, v_unit_cost, v_mrp,
        (v_qty::bigint * v_unit_cost)::integer, v_batch_id
      );
    end if;
  end loop;

  if v_discount > v_subtotal then
    raise exception 'Discount cannot exceed the subtotal';
  end if;
  v_total := v_subtotal - v_discount;

  if p_payment_type = 'cash' then
    v_paid := v_total::integer;
  else
    v_paid := 0;
  end if;

  update public.purchases
  set subtotal_paisa = v_subtotal::integer,
      total_paisa = v_total::integer,
      paid_paisa = v_paid,
      payment_status = case when v_paid >= v_total then 'paid'
                            when v_paid = 0 then 'unpaid' else 'partial' end
  where id = v_purchase_id and shop_id = v_shop_id;

  if p_payment_type = 'credit' and v_total > 0 then
    update public.suppliers
    set payable_balance_paisa = payable_balance_paisa + v_total::integer
    where id=p_supplier_id and shop_id=v_shop_id;

    insert into public.supplier_ledger (
      shop_id, supplier_id, purchase_id, entry_type, amount_paisa, description, created_by
    )
    values (
      v_shop_id, p_supplier_id, v_purchase_id, 'purchase', v_total::integer,
      'Credit purchase ' || v_pr_no, auth.uid()
    );
  end if;

  return jsonb_build_object(
    'id', v_purchase_id,
    'pr_no', v_pr_no,
    'subtotal_paisa', v_subtotal,
    'discount_paisa', v_discount,
    'total_paisa', v_total,
    'paid_paisa', v_paid
  );
end;
$function$;

create or replace function public.purchase_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_catalog jsonb;
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
begin
  if auth.uid() is null
     or not public.has_any_permission(array['purchases']::text[]) then
    raise exception 'You do not have permission to create purchases';
  end if;
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;


  select coalesce(jsonb_agg(jsonb_build_object(
    'id', medicine.id,
    'code', medicine.code,
    'barcode', medicine.barcode,
    'brand_name', medicine.brand_name,
    'generic_name', medicine.generic_name,
    'company', medicine.company,
    'stock', coalesce((
      select sum(batch.quantity_remaining)
      from public.stock_batches batch
      where batch.medicine_id=medicine.id and batch.shop_id=v_shop_id
    ), 0),
    'last_cost_base_paisa', case
      when public.can_view_cost() then coalesce((
        select batch.cost_paisa_per_base_unit
        from public.stock_batches batch
        where batch.medicine_id=medicine.id and batch.shop_id=v_shop_id
        order by batch.created_at desc, batch.id desc
        limit 1
      ), 0)
      else null
    end,
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', unit.id,
        'name', unit.name,
        'conversion_factor', unit.conversion_factor,
        'is_default_sale_unit', unit.is_default_sale_unit,
        'price_paisa', unit.price_paisa
      ) order by unit.is_default_sale_unit desc, unit.name)
      from public.medicine_units unit
      where unit.medicine_id=medicine.id and unit.shop_id=v_shop_id
    ), '[]'::jsonb)
  ) order by medicine.brand_name), '[]'::jsonb)
  into v_catalog
  from public.medicines medicine
  where medicine.is_active and medicine.shop_id=v_shop_id;

  return v_catalog;
end;
$function$;

create or replace function public.purchase_history(
  p_search text default null,
  p_payment_type text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_page integer default 1,
  p_page_size integer default 25,
  p_export boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_search text := nullif(trim(p_search), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
begin
  if auth.uid() is null
     or not public.has_any_permission(array['purchase_history']::text[])
     or not public.can_view_cost() then
    raise exception 'You do not have permission to view purchase history';
  end if;
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;

  if p_payment_type is not null and p_payment_type not in ('cash', 'credit') then
    raise exception 'Payment filter must be cash or credit';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'Start date must not be after end date';
  end if;

  with filtered as (
    select p.*, s.name as supplier_name,
      coalesce(profile.username, profile.full_name, 'Unknown') as creator_name,
      (select count(*) from public.purchase_items pi where pi.purchase_id = p.id and pi.shop_id = v_shop_id) as item_count
    from public.purchases p
    join public.suppliers s on s.id = p.supplier_id
    left join public.profiles profile on profile.id = p.created_by
      and profile.shop_id = v_shop_id
    where p.shop_id=v_shop_id and s.shop_id=v_shop_id and (v_search is null or p.pr_no ilike '%' || v_search || '%' or s.name ilike '%' || v_search || '%')
      and (p_payment_type is null or p.payment_type = p_payment_type)
      and (p_date_from is null or p.purchase_date >= p_date_from)
      and (p_date_to is null or p.purchase_date <= p_date_to)
  ),
  summarized as (
    select count(*)::integer as row_count,
      coalesce(sum(total_paisa), 0)::bigint as total_paisa,
      coalesce(sum(total_paisa) filter (where payment_type = 'cash'), 0)::bigint as cash_paisa,
      count(*) filter (where payment_type = 'cash')::integer as cash_count,
      coalesce(sum(total_paisa) filter (where payment_type = 'credit'), 0)::bigint as credit_paisa,
      count(*) filter (where payment_type = 'credit')::integer as credit_count
    from filtered
  ),
  selected as (
    select * from filtered
    order by created_at desc, id desc
    limit case when p_export then 100000 else v_page_size end
    offset case when p_export then 0 else (v_page - 1) * v_page_size end
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', selected.id,
        'pr_no', selected.pr_no,
        'supplier_id', selected.supplier_id,
        'supplier_name', selected.supplier_name,
        'invoice_number', selected.invoice_number,
        'purchase_date', selected.purchase_date,
        'subtotal_paisa', selected.subtotal_paisa,
        'discount_paisa', selected.discount_paisa,
        'total_paisa', selected.total_paisa,
        'paid_paisa', selected.paid_paisa,
        'due_paisa', greatest(selected.total_paisa - selected.paid_paisa, 0),
        'payment_type', selected.payment_type,
        'payment_status', selected.payment_status,
        'status', selected.status,
        'notes', selected.notes,
        'void_reason', selected.void_reason,
        'created_by', selected.creator_name,
        'created_at', selected.created_at,
        'item_count', selected.item_count,
        'items', case when p_export then (
          select coalesce(jsonb_agg(jsonb_build_object(
            'medicine_id', pi.medicine_id,
            'product_name', m.brand_name,
            'generic_name', m.generic_name,
            'unit_name', mu.name,
            'batch_number', pi.batch_number,
            'expiry_date', pi.expiry_date,
            'quantity', pi.quantity,
            'bonus_qty', pi.bonus_qty,
            'conversion_factor', pi.conversion_factor,
            'unit_cost_paisa', pi.unit_cost_paisa,
            'mrp_paisa', pi.mrp_paisa,
            'line_total_paisa', pi.line_total_paisa
          ) order by pi.created_at, pi.id), '[]'::jsonb)
          from public.purchase_items pi
          join public.medicines m on m.id=pi.medicine_id and m.shop_id=v_shop_id
          join public.medicine_units mu on mu.id=pi.unit_id and mu.shop_id=v_shop_id
          where pi.purchase_id=selected.id and pi.shop_id=v_shop_id
        ) else '[]'::jsonb end
      ) order by selected.created_at desc, selected.id desc)
      from selected
    ), '[]'::jsonb),
    'total_count', summarized.row_count,
    'total_paisa', summarized.total_paisa,
    'cash_paisa', summarized.cash_paisa,
    'cash_count', summarized.cash_count,
    'credit_paisa', summarized.credit_paisa,
    'credit_count', summarized.credit_count,
    'page', v_page,
    'page_size', case when p_export then null else v_page_size end
  )
  into v_result
  from summarized;

  return v_result;
end;
$function$;

create or replace function public.purchase_detail(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
begin
  if auth.uid() is null
     or not public.has_any_permission(array['purchase_history']::text[])
     or not public.can_view_cost() then
    raise exception 'You do not have permission to view purchase history';
  end if;
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;


  select jsonb_build_object(
    'id', p.id,
    'pr_no', p.pr_no,
    'supplier_name', s.name,
    'supplier_contact', s.contact,
    'supplier_address', s.address,
    'invoice_number', p.invoice_number,
    'purchase_date', p.purchase_date,
    'subtotal_paisa', p.subtotal_paisa,
    'discount_paisa', p.discount_paisa,
    'total_paisa', p.total_paisa,
    'paid_paisa', p.paid_paisa,
    'due_paisa', greatest(p.total_paisa - p.paid_paisa, 0),
    'payment_type', p.payment_type,
    'status', p.status,
    'notes', p.notes,
    'void_reason', p.void_reason,
    'created_by', coalesce(profile.username, profile.full_name, 'Unknown'),
    'created_at', p.created_at,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'medicine_id', pi.medicine_id,
        'product_name', m.brand_name,
        'generic_name', m.generic_name,
        'unit_name', mu.name,
        'batch_number', pi.batch_number,
        'expiry_date', pi.expiry_date,
        'quantity', pi.quantity,
        'bonus_qty', pi.bonus_qty,
        'conversion_factor', pi.conversion_factor,
        'unit_cost_paisa', pi.unit_cost_paisa,
        'mrp_paisa', pi.mrp_paisa,
        'line_total_paisa', pi.line_total_paisa
      ) order by pi.created_at, pi.id), '[]'::jsonb)
      from public.purchase_items pi
      join public.medicines m on m.id=pi.medicine_id and m.shop_id=v_shop_id
      join public.medicine_units mu on mu.id=pi.unit_id and mu.shop_id=v_shop_id
      where pi.purchase_id=p.id and pi.shop_id=v_shop_id
    )
  )
  into v_result
  from public.purchases p
  join public.suppliers s on s.id=p.supplier_id and s.shop_id=v_shop_id
  left join public.profiles profile on profile.id = p.created_by
    and profile.shop_id = v_shop_id
  where p.id=p_purchase_id and p.shop_id=v_shop_id;

  if v_result is null then raise exception 'Purchase not found'; end if;
  return v_result;
end;
$function$;

create or replace function public.void_purchase(p_purchase_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_purchase public.purchases%rowtype;
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_item record;
  v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if not public.can_view_cost() then
    raise exception 'You do not have permission to void purchases';
  end if;
  select exists (
    select 1 from public.profiles
    where id=v_actor and shop_id=v_shop_id and role in ('admin','super_admin') and is_active and deleted_at is null
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Only an active admin can void purchases'; end if;
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=v_actor AND profile.shop_id=v_shop_id AND profile.role<>'super_admin' AND profile.is_active AND profile.deleted_at IS NULL) THEN RAISE EXCEPTION 'An active shop user is required'; END IF;

  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required to void a purchase'; end if;

  select * into v_purchase from public.purchases where id=p_purchase_id and shop_id=v_shop_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  if v_purchase.status <> 'posted' then raise exception 'Only posted purchases can be voided'; end if;
  if not exists (select 1 from public.purchase_items where purchase_id=p_purchase_id and shop_id=v_shop_id)
     or exists (
       select 1 from public.purchase_items
       where purchase_id=p_purchase_id and shop_id=v_shop_id and stock_batch_id is null
     ) then
    raise exception 'Purchase stock batch records are incomplete; this purchase cannot be safely voided';
  end if;

  for v_item in
    select pi.stock_batch_id, sb.quantity_remaining, sb.quantity_received
    from public.purchase_items pi
    join public.stock_batches sb on sb.id=pi.stock_batch_id and sb.shop_id=v_shop_id
    where pi.purchase_id = p_purchase_id and pi.shop_id = v_shop_id
    for update of sb
  loop
    if v_item.quantity_remaining <> v_item.quantity_received
       or exists (
         select 1 from public.stock_movements sm
         where sm.batch_id=v_item.stock_batch_id and sm.shop_id=v_shop_id
           and sm.movement_type <> 'RECEIPT'
       ) then
      raise exception 'Stock from this purchase has already been sold. Use a purchase return instead.';
    end if;
  end loop;

  for v_item in
    select pi.stock_batch_id, sb.quantity_remaining
    from public.purchase_items pi
    join public.stock_batches sb on sb.id = pi.stock_batch_id and sb.shop_id = v_shop_id
    where pi.purchase_id = p_purchase_id and pi.shop_id = v_shop_id
    for update of sb
  loop
    update public.stock_batches
    set quantity_remaining = 0
    where id=v_item.stock_batch_id and shop_id=v_shop_id;

    insert into public.stock_movements (
      shop_id, batch_id, movement_type, quantity_delta, reference_id, reason, created_by
    )
    values (
      v_shop_id, v_item.stock_batch_id, 'RECEIPT', -v_item.quantity_remaining,
      p_purchase_id, 'Void ' || v_purchase.pr_no || ': ' || trim(p_reason), auth.uid()
    );
  end loop;

  if v_purchase.payment_type = 'credit' and v_purchase.total_paisa > v_purchase.paid_paisa then
    update public.suppliers
    set payable_balance_paisa = payable_balance_paisa - (v_purchase.total_paisa - v_purchase.paid_paisa)
    where id=v_purchase.supplier_id and shop_id=v_shop_id;

    insert into public.supplier_ledger (
      shop_id, supplier_id, purchase_id, entry_type, amount_paisa, description, created_by
    )
    values (
      v_shop_id, v_purchase.supplier_id, v_purchase.id, 'void',
      -(v_purchase.total_paisa - v_purchase.paid_paisa),
      'Void ' || v_purchase.pr_no || ': ' || trim(p_reason), auth.uid()
    );
  end if;

  update public.purchases
  set status = 'void', void_reason = trim(p_reason)
  where id=p_purchase_id and shop_id=v_shop_id;
end;
$function$;

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

-- 043: scope the existing stock-alert summary; do not create stock_alerts_list().
-- Included by 051/052; do not run this source fragment by itself.
DO $preflight$ DECLARE o oid:=to_regprocedure('public.stock_alerts_summary(integer)'); BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Owner role with RLS bypass required'; END IF; IF (SELECT count(*) FROM public.medicines)<>13 OR (SELECT count(DISTINCT shop_id) FROM public.medicines)<>1 OR EXISTS(SELECT 1 FROM public.medicines WHERE shop_id IS NULL) OR to_regprocedure('public.stock_alerts_list()') IS NOT NULL THEN RAISE EXCEPTION 'Alert preflight differs; rerun 050'; END IF; IF o IS NULL OR NOT (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public']::text[] AND has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') FROM pg_catalog.pg_proc p WHERE p.oid=o) THEN RAISE EXCEPTION 'Alert RPC differs from reviewed security/grants'; END IF; END; $preflight$;
create or replace function public.stock_alerts_summary(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_shop_id uuid := tenant_private.current_shop_id();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_low_count bigint;
  v_out_count bigint;
  v_items jsonb;
begin
  if auth.uid() is null or v_shop_id is null or not exists (select 1 from public.profiles where id=auth.uid() and shop_id=v_shop_id and role<>'super_admin' and is_active and deleted_at is null) then
    raise exception 'An active user profile is required';
  end if;

  with medicine_stock as (
    select
      medicine.id as medicine_id,
      medicine.brand_name as name,
      medicine.strength,
      medicine.generic_name,
      medicine.min_stock_alert,
      coalesce(sum(batch.quantity_remaining) filter (
        where batch.quantity_remaining > 0
          and batch.expiry_date >= current_date
          and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
      ), 0)::bigint as stock
    from public.medicines medicine
    left join public.stock_batches batch on batch.medicine_id=medicine.id and batch.shop_id=v_shop_id
    where medicine.is_active and medicine.shop_id=v_shop_id
    group by medicine.id
  ),
  alerts as (
    select
      medicine_id,
      name,
      strength,
      generic_name,
      stock,
      min_stock_alert,
      case when stock = 0 then 'out' else 'low' end as kind
    from medicine_stock
    where min_stock_alert > 0
      and (
        stock = 0
        or (stock > 0 and stock <= min_stock_alert)
      )
  ),
  limited_alerts as (
    select *
    from alerts
    order by
      case when kind = 'out' then 0 else 1 end,
      min_stock_alert - stock desc,
      name
    limit v_limit
  ),
  alert_summary as (
    select
      count(*) filter (where kind = 'low') as low_count,
      count(*) filter (where kind = 'out') as out_count
    from alerts
  ),
  alert_items as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'medicine_id', medicine_id,
        'name', name,
        'strength', strength,
        'generic_name', generic_name,
        'stock', stock,
        'min_stock_alert', min_stock_alert,
        'kind', kind
      )
      order by
        case when kind = 'out' then 0 else 1 end,
        min_stock_alert - stock desc,
        name
    ), '[]'::jsonb) as items
    from limited_alerts
  )
  select alert_summary.low_count, alert_summary.out_count, alert_items.items
  into v_low_count, v_out_count, v_items
  from alert_summary cross join alert_items;

  return jsonb_build_object(
    'low_count', coalesce(v_low_count, 0),
    'out_count', coalesce(v_out_count, 0),
    'generated_at', now(),
    'items', v_items
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.stock_alerts_summary(integer) FROM PUBLIC,anon;

ROLLBACK;
