-- S4 cutover after stage 013: remove global business-key restrictions and
-- redundant parent-only FKs. Shop-scoped replacements must already be valid.
-- Do not create a second shop until the cross-table barcode registry exists.

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
  v_valid_fk_count integer;
  v_expected_fk_count integer;
  v_valid_index_count integer;
  v_expected_index_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this cutover as the reviewed database owner role with RLS bypass.';
  END IF;

  IF (SELECT count(*) FROM public.shops) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.shops
       WHERE name = 'Pharma Care' AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'Expected the single active Pharma Care shop; stop and inspect.';
  END IF;

  WITH expected(table_name, constraint_name) AS (
    VALUES
      ('khata_entries', 'khata_entries_customer_shop_id_fkey'),
      ('khata_entries', 'khata_entries_sale_shop_id_fkey'),
      ('medicine_units', 'medicine_units_medicine_shop_id_fkey'),
      ('purchase_items', 'purchase_items_medicine_shop_id_fkey'),
      ('purchase_items', 'purchase_items_purchase_shop_id_fkey'),
      ('purchase_items', 'purchase_items_stock_batch_shop_id_fkey'),
      ('purchase_items', 'purchase_items_unit_shop_id_fkey'),
      ('purchases', 'purchases_supplier_shop_id_fkey'),
      ('sale_item_batch_allocations', 'sale_item_batch_allocations_batch_shop_id_fkey'),
      ('sale_item_batch_allocations', 'sale_item_batch_allocations_sale_item_shop_id_fkey'),
      ('sale_items', 'sale_items_medicine_shop_id_fkey'),
      ('sale_items', 'sale_items_sale_shop_id_fkey'),
      ('sale_items', 'sale_items_unit_shop_id_fkey'),
      ('sale_payments', 'sale_payments_sale_shop_id_fkey'),
      ('sale_return_items', 'sale_return_items_batch_shop_id_fkey'),
      ('sale_return_items', 'sale_return_items_quarantine_batch_shop_id_fkey'),
      ('sale_return_items', 'sale_return_items_restock_unit_shop_id_fkey'),
      ('sale_return_items', 'sale_return_items_return_shop_id_fkey'),
      ('sale_return_items', 'sale_return_items_allocation_shop_id_fkey'),
      ('sale_return_items', 'sale_return_items_sale_item_shop_id_fkey'),
      ('sale_returns', 'sale_returns_sale_shop_id_fkey'),
      ('sales', 'sales_customer_shop_id_fkey'),
      ('stock_batches', 'stock_batches_medicine_shop_id_fkey'),
      ('stock_batches', 'stock_batches_supplier_shop_id_fkey'),
      ('stock_movements', 'stock_movements_batch_shop_id_fkey'),
      ('supplier_ledger', 'supplier_ledger_purchase_shop_id_fkey'),
      ('supplier_ledger', 'supplier_ledger_supplier_shop_id_fkey')
  )
  SELECT count(*)::integer,
         (count(*) FILTER (
           WHERE constraint_info.oid IS NOT NULL
             AND constraint_info.contype = 'f'
             AND constraint_info.convalidated
             AND pg_catalog.pg_get_constraintdef(constraint_info.oid, true)
               LIKE 'FOREIGN KEY (shop_id,%'
         ))::integer
    INTO v_expected_fk_count, v_valid_fk_count
  FROM expected
  LEFT JOIN pg_catalog.pg_constraint AS constraint_info
    ON constraint_info.conrelid = to_regclass(format('public.%I', expected.table_name))
   AND constraint_info.conname = expected.constraint_name;

  IF v_expected_fk_count <> 27 OR v_valid_fk_count <> 27 THEN
    RAISE EXCEPTION
      'Cutover requires all 27 validated composite FKs; found % expected names and % valid.',
      v_expected_fk_count,
      v_valid_fk_count;
  END IF;

  WITH expected(index_name) AS (
    VALUES
      ('brands_shop_name_lower_key'),
      ('categories_shop_name_lower_key'),
      ('medicines_shop_code_key'),
      ('medicines_shop_barcode_unique'),
      ('purchases_shop_pr_no_key'),
      ('sales_shop_invoice_number_key')
  )
  SELECT count(*)::integer,
         (count(*) FILTER (
           WHERE index_info.indexrelid IS NOT NULL
             AND index_info.indisunique
             AND index_info.indisvalid
             AND index_info.indisready
         ))::integer
    INTO v_expected_index_count, v_valid_index_count
  FROM expected
  LEFT JOIN pg_catalog.pg_class AS index_class
    ON index_class.relname = expected.index_name
  LEFT JOIN pg_catalog.pg_namespace AS index_schema
    ON index_schema.oid = index_class.relnamespace
   AND index_schema.nspname = 'public'
  LEFT JOIN pg_catalog.pg_index AS index_info
    ON index_info.indexrelid = index_class.oid
   AND index_schema.nspname = 'public';

  IF v_expected_index_count <> 6 OR v_valid_index_count <> 6 THEN
    RAISE EXCEPTION
      'Cutover requires all six valid shop-scoped business-key indexes; found % expected names and % valid.',
      v_expected_index_count,
      v_valid_index_count;
  END IF;

  IF to_regclass('public.brands_name_lower_key') IS NULL
     OR to_regclass('public.categories_name_lower_key') IS NULL
     OR to_regclass('public.medicines_barcode_unique') IS NULL
     OR to_regclass('public.purchases_pr_no_key') IS NULL
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
     ) THEN
    RAISE EXCEPTION 'Expected original global unique indexes/constraints differ; stop and inspect.';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_constraint
    WHERE contype = 'f'
      AND (conrelid, conname) IN (
        ('public.khata_entries'::regclass, 'khata_entries_customer_id_fkey'),
        ('public.khata_entries'::regclass, 'khata_entries_sale_id_fkey'),
        ('public.medicine_units'::regclass, 'medicine_units_medicine_id_fkey'),
        ('public.purchase_items'::regclass, 'purchase_items_medicine_id_fkey'),
        ('public.purchase_items'::regclass, 'purchase_items_purchase_id_fkey'),
        ('public.purchase_items'::regclass, 'purchase_items_stock_batch_id_fkey'),
        ('public.purchase_items'::regclass, 'purchase_items_unit_id_fkey'),
        ('public.purchases'::regclass, 'purchases_supplier_id_fkey'),
        ('public.sale_item_batch_allocations'::regclass, 'sale_item_batch_allocations_batch_id_fkey'),
        ('public.sale_item_batch_allocations'::regclass, 'sale_item_batch_allocations_sale_item_id_fkey'),
        ('public.sale_items'::regclass, 'sale_items_medicine_id_fkey'),
        ('public.sale_items'::regclass, 'sale_items_sale_id_fkey'),
        ('public.sale_items'::regclass, 'sale_items_unit_id_fkey'),
        ('public.sale_payments'::regclass, 'sale_payments_sale_id_fkey'),
        ('public.sale_return_items'::regclass, 'sale_return_items_batch_id_fkey'),
        ('public.sale_return_items'::regclass, 'sale_return_items_quarantine_batch_id_fkey'),
        ('public.sale_return_items'::regclass, 'sale_return_items_restock_unit_id_fkey'),
        ('public.sale_return_items'::regclass, 'sale_return_items_return_id_fkey'),
        ('public.sale_return_items'::regclass, 'sale_return_items_sale_item_batch_allocation_id_fkey'),
        ('public.sale_return_items'::regclass, 'sale_return_items_sale_item_id_fkey'),
        ('public.sale_returns'::regclass, 'sale_returns_sale_id_fkey'),
        ('public.sales'::regclass, 'sales_customer_id_fkey'),
        ('public.stock_batches'::regclass, 'stock_batches_medicine_id_fkey'),
        ('public.stock_batches'::regclass, 'stock_batches_supplier_id_fkey'),
        ('public.stock_movements'::regclass, 'stock_movements_batch_id_fkey'),
        ('public.supplier_ledger'::regclass, 'supplier_ledger_purchase_id_fkey'),
        ('public.supplier_ledger'::regclass, 'supplier_ledger_supplier_id_fkey')
      )
  ) <> 27 THEN
    RAISE EXCEPTION 'Expected 27 original parent-only business FKs; stop and inspect.';
  END IF;
END
$preflight$;

ALTER TABLE public.khata_entries DROP CONSTRAINT khata_entries_customer_id_fkey;
ALTER TABLE public.khata_entries DROP CONSTRAINT khata_entries_sale_id_fkey;
ALTER TABLE public.medicine_units DROP CONSTRAINT medicine_units_medicine_id_fkey;
ALTER TABLE public.purchase_items DROP CONSTRAINT purchase_items_medicine_id_fkey;
ALTER TABLE public.purchase_items DROP CONSTRAINT purchase_items_purchase_id_fkey;
ALTER TABLE public.purchase_items DROP CONSTRAINT purchase_items_stock_batch_id_fkey;
ALTER TABLE public.purchase_items DROP CONSTRAINT purchase_items_unit_id_fkey;
ALTER TABLE public.purchases DROP CONSTRAINT purchases_supplier_id_fkey;
ALTER TABLE public.sale_item_batch_allocations DROP CONSTRAINT sale_item_batch_allocations_batch_id_fkey;
ALTER TABLE public.sale_item_batch_allocations DROP CONSTRAINT sale_item_batch_allocations_sale_item_id_fkey;
ALTER TABLE public.sale_items DROP CONSTRAINT sale_items_medicine_id_fkey;
ALTER TABLE public.sale_items DROP CONSTRAINT sale_items_sale_id_fkey;
ALTER TABLE public.sale_items DROP CONSTRAINT sale_items_unit_id_fkey;
ALTER TABLE public.sale_payments DROP CONSTRAINT sale_payments_sale_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_batch_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_quarantine_batch_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_restock_unit_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_return_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_sale_item_batch_allocation_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_sale_item_id_fkey;
ALTER TABLE public.sale_returns DROP CONSTRAINT sale_returns_sale_id_fkey;
ALTER TABLE public.sales DROP CONSTRAINT sales_customer_id_fkey;
ALTER TABLE public.stock_batches DROP CONSTRAINT stock_batches_medicine_id_fkey;
ALTER TABLE public.stock_batches DROP CONSTRAINT stock_batches_supplier_id_fkey;
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_batch_id_fkey;
ALTER TABLE public.supplier_ledger DROP CONSTRAINT supplier_ledger_purchase_id_fkey;
ALTER TABLE public.supplier_ledger DROP CONSTRAINT supplier_ledger_supplier_id_fkey;

ALTER TABLE public.medicines DROP CONSTRAINT medicines_code_key;
ALTER TABLE public.sales DROP CONSTRAINT sales_invoice_number_key;
DROP INDEX public.brands_name_lower_key;
DROP INDEX public.categories_name_lower_key;
DROP INDEX public.medicines_barcode_unique;
DROP INDEX public.purchases_pr_no_key;

DO $postflight$
BEGIN
  IF to_regclass('public.brands_name_lower_key') IS NOT NULL
     OR to_regclass('public.categories_name_lower_key') IS NOT NULL
     OR to_regclass('public.medicines_barcode_unique') IS NOT NULL
     OR to_regclass('public.purchases_pr_no_key') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE (conrelid = 'public.medicines'::regclass AND conname = 'medicines_code_key')
          OR (conrelid = 'public.sales'::regclass AND conname = 'sales_invoice_number_key')
     ) THEN
    RAISE EXCEPTION 'One or more global unique restrictions remain; transaction aborted.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname IN (
      'khata_entries_customer_id_fkey',
      'khata_entries_sale_id_fkey',
      'medicine_units_medicine_id_fkey',
      'purchase_items_medicine_id_fkey',
      'purchase_items_purchase_id_fkey',
      'purchase_items_stock_batch_id_fkey',
      'purchase_items_unit_id_fkey',
      'purchases_supplier_id_fkey',
      'sale_item_batch_allocations_batch_id_fkey',
      'sale_item_batch_allocations_sale_item_id_fkey',
      'sale_items_medicine_id_fkey',
      'sale_items_sale_id_fkey',
      'sale_items_unit_id_fkey',
      'sale_payments_sale_id_fkey',
      'sale_return_items_batch_id_fkey',
      'sale_return_items_quarantine_batch_id_fkey',
      'sale_return_items_restock_unit_id_fkey',
      'sale_return_items_return_id_fkey',
      'sale_return_items_sale_item_batch_allocation_id_fkey',
      'sale_return_items_sale_item_id_fkey',
      'sale_returns_sale_id_fkey',
      'sales_customer_id_fkey',
      'stock_batches_medicine_id_fkey',
      'stock_batches_supplier_id_fkey',
      'stock_movements_batch_id_fkey',
      'supplier_ledger_purchase_id_fkey',
      'supplier_ledger_supplier_id_fkey'
    )
  ) THEN
    RAISE EXCEPTION 'One or more parent-only business FKs remain; transaction aborted.';
  END IF;
END
$postflight$;

COMMIT;
