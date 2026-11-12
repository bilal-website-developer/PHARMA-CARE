-- S4 additive schema stage.
-- Adds per-shop unique indexes and same-shop composite foreign keys while
-- preserving all existing global indexes and single-column foreign keys.
-- New composite FKs are NOT VALID until the separate validation stage.

BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

LOCK TABLE
  public.audit_logs,
  public.brands,
  public.categories,
  public.customers,
  public.khata_entries,
  public.medicine_units,
  public.medicines,
  public.profiles,
  public.print_requests,
  public.purchase_items,
  public.purchase_number_state,
  public.purchases,
  public.return_policy_settings,
  public.sale_item_batch_allocations,
  public.sale_items,
  public.sale_payments,
  public.sale_return_items,
  public.sale_returns,
  public.sales,
  public.stock_batches,
  public.stock_movements,
  public.supplier_ledger,
  public.suppliers,
  public.trash_bin_events
IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_table text;
  v_unassigned boolean;
  v_tables text[] := ARRAY[
    'brands', 'categories', 'customers', 'khata_entries',
    'medicine_units', 'medicines', 'print_requests', 'purchase_items',
    'purchase_number_state', 'purchases', 'return_policy_settings',
    'sale_item_batch_allocations', 'sale_items', 'sale_payments',
    'sale_return_items', 'sale_returns', 'sales', 'stock_batches',
    'stock_movements', 'supplier_ledger', 'suppliers'
  ];
  v_new_objects text[] := ARRAY[
    'brands_shop_name_lower_key',
    'categories_shop_name_lower_key',
    'medicines_shop_code_key',
    'medicines_shop_barcode_unique',
    'purchases_shop_pr_no_key',
    'sales_shop_invoice_number_key',
    'customers_shop_id_id_key',
    'sales_shop_id_id_key',
    'medicines_shop_id_id_key',
    'purchases_shop_id_id_key',
    'stock_batches_shop_id_id_key',
    'medicine_units_shop_id_id_key',
    'suppliers_shop_id_id_key',
    'sale_items_shop_id_id_key',
    'sale_item_batch_allocations_shop_id_id_key',
    'sale_returns_shop_id_id_key'
  ];
  v_object text;
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'PostgreSQL 15 or newer is required for column-specific SET NULL on composite foreign keys.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this migration as the reviewed database owner role with RLS bypass.';
  END IF;

  IF (SELECT count(*) FROM public.shops) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.shops
       WHERE name = 'Pharma Care' AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'Expected the single active Pharma Care shop; stop and inspect.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE (role = 'super_admin' AND shop_id IS NOT NULL)
       OR (role <> 'super_admin' AND shop_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Profile shop assignments are incomplete or unexpected.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE shop_id IS NULL)',
      v_table
    ) INTO v_unassigned;
    IF v_unassigned THEN
      RAISE EXCEPTION 'public.% contains unassigned rows; stop and inspect.', v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.audit_logs AS log
    LEFT JOIN public.profiles AS actor ON actor.id = log.actor_id
    WHERE log.shop_id IS NULL
      AND actor.role::text IS DISTINCT FROM 'super_admin'
  ) THEN
    RAISE EXCEPTION 'A null-shop audit log is not attributed to a Super Admin; stop and inspect.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.trash_bin_events AS trash_event
    LEFT JOIN public.profiles AS actor ON actor.id = trash_event.actor_id
    WHERE trash_event.shop_id IS NULL
      AND trash_event.actor_id IS NOT NULL
      AND actor.role::text IS DISTINCT FROM 'super_admin'
  ) THEN
    RAISE EXCEPTION 'A null-shop trash event is not attributed to a Super Admin; stop and inspect.';
  END IF;

  IF to_regclass('public.brands_name_lower_key') IS NULL
     OR to_regclass('public.categories_name_lower_key') IS NULL
     OR to_regclass('public.medicines_barcode_unique') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.medicines'::regclass
         AND conname = 'medicines_code_key'
         AND contype = 'u'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.sales'::regclass
         AND conname = 'sales_invoice_number_key'
         AND contype = 'u'
     )
     OR to_regclass('public.purchases_pr_no_key') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.medicine_units'::regclass
         AND conname = 'medicine_units_medicine_id_name_key'
         AND contype = 'u'
     ) THEN
    RAISE EXCEPTION 'Expected existing global unique indexes/constraints differ from the reviewed inventory.';
  END IF;

  FOREACH v_object IN ARRAY v_new_objects LOOP
    IF to_regclass(format('public.%I', v_object)) IS NOT NULL THEN
      RAISE EXCEPTION 'S4 object public.% already exists; stop and inspect.', v_object;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname IN (
      'khata_entries_customer_shop_id_fkey',
      'khata_entries_sale_shop_id_fkey',
      'medicine_units_medicine_shop_id_fkey',
      'purchase_items_medicine_shop_id_fkey',
      'purchase_items_purchase_shop_id_fkey',
      'purchase_items_stock_batch_shop_id_fkey',
      'purchase_items_unit_shop_id_fkey',
      'purchases_supplier_shop_id_fkey',
      'sale_item_batch_allocations_batch_shop_id_fkey',
      'sale_item_batch_allocations_sale_item_shop_id_fkey',
      'sale_items_medicine_shop_id_fkey',
      'sale_items_sale_shop_id_fkey',
      'sale_items_unit_shop_id_fkey',
      'sale_payments_sale_shop_id_fkey',
      'sale_return_items_batch_shop_id_fkey',
      'sale_return_items_quarantine_batch_shop_id_fkey',
      'sale_return_items_restock_unit_shop_id_fkey',
      'sale_return_items_return_shop_id_fkey',
      'sale_return_items_allocation_shop_id_fkey',
      'sale_return_items_sale_item_shop_id_fkey',
      'sale_returns_sale_shop_id_fkey',
      'sales_customer_shop_id_fkey',
      'stock_batches_medicine_shop_id_fkey',
      'stock_batches_supplier_shop_id_fkey',
      'stock_movements_batch_shop_id_fkey',
      'supplier_ledger_purchase_shop_id_fkey',
      'supplier_ledger_supplier_shop_id_fkey'
    )
  ) THEN
    RAISE EXCEPTION 'One or more S4 composite foreign keys already exist; stop and inspect.';
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX brands_shop_name_lower_key
  ON public.brands (shop_id, lower(name));
CREATE UNIQUE INDEX categories_shop_name_lower_key
  ON public.categories (shop_id, lower(name));
CREATE UNIQUE INDEX medicines_shop_code_key
  ON public.medicines (shop_id, code);
CREATE UNIQUE INDEX medicines_shop_barcode_unique
  ON public.medicines (shop_id, barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';
CREATE UNIQUE INDEX purchases_shop_pr_no_key
  ON public.purchases (shop_id, pr_no);
CREATE UNIQUE INDEX sales_shop_invoice_number_key
  ON public.sales (shop_id, invoice_number);

CREATE UNIQUE INDEX customers_shop_id_id_key
  ON public.customers (shop_id, id);
CREATE UNIQUE INDEX sales_shop_id_id_key
  ON public.sales (shop_id, id);
CREATE UNIQUE INDEX medicines_shop_id_id_key
  ON public.medicines (shop_id, id);
CREATE UNIQUE INDEX purchases_shop_id_id_key
  ON public.purchases (shop_id, id);
CREATE UNIQUE INDEX stock_batches_shop_id_id_key
  ON public.stock_batches (shop_id, id);
CREATE UNIQUE INDEX medicine_units_shop_id_id_key
  ON public.medicine_units (shop_id, id);
CREATE UNIQUE INDEX suppliers_shop_id_id_key
  ON public.suppliers (shop_id, id);
CREATE UNIQUE INDEX sale_items_shop_id_id_key
  ON public.sale_items (shop_id, id);
CREATE UNIQUE INDEX sale_item_batch_allocations_shop_id_id_key
  ON public.sale_item_batch_allocations (shop_id, id);
CREATE UNIQUE INDEX sale_returns_shop_id_id_key
  ON public.sale_returns (shop_id, id);

ALTER TABLE public.khata_entries
  ADD CONSTRAINT khata_entries_customer_shop_id_fkey
  FOREIGN KEY (shop_id, customer_id)
  REFERENCES public.customers (shop_id, id) NOT VALID;
ALTER TABLE public.khata_entries
  ADD CONSTRAINT khata_entries_sale_shop_id_fkey
  FOREIGN KEY (shop_id, sale_id)
  REFERENCES public.sales (shop_id, id) NOT VALID;
ALTER TABLE public.medicine_units
  ADD CONSTRAINT medicine_units_medicine_shop_id_fkey
  FOREIGN KEY (shop_id, medicine_id)
  REFERENCES public.medicines (shop_id, id) NOT VALID;
ALTER TABLE public.purchase_items
  ADD CONSTRAINT purchase_items_medicine_shop_id_fkey
  FOREIGN KEY (shop_id, medicine_id)
  REFERENCES public.medicines (shop_id, id) NOT VALID;
ALTER TABLE public.purchase_items
  ADD CONSTRAINT purchase_items_purchase_shop_id_fkey
  FOREIGN KEY (shop_id, purchase_id)
  REFERENCES public.purchases (shop_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.purchase_items
  ADD CONSTRAINT purchase_items_stock_batch_shop_id_fkey
  FOREIGN KEY (shop_id, stock_batch_id)
  REFERENCES public.stock_batches (shop_id, id) NOT VALID;
ALTER TABLE public.purchase_items
  ADD CONSTRAINT purchase_items_unit_shop_id_fkey
  FOREIGN KEY (shop_id, unit_id)
  REFERENCES public.medicine_units (shop_id, id) NOT VALID;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_supplier_shop_id_fkey
  FOREIGN KEY (shop_id, supplier_id)
  REFERENCES public.suppliers (shop_id, id) NOT VALID;
ALTER TABLE public.sale_item_batch_allocations
  ADD CONSTRAINT sale_item_batch_allocations_batch_shop_id_fkey
  FOREIGN KEY (shop_id, batch_id)
  REFERENCES public.stock_batches (shop_id, id) NOT VALID;
ALTER TABLE public.sale_item_batch_allocations
  ADD CONSTRAINT sale_item_batch_allocations_sale_item_shop_id_fkey
  FOREIGN KEY (shop_id, sale_item_id)
  REFERENCES public.sale_items (shop_id, id) NOT VALID;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_medicine_shop_id_fkey
  FOREIGN KEY (shop_id, medicine_id)
  REFERENCES public.medicines (shop_id, id) NOT VALID;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_sale_shop_id_fkey
  FOREIGN KEY (shop_id, sale_id)
  REFERENCES public.sales (shop_id, id) NOT VALID;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_unit_shop_id_fkey
  FOREIGN KEY (shop_id, unit_id)
  REFERENCES public.medicine_units (shop_id, id) NOT VALID;
ALTER TABLE public.sale_payments
  ADD CONSTRAINT sale_payments_sale_shop_id_fkey
  FOREIGN KEY (shop_id, sale_id)
  REFERENCES public.sales (shop_id, id) NOT VALID;
ALTER TABLE public.sale_return_items
  ADD CONSTRAINT sale_return_items_batch_shop_id_fkey
  FOREIGN KEY (shop_id, batch_id)
  REFERENCES public.stock_batches (shop_id, id) NOT VALID;
ALTER TABLE public.sale_return_items
  ADD CONSTRAINT sale_return_items_quarantine_batch_shop_id_fkey
  FOREIGN KEY (shop_id, quarantine_batch_id)
  REFERENCES public.stock_batches (shop_id, id) NOT VALID;
ALTER TABLE public.sale_return_items
  ADD CONSTRAINT sale_return_items_restock_unit_shop_id_fkey
  FOREIGN KEY (shop_id, restock_unit_id)
  REFERENCES public.medicine_units (shop_id, id) NOT VALID;
ALTER TABLE public.sale_return_items
  ADD CONSTRAINT sale_return_items_return_shop_id_fkey
  FOREIGN KEY (shop_id, return_id)
  REFERENCES public.sale_returns (shop_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.sale_return_items
  ADD CONSTRAINT sale_return_items_allocation_shop_id_fkey
  FOREIGN KEY (shop_id, sale_item_batch_allocation_id)
  REFERENCES public.sale_item_batch_allocations (shop_id, id) NOT VALID;
ALTER TABLE public.sale_return_items
  ADD CONSTRAINT sale_return_items_sale_item_shop_id_fkey
  FOREIGN KEY (shop_id, sale_item_id)
  REFERENCES public.sale_items (shop_id, id) NOT VALID;
ALTER TABLE public.sale_returns
  ADD CONSTRAINT sale_returns_sale_shop_id_fkey
  FOREIGN KEY (shop_id, sale_id)
  REFERENCES public.sales (shop_id, id) NOT VALID;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_customer_shop_id_fkey
  FOREIGN KEY (shop_id, customer_id)
  REFERENCES public.customers (shop_id, id)
  ON DELETE SET NULL (customer_id) NOT VALID;
ALTER TABLE public.stock_batches
  ADD CONSTRAINT stock_batches_medicine_shop_id_fkey
  FOREIGN KEY (shop_id, medicine_id)
  REFERENCES public.medicines (shop_id, id) NOT VALID;
ALTER TABLE public.stock_batches
  ADD CONSTRAINT stock_batches_supplier_shop_id_fkey
  FOREIGN KEY (shop_id, supplier_id)
  REFERENCES public.suppliers (shop_id, id) NOT VALID;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_batch_shop_id_fkey
  FOREIGN KEY (shop_id, batch_id)
  REFERENCES public.stock_batches (shop_id, id) NOT VALID;
ALTER TABLE public.supplier_ledger
  ADD CONSTRAINT supplier_ledger_purchase_shop_id_fkey
  FOREIGN KEY (shop_id, purchase_id)
  REFERENCES public.purchases (shop_id, id) NOT VALID;
ALTER TABLE public.supplier_ledger
  ADD CONSTRAINT supplier_ledger_supplier_shop_id_fkey
  FOREIGN KEY (shop_id, supplier_id)
  REFERENCES public.suppliers (shop_id, id) NOT VALID;

COMMIT;
