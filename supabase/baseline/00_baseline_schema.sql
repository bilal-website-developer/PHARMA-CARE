-- BASELINE REFERENCE. Already applied on the live project. Do not run on it. Use only to create a new empty project.
-- Reconstructed from the supplied schema_export summary. The supplied export does not include
-- grants, triggers, views, extensions, or all database metadata; verify those separately before
-- using this as an executable bootstrap for a new project.
-- The purchase migration must be applied after this baseline for the current purchase UI schema.

create table public.profiles (
  id uuid not null,
  full_name text not null,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  username text,
  email text,
  permissions text[] not null default '{}'::text[],
  deleted_at timestamptz,
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade,
  constraint profiles_role_check check (role = any (array['cashier','manager','accountant','admin','super_admin']::text[])),
  constraint profiles_permissions_valid check (permissions <@ array['pos','products','categories','suppliers','customers','sales_history','purchase_history','purchases','expenses','stock_inventory','reports']::text[])
);

create table public.customers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  phone text not null default ''::text,
  address text not null default ''::text,
  cnic text,
  credit_limit_paisa integer not null default 0,
  current_balance_paisa integer not null default 0,
  created_at timestamptz not null default now(),
  constraint customers_pkey primary key (id),
  constraint customers_credit_limit_paisa_check check (credit_limit_paisa >= 0),
  constraint customers_current_balance_paisa_check check (current_balance_paisa >= 0)
);

create table public.suppliers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  contact text not null default ''::text,
  address text not null default ''::text,
  licence_or_tax_number text not null default ''::text,
  payment_terms text not null default 'CASH'::text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint suppliers_pkey primary key (id)
);

create table public.medicines (
  id uuid not null default gen_random_uuid(),
  code text not null,
  barcode text,
  brand_name text not null,
  generic_name text not null default ''::text,
  category text not null default ''::text,
  company text not null default ''::text,
  drug_class text not null,
  storage_condition text not null default 'ROOM_TEMPERATURE'::text,
  rack_location text not null default ''::text,
  min_stock_alert integer not null default 0,
  requires_prescription boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint medicines_pkey primary key (id),
  constraint medicines_code_key unique (code),
  constraint medicines_drug_class_check check (drug_class = any (array['OTC','RX','CONTROLLED','NARCOTIC']::text[])),
  constraint medicines_min_stock_alert_check check (min_stock_alert >= 0),
  constraint medicines_storage_condition_check check (storage_condition = any (array['ROOM_TEMPERATURE','COOL','COLD_REFRIGERATED']::text[]))
);

create table public.medicine_units (
  id uuid not null default gen_random_uuid(),
  medicine_id uuid not null,
  name text not null,
  conversion_factor integer not null,
  is_default_sale_unit boolean not null default false,
  price_paisa integer not null default 0,
  barcode text,
  constraint medicine_units_pkey primary key (id),
  constraint medicine_units_medicine_id_fkey foreign key (medicine_id) references public.medicines(id),
  constraint medicine_units_medicine_id_name_key unique (medicine_id, name),
  constraint medicine_units_conversion_factor_check check (conversion_factor > 0),
  constraint medicine_units_price_paisa_check check (price_paisa >= 0)
);

create table public.purchases (
  id uuid not null default gen_random_uuid(),
  supplier_id uuid not null,
  invoice_number text,
  purchase_date date not null default current_date,
  total_paisa integer not null default 0,
  paid_paisa integer not null default 0,
  payment_status text not null default 'unpaid'::text,
  status text not null default 'posted'::text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint purchases_pkey primary key (id),
  constraint purchases_supplier_id_fkey foreign key (supplier_id) references public.suppliers(id),
  constraint purchases_paid_paisa_check check (paid_paisa >= 0),
  constraint purchases_payment_status_check check (payment_status = any (array['unpaid','partial','paid']::text[])),
  constraint purchases_status_check check (status = any (array['posted','cancelled']::text[])),
  constraint purchases_total_paisa_check check (total_paisa >= 0)
);

create table public.stock_batches (
  id uuid not null default gen_random_uuid(),
  medicine_id uuid not null,
  supplier_id uuid,
  batch_number text not null,
  expiry_date date not null,
  received_date date not null default current_date,
  cost_paisa_per_base_unit integer not null,
  mrp_paisa_per_base_unit integer not null,
  quantity_received integer not null,
  quantity_remaining integer not null,
  status text not null default 'ACTIVE'::text,
  created_at timestamptz not null default now(),
  constraint stock_batches_pkey primary key (id),
  constraint stock_batches_medicine_id_fkey foreign key (medicine_id) references public.medicines(id),
  constraint stock_batches_supplier_id_fkey foreign key (supplier_id) references public.suppliers(id),
  constraint stock_batches_check check (quantity_remaining <= quantity_received),
  constraint stock_batches_cost_paisa_per_base_unit_check check (cost_paisa_per_base_unit >= 0),
  constraint stock_batches_mrp_paisa_per_base_unit_check check (mrp_paisa_per_base_unit >= 0),
  constraint stock_batches_quantity_received_check check (quantity_received >= 0),
  constraint stock_batches_quantity_remaining_check check (quantity_remaining >= 0),
  constraint stock_batches_status_check check (status = any (array['ACTIVE','NEAR_EXPIRY','EXPIRED','QUARANTINE','DAMAGED','RETURNED','RECALLED','SOLD_OUT']::text[]))
);

create table public.sales (
  id uuid not null default gen_random_uuid(),
  invoice_number text not null,
  cashier_id uuid,
  cashier_name text not null,
  customer_id uuid,
  customer_name text not null default 'Walk-in Customer'::text,
  "timestamp" timestamptz not null default now(),
  subtotal_paisa integer not null,
  discount_paisa integer not null default 0,
  total_paisa integer not null,
  status text not null default 'COMPLETED'::text,
  created_at timestamptz not null default now(),
  constraint sales_pkey primary key (id),
  constraint sales_invoice_number_key unique (invoice_number),
  constraint sales_cashier_id_fkey foreign key (cashier_id) references public.profiles(id) on delete set null,
  constraint sales_customer_id_fkey foreign key (customer_id) references public.customers(id) on delete set null,
  constraint sales_discount_paisa_check check (discount_paisa >= 0),
  constraint sales_status_check check (status = any (array['COMPLETED','VOIDED','PARTIALLY_RETURNED','RETURNED']::text[])),
  constraint sales_subtotal_paisa_check check (subtotal_paisa >= 0),
  constraint sales_total_paisa_check check (total_paisa >= 0)
);

create table public.sale_items (
  id uuid not null default gen_random_uuid(),
  sale_id uuid not null,
  medicine_id uuid not null,
  product_name text not null,
  generic_name text not null default ''::text,
  unit_name text not null,
  conversion_factor integer not null,
  quantity_in_unit integer not null,
  quantity_base_units integer not null,
  price_paisa_per_unit integer not null,
  cost_paisa_per_base_unit integer not null,
  discount_percent numeric not null default 0,
  line_total_paisa integer not null,
  created_at timestamptz not null default now(),
  constraint sale_items_pkey primary key (id),
  constraint sale_items_medicine_id_fkey foreign key (medicine_id) references public.medicines(id),
  constraint sale_items_sale_id_fkey foreign key (sale_id) references public.sales(id),
  constraint sale_items_conversion_factor_check check (conversion_factor > 0),
  constraint sale_items_cost_paisa_per_base_unit_check check (cost_paisa_per_base_unit >= 0),
  constraint sale_items_discount_percent_check check (discount_percent >= 0 and discount_percent <= 100),
  constraint sale_items_line_total_paisa_check check (line_total_paisa >= 0),
  constraint sale_items_price_paisa_per_unit_check check (price_paisa_per_unit >= 0),
  constraint sale_items_quantity_base_units_check check (quantity_base_units > 0),
  constraint sale_items_quantity_in_unit_check check (quantity_in_unit > 0)
);

create table public.sale_item_batch_allocations (
  id uuid not null default gen_random_uuid(),
  sale_item_id uuid not null,
  batch_id uuid not null,
  quantity_base_units integer not null,
  cost_paisa_per_base_unit integer not null,
  batch_number text not null,
  expiry_date date not null,
  constraint sale_item_batch_allocations_pkey primary key (id),
  constraint sale_item_batch_allocations_batch_id_fkey foreign key (batch_id) references public.stock_batches(id),
  constraint sale_item_batch_allocations_sale_item_id_fkey foreign key (sale_item_id) references public.sale_items(id),
  constraint sale_item_batch_allocations_cost_paisa_per_base_unit_check check (cost_paisa_per_base_unit >= 0),
  constraint sale_item_batch_allocations_quantity_base_units_check check (quantity_base_units > 0)
);

create table public.sale_payments (
  id uuid not null default gen_random_uuid(),
  sale_id uuid not null,
  payment_method text not null,
  amount_paisa integer not null,
  created_at timestamptz not null default now(),
  constraint sale_payments_pkey primary key (id),
  constraint sale_payments_sale_id_fkey foreign key (sale_id) references public.sales(id),
  constraint sale_payments_amount_paisa_check check (amount_paisa >= 0),
  constraint sale_payments_payment_method_check check (payment_method = any (array['CASH','CARD','EASYPAISA','JAZZCASH','CREDIT']::text[]))
);

create table public.purchase_items (
  id uuid not null default gen_random_uuid(),
  purchase_id uuid not null,
  medicine_id uuid not null,
  unit_id uuid not null,
  batch_number text not null,
  expiry_date date not null,
  quantity integer not null,
  conversion_factor integer not null,
  unit_cost_paisa integer not null,
  mrp_paisa integer not null,
  line_total_paisa integer,
  stock_batch_id uuid,
  created_at timestamptz not null default now(),
  constraint purchase_items_pkey primary key (id),
  constraint purchase_items_medicine_id_fkey foreign key (medicine_id) references public.medicines(id),
  constraint purchase_items_purchase_id_fkey foreign key (purchase_id) references public.purchases(id) on delete cascade,
  constraint purchase_items_stock_batch_id_fkey foreign key (stock_batch_id) references public.stock_batches(id),
  constraint purchase_items_unit_id_fkey foreign key (unit_id) references public.medicine_units(id),
  constraint purchase_items_conversion_factor_check check (conversion_factor > 0),
  constraint purchase_items_mrp_paisa_check check (mrp_paisa >= 0),
  constraint purchase_items_quantity_check check (quantity > 0),
  constraint purchase_items_unit_cost_paisa_check check (unit_cost_paisa >= 0)
);

create table public.stock_movements (
  id uuid not null default gen_random_uuid(),
  batch_id uuid not null,
  movement_type text not null,
  quantity_delta integer not null,
  reference_id uuid,
  reason text not null default ''::text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint stock_movements_pkey primary key (id),
  constraint stock_movements_batch_id_fkey foreign key (batch_id) references public.stock_batches(id),
  constraint stock_movements_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null,
  constraint stock_movements_movement_type_check check (movement_type = any (array['RECEIPT','SALE','SALE_RETURN','ADJUSTMENT','WRITE_OFF','PURCHASE_RETURN']::text[])),
  constraint stock_movements_quantity_delta_check check (quantity_delta <> 0)
);

create table public.khata_entries (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  sale_id uuid,
  entry_type text not null,
  reference_number text not null default ''::text,
  description text not null default ''::text,
  debit_paisa integer not null default 0,
  credit_paisa integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint khata_entries_pkey primary key (id),
  constraint khata_entries_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null,
  constraint khata_entries_customer_id_fkey foreign key (customer_id) references public.customers(id),
  constraint khata_entries_sale_id_fkey foreign key (sale_id) references public.sales(id),
  constraint khata_entries_credit_paisa_check check (credit_paisa >= 0),
  constraint khata_entries_debit_paisa_check check (debit_paisa >= 0),
  constraint khata_entries_entry_type_check check (entry_type = any (array['INVOICE','PAYMENT','RETURN','ADJUSTMENT']::text[]))
);

create index khata_entries_customer_created_idx on public.khata_entries using btree (customer_id, created_at);
create unique index profiles_username_unique on public.profiles using btree (lower(username)) where deleted_at is null and username is not null;
create index purchase_items_medicine_idx on public.purchase_items using btree (medicine_id);
create index purchase_items_purchase_idx on public.purchase_items using btree (purchase_id);
create index purchases_date_idx on public.purchases using btree (purchase_date);
create index purchases_supplier_idx on public.purchases using btree (supplier_id);
create index sale_items_sale_id_idx on public.sale_items using btree (sale_id);
create index sales_timestamp_idx on public.sales using btree ("timestamp");
create index stock_batches_medicine_expiry_idx on public.stock_batches using btree (medicine_id, expiry_date);
create index stock_movements_batch_created_idx on public.stock_movements using btree (batch_id, created_at);

create or replace function public.has_any_permission(perms text[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.deleted_at is null
      and (p.role = 'admin' or p.permissions && perms)
  );
$function$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and deleted_at is null
      and role = 'admin'
  );
$function$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and deleted_at is null
  );
$function$;

-- This is the function definition present in the supplied live export.
-- Its PURCHASE movement type conflicts with stock_movements_movement_type_check above.
-- The checked-in purchase migration replaces it with the current RECEIPT-based workflow.
create or replace function public.post_purchase(
  p_supplier_id uuid,
  p_invoice_number text,
  p_purchase_date date,
  p_paid_paisa integer,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_purchase_id uuid;
  v_item jsonb;
  v_date date := coalesce(p_purchase_date, current_date);
  v_paid integer := coalesce(p_paid_paisa, 0);
  v_total integer := 0;
  v_medicine_id uuid;
  v_unit_id uuid;
  v_factor integer;
  v_qty integer;
  v_unit_cost integer;
  v_mrp integer;
  v_expiry date;
  v_batch_no text;
  v_base_qty integer;
  v_batch_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A purchase needs at least one item';
  end if;
  if v_paid < 0 then
    raise exception 'Paid amount cannot be negative';
  end if;
  insert into purchases (supplier_id, invoice_number, purchase_date, notes)
  values (p_supplier_id, nullif(trim(p_invoice_number), ''), v_date, p_notes)
  returning id into v_purchase_id;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_medicine_id := (v_item->>'medicine_id')::uuid;
    v_unit_id := (v_item->>'unit_id')::uuid;
    v_batch_no := trim(v_item->>'batch_number');
    v_expiry := (v_item->>'expiry_date')::date;
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := (v_item->>'unit_cost_paisa')::integer;
    v_mrp := (v_item->>'mrp_paisa')::integer;
    if v_batch_no is null or v_batch_no = '' then
      raise exception 'Batch number is required';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity must be greater than zero (batch %)', v_batch_no;
    end if;
    if v_unit_cost is null or v_unit_cost < 0 or v_mrp is null or v_mrp < 0 then
      raise exception 'Cost and MRP are required and cannot be negative (batch %)', v_batch_no;
    end if;
    if v_expiry is null or v_expiry <= v_date then
      raise exception 'Batch % is already expired or has no expiry date', v_batch_no;
    end if;
    select conversion_factor into v_factor
    from medicine_units where id = v_unit_id and medicine_id = v_medicine_id;
    if v_factor is null then
      raise exception 'Unit does not belong to this medicine (batch %)', v_batch_no;
    end if;
    v_base_qty := v_qty * v_factor;
    insert into stock_batches (
      medicine_id, supplier_id, batch_number, expiry_date, received_date,
      cost_paisa_per_base_unit, mrp_paisa_per_base_unit, quantity_received, quantity_remaining
    ) values (
      v_medicine_id, p_supplier_id, v_batch_no, v_expiry, v_date,
      round(v_unit_cost::numeric / v_factor)::integer,
      round(v_mrp::numeric / v_factor)::integer, v_base_qty, v_base_qty
    ) returning id into v_batch_id;
    insert into stock_movements (
      batch_id, movement_type, quantity_delta, reference_id, reason, created_by
    ) values (
      v_batch_id, 'PURCHASE', v_base_qty, v_purchase_id,
      'Purchase ' || coalesce(nullif(trim(p_invoice_number), ''), ''), auth.uid()
    );
    insert into purchase_items (
      purchase_id, medicine_id, unit_id, batch_number, expiry_date,
      quantity, conversion_factor, unit_cost_paisa, mrp_paisa, stock_batch_id
    ) values (
      v_purchase_id, v_medicine_id, v_unit_id, v_batch_no, v_expiry,
      v_qty, v_factor, v_unit_cost, v_mrp, v_batch_id
    );
    v_total := v_total + (v_qty * v_unit_cost);
  end loop;
  if v_paid > v_total then
    raise exception 'Paid amount is more than the purchase total';
  end if;
  update purchases
  set total_paisa = v_total,
      paid_paisa = v_paid,
      payment_status = case when v_paid = 0 then 'unpaid'
                            when v_paid >= v_total then 'paid' else 'partial' end
  where id = v_purchase_id;
  return v_purchase_id;
end;
$function$;

alter table public.customers enable row level security;
alter table public.khata_entries enable row level security;
alter table public.medicine_units enable row level security;
alter table public.medicines enable row level security;
alter table public.profiles enable row level security;
alter table public.purchase_items enable row level security;
alter table public.purchases enable row level security;
alter table public.sale_item_batch_allocations enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.sales enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.suppliers enable row level security;

create policy "customers add by permission" on public.customers for insert to authenticated
  with check (public.has_any_permission(array['customers','pos']::text[]));
create policy "customers admin can delete" on public.customers for delete to authenticated
  using (public.is_admin());
create policy "customers edit by permission" on public.customers for update to authenticated
  using (public.has_any_permission(array['customers','pos']::text[]))
  with check (public.has_any_permission(array['customers','pos']::text[]));
create policy "customers read by permission" on public.customers for select to authenticated
  using (public.has_any_permission(array['customers','pos','sales_history','reports']::text[]));

create policy "khata_entries add by permission" on public.khata_entries for insert to authenticated
  with check (public.has_any_permission(array['customers','pos']::text[]));
create policy "khata_entries admin can delete" on public.khata_entries for delete to authenticated
  using (public.is_admin());
create policy "khata_entries edit by permission" on public.khata_entries for update to authenticated
  using (public.has_any_permission(array[]::text[]))
  with check (public.has_any_permission(array[]::text[]));
create policy "khata_entries read by permission" on public.khata_entries for select to authenticated
  using (public.has_any_permission(array['customers','pos','reports']::text[]));

create policy "medicine_units add by permission" on public.medicine_units for insert to authenticated
  with check (public.has_any_permission(array['products']::text[]));
create policy "medicine_units admin can delete" on public.medicine_units for delete to authenticated
  using (public.is_admin());
create policy "medicine_units edit by permission" on public.medicine_units for update to authenticated
  using (public.has_any_permission(array['products']::text[]))
  with check (public.has_any_permission(array['products']::text[]));
create policy "medicine_units read by permission" on public.medicine_units for select to authenticated
  using (public.has_any_permission(array['pos','products','categories','suppliers','customers','sales_history','purchase_history','purchases','expenses','stock_inventory','reports']::text[]));

create policy "medicines add by permission" on public.medicines for insert to authenticated
  with check (public.has_any_permission(array['products']::text[]));
create policy "medicines admin can delete" on public.medicines for delete to authenticated
  using (public.is_admin());
create policy "medicines edit by permission" on public.medicines for update to authenticated
  using (public.has_any_permission(array['products']::text[]))
  with check (public.has_any_permission(array['products']::text[]));
create policy "medicines read by permission" on public.medicines for select to authenticated
  using (public.has_any_permission(array['pos','products','categories','suppliers','customers','sales_history','purchase_history','purchases','expenses','stock_inventory','reports']::text[]));

create policy "profiles admin can add profiles" on public.profiles for insert to authenticated
  with check (public.is_admin());
create policy "profiles admin can delete profiles" on public.profiles for delete to authenticated
  using (public.is_admin());
create policy "profiles admin can edit profiles" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "profiles read own profile or admin reads all" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "purchase_items add by permission" on public.purchase_items for insert to authenticated
  with check (public.has_any_permission(array['purchases']::text[]));
create policy "purchase_items admin can delete" on public.purchase_items for delete to authenticated
  using (public.is_admin());
create policy "purchase_items edit by permission" on public.purchase_items for update to authenticated
  using (public.has_any_permission(array['purchases']::text[]))
  with check (public.has_any_permission(array['purchases']::text[]));
create policy "purchase_items read by permission" on public.purchase_items for select to authenticated
  using (public.has_any_permission(array['purchases','purchase_history','reports']::text[]));

create policy "purchases add by permission" on public.purchases for insert to authenticated
  with check (public.has_any_permission(array['purchases']::text[]));
create policy "purchases admin can delete" on public.purchases for delete to authenticated
  using (public.is_admin());
create policy "purchases edit by permission" on public.purchases for update to authenticated
  using (public.has_any_permission(array['purchases']::text[]))
  with check (public.has_any_permission(array['purchases']::text[]));
create policy "purchases read by permission" on public.purchases for select to authenticated
  using (public.has_any_permission(array['purchases','purchase_history','reports']::text[]));

create policy "sale_item_batch_allocations add by permission" on public.sale_item_batch_allocations for insert to authenticated
  with check (public.has_any_permission(array['pos']::text[]));
create policy "sale_item_batch_allocations admin can delete" on public.sale_item_batch_allocations for delete to authenticated
  using (public.is_admin());
create policy "sale_item_batch_allocations edit by permission" on public.sale_item_batch_allocations for update to authenticated
  using (public.has_any_permission(array['pos']::text[]))
  with check (public.has_any_permission(array['pos']::text[]));
create policy "sale_item_batch_allocations read by permission" on public.sale_item_batch_allocations for select to authenticated
  using (public.has_any_permission(array['pos','sales_history','reports']::text[]));

create policy "sale_items add by permission" on public.sale_items for insert to authenticated
  with check (public.has_any_permission(array['pos']::text[]));
create policy "sale_items admin can delete" on public.sale_items for delete to authenticated
  using (public.is_admin());
create policy "sale_items edit by permission" on public.sale_items for update to authenticated
  using (public.has_any_permission(array['pos']::text[]))
  with check (public.has_any_permission(array['pos']::text[]));
create policy "sale_items read by permission" on public.sale_items for select to authenticated
  using (public.has_any_permission(array['pos','sales_history','reports']::text[]));

create policy "sale_payments add by permission" on public.sale_payments for insert to authenticated
  with check (public.has_any_permission(array['pos']::text[]));
create policy "sale_payments admin can delete" on public.sale_payments for delete to authenticated
  using (public.is_admin());
create policy "sale_payments edit by permission" on public.sale_payments for update to authenticated
  using (public.has_any_permission(array['pos']::text[]))
  with check (public.has_any_permission(array['pos']::text[]));
create policy "sale_payments read by permission" on public.sale_payments for select to authenticated
  using (public.has_any_permission(array['pos','sales_history','reports']::text[]));

create policy "sales add by permission" on public.sales for insert to authenticated
  with check (public.has_any_permission(array['pos']::text[]));
create policy "sales admin can delete" on public.sales for delete to authenticated
  using (public.is_admin());
create policy "sales edit by permission" on public.sales for update to authenticated
  using (public.has_any_permission(array['pos']::text[]))
  with check (public.has_any_permission(array['pos']::text[]));
create policy "sales read by permission" on public.sales for select to authenticated
  using (public.has_any_permission(array['pos','sales_history','reports']::text[]));

create policy "stock_batches add by permission" on public.stock_batches for insert to authenticated
  with check (public.has_any_permission(array['purchases','stock_inventory']::text[]));
create policy "stock_batches admin can delete" on public.stock_batches for delete to authenticated
  using (public.is_admin());
create policy "stock_batches edit by permission" on public.stock_batches for update to authenticated
  using (public.has_any_permission(array['pos','purchases','stock_inventory']::text[]))
  with check (public.has_any_permission(array['pos','purchases','stock_inventory']::text[]));
create policy "stock_batches read by permission" on public.stock_batches for select to authenticated
  using (public.has_any_permission(array['stock_inventory','pos','purchases','purchase_history','products','reports']::text[]));

create policy "stock_movements add by permission" on public.stock_movements for insert to authenticated
  with check (public.has_any_permission(array['pos','purchases','stock_inventory']::text[]));
create policy "stock_movements admin can delete" on public.stock_movements for delete to authenticated
  using (public.is_admin());
create policy "stock_movements edit by permission" on public.stock_movements for update to authenticated
  using (public.has_any_permission(array[]::text[]))
  with check (public.has_any_permission(array[]::text[]));
create policy "stock_movements read by permission" on public.stock_movements for select to authenticated
  using (public.has_any_permission(array['stock_inventory','reports']::text[]));

create policy "suppliers add by permission" on public.suppliers for insert to authenticated
  with check (public.has_any_permission(array['suppliers']::text[]));
create policy "suppliers admin can delete" on public.suppliers for delete to authenticated
  using (public.is_admin());
create policy "suppliers edit by permission" on public.suppliers for update to authenticated
  using (public.has_any_permission(array['suppliers']::text[]))
  with check (public.has_any_permission(array['suppliers']::text[]));
create policy "suppliers read by permission" on public.suppliers for select to authenticated
  using (public.has_any_permission(array['suppliers','purchases','purchase_history','reports']::text[]));
