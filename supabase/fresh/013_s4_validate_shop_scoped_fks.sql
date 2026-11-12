-- Validate the additive S4 same-shop composite foreign keys created by stage 011.
-- This transaction contains no row DML; validation scans existing references.

BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $preflight$
DECLARE
  v_expected_count integer;
  v_unvalidated_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this validation as the reviewed database owner role with RLS bypass.';
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
  SELECT
    count(*)::integer,
    (count(*) FILTER (
      WHERE constraint_info.oid IS NOT NULL
        AND constraint_info.contype = 'f'
        AND NOT constraint_info.convalidated
        AND pg_catalog.pg_get_constraintdef(constraint_info.oid, true)
          LIKE 'FOREIGN KEY (shop_id,%'
    ))::integer
  INTO v_expected_count, v_unvalidated_count
  FROM expected
  LEFT JOIN pg_catalog.pg_constraint AS constraint_info
    ON constraint_info.conrelid = to_regclass(format('public.%I', expected.table_name))
   AND constraint_info.conname = expected.constraint_name;

  IF v_expected_count <> 27 OR v_unvalidated_count <> 27 THEN
    RAISE EXCEPTION
      'Expected 27 present, unvalidated shop-scoped foreign keys; found % expected names and % valid candidates.',
      v_expected_count,
      v_unvalidated_count;
  END IF;
END
$preflight$;

ALTER TABLE public.khata_entries VALIDATE CONSTRAINT khata_entries_customer_shop_id_fkey;
ALTER TABLE public.khata_entries VALIDATE CONSTRAINT khata_entries_sale_shop_id_fkey;
ALTER TABLE public.medicine_units VALIDATE CONSTRAINT medicine_units_medicine_shop_id_fkey;
ALTER TABLE public.purchase_items VALIDATE CONSTRAINT purchase_items_medicine_shop_id_fkey;
ALTER TABLE public.purchase_items VALIDATE CONSTRAINT purchase_items_purchase_shop_id_fkey;
ALTER TABLE public.purchase_items VALIDATE CONSTRAINT purchase_items_stock_batch_shop_id_fkey;
ALTER TABLE public.purchase_items VALIDATE CONSTRAINT purchase_items_unit_shop_id_fkey;
ALTER TABLE public.purchases VALIDATE CONSTRAINT purchases_supplier_shop_id_fkey;
ALTER TABLE public.sale_item_batch_allocations VALIDATE CONSTRAINT sale_item_batch_allocations_batch_shop_id_fkey;
ALTER TABLE public.sale_item_batch_allocations VALIDATE CONSTRAINT sale_item_batch_allocations_sale_item_shop_id_fkey;
ALTER TABLE public.sale_items VALIDATE CONSTRAINT sale_items_medicine_shop_id_fkey;
ALTER TABLE public.sale_items VALIDATE CONSTRAINT sale_items_sale_shop_id_fkey;
ALTER TABLE public.sale_items VALIDATE CONSTRAINT sale_items_unit_shop_id_fkey;
ALTER TABLE public.sale_payments VALIDATE CONSTRAINT sale_payments_sale_shop_id_fkey;
ALTER TABLE public.sale_return_items VALIDATE CONSTRAINT sale_return_items_batch_shop_id_fkey;
ALTER TABLE public.sale_return_items VALIDATE CONSTRAINT sale_return_items_quarantine_batch_shop_id_fkey;
ALTER TABLE public.sale_return_items VALIDATE CONSTRAINT sale_return_items_restock_unit_shop_id_fkey;
ALTER TABLE public.sale_return_items VALIDATE CONSTRAINT sale_return_items_return_shop_id_fkey;
ALTER TABLE public.sale_return_items VALIDATE CONSTRAINT sale_return_items_allocation_shop_id_fkey;
ALTER TABLE public.sale_return_items VALIDATE CONSTRAINT sale_return_items_sale_item_shop_id_fkey;
ALTER TABLE public.sale_returns VALIDATE CONSTRAINT sale_returns_sale_shop_id_fkey;
ALTER TABLE public.sales VALIDATE CONSTRAINT sales_customer_shop_id_fkey;
ALTER TABLE public.stock_batches VALIDATE CONSTRAINT stock_batches_medicine_shop_id_fkey;
ALTER TABLE public.stock_batches VALIDATE CONSTRAINT stock_batches_supplier_shop_id_fkey;
ALTER TABLE public.stock_movements VALIDATE CONSTRAINT stock_movements_batch_shop_id_fkey;
ALTER TABLE public.supplier_ledger VALIDATE CONSTRAINT supplier_ledger_purchase_shop_id_fkey;
ALTER TABLE public.supplier_ledger VALIDATE CONSTRAINT supplier_ledger_supplier_shop_id_fkey;

DO $postflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
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
      AND NOT convalidated
  ) THEN
    RAISE EXCEPTION 'One or more S4 composite foreign keys remain unvalidated; transaction aborted.';
  END IF;
END
$postflight$;

COMMIT;
