begin;

alter table public.purchases
  add column if not exists pr_no text,
  add column if not exists subtotal_paisa integer,
  add column if not exists discount_paisa integer not null default 0,
  add column if not exists payment_type text,
  add column if not exists void_reason text;

alter table public.purchase_items
  add column if not exists bonus_qty integer not null default 0;

alter table public.suppliers
  add column if not exists payable_balance_paisa integer not null default 0;

update public.purchase_items
set line_total_paisa = (quantity::numeric * unit_cost_paisa)::integer
where line_total_paisa is null;

with numbered_purchases as (
  select id, row_number() over (order by created_at, id) as row_number
  from public.purchases
  where pr_no is null
)
update public.purchases as purchase
set pr_no = 'PR-' || lpad(
  numbered_purchases.row_number::text,
  greatest(4, length(numbered_purchases.row_number::text)),
  '0'
)
from numbered_purchases
where purchase.id = numbered_purchases.id;

update public.purchases
set subtotal_paisa = coalesce(total_paisa, 0) + coalesce(discount_paisa, 0)
where subtotal_paisa is null;

update public.purchases
set payment_type = case
  when coalesce(paid_paisa, 0) >= coalesce(total_paisa, 0) then 'cash'
  else 'credit'
end
where payment_type is null;

alter table public.purchases
  alter column pr_no set not null,
  alter column subtotal_paisa set default 0,
  alter column subtotal_paisa set not null,
  alter column payment_type set default 'credit',
  alter column payment_type set not null;

alter table public.purchases
  drop constraint if exists purchases_status_check,
  drop constraint if exists purchases_payment_type_check,
  drop constraint if exists purchases_discount_paisa_check,
  drop constraint if exists purchases_subtotal_paisa_check;

alter table public.purchases
  add constraint purchases_payment_type_check
    check (payment_type in ('cash', 'credit')),
  add constraint purchases_discount_paisa_check
    check (discount_paisa >= 0),
  add constraint purchases_subtotal_paisa_check
    check (subtotal_paisa >= 0);

alter table public.purchase_items
  drop constraint if exists purchase_items_bonus_qty_check;

alter table public.purchase_items
  add constraint purchase_items_bonus_qty_check check (bonus_qty >= 0);

alter table public.suppliers
  drop constraint if exists suppliers_payable_balance_paisa_check;

alter table public.suppliers
  add constraint suppliers_payable_balance_paisa_check check (payable_balance_paisa >= 0);

create unique index if not exists purchases_pr_no_key on public.purchases (pr_no);
create index if not exists purchases_purchase_date_created_at_idx
  on public.purchases (purchase_date desc, created_at desc);
create index if not exists purchase_items_purchase_id_idx
  on public.purchase_items (purchase_id);
create index if not exists stock_movements_reference_id_idx
  on public.stock_movements (reference_id);

create table if not exists public.purchase_number_state (
  id smallint primary key check (id = 1),
  last_number bigint not null check (last_number >= 0)
);

insert into public.purchase_number_state (id, last_number)
values (
  1,
  coalesce((
    select max(substring(pr_no from '^PR-([0-9]+)$')::bigint)
    from public.purchases
  ), 0)
)
on conflict (id) do update
set last_number = greatest(
  public.purchase_number_state.last_number,
  excluded.last_number
);
alter table public.purchase_number_state enable row level security;
revoke all on table public.purchase_number_state from public, anon, authenticated;

create table if not exists public.supplier_ledger (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  purchase_id uuid references public.purchases(id),
  entry_type text not null check (entry_type in ('purchase', 'void')),
  amount_paisa integer not null check (amount_paisa <> 0),
  description text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists supplier_ledger_supplier_created_at_idx
  on public.supplier_ledger (supplier_id, created_at desc);

update public.suppliers supplier
set payable_balance_paisa = coalesce((
  select sum(greatest(purchase.total_paisa - purchase.paid_paisa, 0))
  from public.purchases purchase
  where purchase.supplier_id = supplier.id
    and purchase.status = 'posted'
    and purchase.payment_type = 'credit'
), 0)::integer;

insert into public.supplier_ledger (
  supplier_id, purchase_id, entry_type, amount_paisa, description, created_by, created_at
)
select supplier_id, id, 'purchase',
  (total_paisa - paid_paisa),
  'Opening balance for purchase ' || pr_no,
  created_by,
  created_at
from public.purchases
where status = 'posted'
  and payment_type = 'credit'
  and total_paisa > paid_paisa;

alter table public.supplier_ledger enable row level security;
drop policy if exists "read by permission" on public.supplier_ledger;
drop policy if exists "supplier ledger read by purchase history" on public.supplier_ledger;
create policy "supplier ledger read by purchase history"
  on public.supplier_ledger for select to authenticated
  using (public.has_any_permission(array['purchase_history']::text[]));

drop policy if exists "read by permission" on public.purchases;
drop policy if exists "add by permission" on public.purchases;
drop policy if exists "edit by permission" on public.purchases;
drop policy if exists "admin can delete" on public.purchases;
create policy "purchase history read"
  on public.purchases for select to authenticated
  using (public.has_any_permission(array['purchase_history']::text[]));

drop policy if exists "read by permission" on public.purchase_items;
drop policy if exists "add by permission" on public.purchase_items;
drop policy if exists "edit by permission" on public.purchase_items;
drop policy if exists "admin can delete" on public.purchase_items;
create policy "purchase history items read"
  on public.purchase_items for select to authenticated
  using (public.has_any_permission(array['purchase_history']::text[]));

drop function if exists public.post_purchase(uuid, text, date, integer, text, jsonb);

create function public.post_purchase(
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
     or not public.has_any_permission(array['purchases']::text[]) then
    raise exception 'You do not have permission to post purchases';
  end if;

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

  perform 1 from public.suppliers where id = p_supplier_id and is_active for update;
  if not found then
    raise exception 'Select an active supplier';
  end if;

  update public.purchase_number_state
  set last_number = last_number + 1
  where id = 1
  returning last_number into v_next_number;
  if v_next_number is null then
    raise exception 'Purchase number counter is not initialized';
  end if;
  v_pr_no := 'PR-' || lpad(
    v_next_number::text,
    greatest(4, length(v_next_number::text)),
    '0'
  );

  insert into public.purchases (
    pr_no, supplier_id, invoice_number, purchase_date,
    subtotal_paisa, discount_paisa, total_paisa, paid_paisa,
    payment_type, payment_status, status, notes, created_by
  )
  values (
    v_pr_no, p_supplier_id, nullif(trim(p_invoice_number), ''), v_date,
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
    where id = v_unit_id and medicine_id = v_medicine_id;
    if v_factor is null then
      raise exception 'Purchase unit does not belong to the selected medicine';
    end if;

    v_base_qty := (v_qty::bigint + v_bonus::bigint) * v_factor;
    if v_base_qty > 2147483647 then raise exception 'Quantity exceeds the supported stock limit'; end if;
    v_subtotal := v_subtotal + (v_qty::bigint * v_unit_cost);
    if v_subtotal > 2147483647 then raise exception 'Purchase total exceeds the supported limit'; end if;

    insert into public.stock_batches (
      medicine_id, supplier_id, batch_number, expiry_date, received_date,
      cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
      quantity_received, quantity_remaining
    )
    values (
      v_medicine_id, p_supplier_id, v_batch_no, v_expiry, v_date,
      round(v_unit_cost::numeric / v_factor)::integer,
      round(v_mrp::numeric / v_factor)::integer,
      v_base_qty::integer, v_base_qty::integer
    )
    returning id into v_batch_id;

    insert into public.stock_movements (
      batch_id, movement_type, quantity_delta, reference_id, reason, created_by
    )
    values (
      v_batch_id, 'RECEIPT', v_base_qty::integer, v_purchase_id,
      'Purchase ' || v_pr_no, auth.uid()
    );

    insert into public.purchase_items (
      purchase_id, medicine_id, unit_id, batch_number, expiry_date,
      quantity, bonus_qty, conversion_factor, unit_cost_paisa,
      mrp_paisa, line_total_paisa, stock_batch_id
    )
    values (
      v_purchase_id, v_medicine_id, v_unit_id, v_batch_no, v_expiry,
      v_qty, v_bonus, v_factor, v_unit_cost, v_mrp,
      (v_qty::bigint * v_unit_cost)::integer, v_batch_id
    );
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
  where id = v_purchase_id;

  if p_payment_type = 'credit' and v_total > 0 then
    update public.suppliers
    set payable_balance_paisa = payable_balance_paisa + v_total::integer
    where id = p_supplier_id;

    insert into public.supplier_ledger (
      supplier_id, purchase_id, entry_type, amount_paisa, description, created_by
    )
    values (
      p_supplier_id, v_purchase_id, 'purchase', v_total::integer,
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
begin
  if auth.uid() is null
     or not public.has_any_permission(array['purchases']::text[]) then
    raise exception 'You do not have permission to create purchases';
  end if;

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
      where batch.medicine_id = medicine.id
    ), 0),
    'last_cost_base_paisa', coalesce((
      select batch.cost_paisa_per_base_unit
      from public.stock_batches batch
      where batch.medicine_id = medicine.id
      order by batch.created_at desc, batch.id desc
      limit 1
    ), 0),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', unit.id,
        'name', unit.name,
        'conversion_factor', unit.conversion_factor,
        'is_default_sale_unit', unit.is_default_sale_unit,
        'price_paisa', unit.price_paisa
      ) order by unit.is_default_sale_unit desc, unit.name)
      from public.medicine_units unit
      where unit.medicine_id = medicine.id
    ), '[]'::jsonb)
  ) order by medicine.brand_name), '[]'::jsonb)
  into v_catalog
  from public.medicines medicine
  where medicine.is_active;

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
  v_search text := nullif(trim(p_search), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
begin
  if auth.uid() is null
     or not public.has_any_permission(array['purchase_history']::text[]) then
    raise exception 'You do not have permission to view purchase history';
  end if;
  if p_payment_type is not null and p_payment_type not in ('cash', 'credit') then
    raise exception 'Payment filter must be cash or credit';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'Start date must not be after end date';
  end if;

  with filtered as (
    select p.*, s.name as supplier_name,
      coalesce(profile.username, profile.full_name, 'Unknown') as creator_name,
      (select count(*) from public.purchase_items pi where pi.purchase_id = p.id) as item_count
    from public.purchases p
    join public.suppliers s on s.id = p.supplier_id
    left join public.profiles profile on profile.id = p.created_by
    where (v_search is null or p.pr_no ilike '%' || v_search || '%' or s.name ilike '%' || v_search || '%')
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
          join public.medicines m on m.id = pi.medicine_id
          join public.medicine_units mu on mu.id = pi.unit_id
          where pi.purchase_id = selected.id
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
begin
  if auth.uid() is null
     or not public.has_any_permission(array['purchase_history']::text[]) then
    raise exception 'You do not have permission to view purchase history';
  end if;

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
      join public.medicines m on m.id = pi.medicine_id
      join public.medicine_units mu on mu.id = pi.unit_id
      where pi.purchase_id = p.id
    )
  )
  into v_result
  from public.purchases p
  join public.suppliers s on s.id = p.supplier_id
  left join public.profiles profile on profile.id = p.created_by
  where p.id = p_purchase_id;

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
  v_item record;
  v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'super_admin') and is_active and deleted_at is null
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Only an active admin can void purchases'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required to void a purchase'; end if;

  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  if v_purchase.status <> 'posted' then raise exception 'Only posted purchases can be voided'; end if;
  if not exists (select 1 from public.purchase_items where purchase_id = p_purchase_id)
     or exists (
       select 1 from public.purchase_items
       where purchase_id = p_purchase_id and stock_batch_id is null
     ) then
    raise exception 'Purchase stock batch records are incomplete; this purchase cannot be safely voided';
  end if;

  for v_item in
    select pi.stock_batch_id, sb.quantity_remaining, sb.quantity_received
    from public.purchase_items pi
    join public.stock_batches sb on sb.id = pi.stock_batch_id
    where pi.purchase_id = p_purchase_id
    for update of sb
  loop
    if v_item.quantity_remaining <> v_item.quantity_received
       or exists (
         select 1 from public.stock_movements sm
         where sm.batch_id = v_item.stock_batch_id
           and sm.movement_type <> 'RECEIPT'
       ) then
      raise exception 'Stock from this purchase has already been sold. Use a purchase return instead.';
    end if;
  end loop;

  for v_item in
    select pi.stock_batch_id, sb.quantity_remaining
    from public.purchase_items pi
    join public.stock_batches sb on sb.id = pi.stock_batch_id
    where pi.purchase_id = p_purchase_id
    for update of sb
  loop
    update public.stock_batches
    set quantity_remaining = 0
    where id = v_item.stock_batch_id;

    insert into public.stock_movements (
      batch_id, movement_type, quantity_delta, reference_id, reason, created_by
    )
    values (
      v_item.stock_batch_id, 'RECEIPT', -v_item.quantity_remaining,
      p_purchase_id, 'Void ' || v_purchase.pr_no || ': ' || trim(p_reason), auth.uid()
    );
  end loop;

  if v_purchase.payment_type = 'credit' and v_purchase.total_paisa > v_purchase.paid_paisa then
    update public.suppliers
    set payable_balance_paisa = payable_balance_paisa - (v_purchase.total_paisa - v_purchase.paid_paisa)
    where id = v_purchase.supplier_id;

    insert into public.supplier_ledger (
      supplier_id, purchase_id, entry_type, amount_paisa, description, created_by
    )
    values (
      v_purchase.supplier_id, v_purchase.id, 'void',
      -(v_purchase.total_paisa - v_purchase.paid_paisa),
      'Void ' || v_purchase.pr_no || ': ' || trim(p_reason), auth.uid()
    );
  end if;

  update public.purchases
  set status = 'void', void_reason = trim(p_reason)
  where id = p_purchase_id;
end;
$function$;

revoke all on function public.post_purchase(uuid, text, date, integer, text, jsonb, integer, text) from public;
revoke all on function public.purchase_catalog() from public;
revoke all on function public.purchase_history(text, text, date, date, integer, integer, boolean) from public;
revoke all on function public.purchase_detail(uuid) from public;
revoke all on function public.void_purchase(uuid, text) from public;
grant execute on function public.post_purchase(uuid, text, date, integer, text, jsonb, integer, text) to authenticated;
grant execute on function public.purchase_catalog() to authenticated;
grant execute on function public.purchase_history(text, text, date, date, integer, integer, boolean) to authenticated;
grant execute on function public.purchase_detail(uuid) to authenticated;
grant execute on function public.void_purchase(uuid, text) to authenticated;

commit;
