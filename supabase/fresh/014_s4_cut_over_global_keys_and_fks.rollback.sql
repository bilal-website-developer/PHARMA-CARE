-- Restore the pre-014 global keys and parent-only FKs.
-- Safe only while Pharma Care remains the sole shop.

BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $rollback_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this rollback as the reviewed database owner role with RLS bypass.';
  END IF;

  IF (SELECT count(*) FROM public.shops) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.shops
       WHERE name = 'Pharma Care' AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'Rollback is safe only while Pharma Care remains the only shop.';
  END IF;

  IF to_regclass('public.brands_name_lower_key') IS NOT NULL
     OR to_regclass('public.categories_name_lower_key') IS NOT NULL
     OR to_regclass('public.medicines_barcode_unique') IS NOT NULL
     OR to_regclass('public.purchases_pr_no_key') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE (conrelid = 'public.medicines'::regclass AND conname = 'medicines_code_key')
          OR (conrelid = 'public.sales'::regclass AND conname = 'sales_invoice_number_key')
     ) THEN
    RAISE EXCEPTION 'Original global keys are already present; rollback stopped.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
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
    RAISE EXCEPTION 'One or more original parent-only FKs already exist; rollback stopped.';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_constraint
    WHERE convalidated
      AND conname IN (
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
  ) <> 27 THEN
    RAISE EXCEPTION 'All 27 validated composite S4 foreign keys are required before rollback.';
  END IF;
END
$rollback_preflight$;

CREATE UNIQUE INDEX brands_name_lower_key
  ON public.brands (lower(name));
CREATE UNIQUE INDEX categories_name_lower_key
  ON public.categories (lower(name));
ALTER TABLE public.medicines
  ADD CONSTRAINT medicines_code_key UNIQUE (code);
CREATE UNIQUE INDEX medicines_barcode_unique
  ON public.medicines (barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';
CREATE UNIQUE INDEX purchases_pr_no_key
  ON public.purchases (pr_no);
ALTER TABLE public.sales
  ADD CONSTRAINT sales_invoice_number_key UNIQUE (invoice_number);

DO $restore_fks$
DECLARE
  v_fk record;
  v_fks record;
BEGIN
  FOR v_fk IN
    SELECT *
    FROM (VALUES
      ('khata_entries', 'khata_entries_customer_id_fkey', 'customer_id', 'customers', 'id', ''),
      ('khata_entries', 'khata_entries_sale_id_fkey', 'sale_id', 'sales', 'id', ''),
      ('medicine_units', 'medicine_units_medicine_id_fkey', 'medicine_id', 'medicines', 'id', ''),
      ('purchase_items', 'purchase_items_medicine_id_fkey', 'medicine_id', 'medicines', 'id', ''),
      ('purchase_items', 'purchase_items_purchase_id_fkey', 'purchase_id', 'purchases', 'id', 'ON DELETE CASCADE'),
      ('purchase_items', 'purchase_items_stock_batch_id_fkey', 'stock_batch_id', 'stock_batches', 'id', ''),
      ('purchase_items', 'purchase_items_unit_id_fkey', 'unit_id', 'medicine_units', 'id', ''),
      ('purchases', 'purchases_supplier_id_fkey', 'supplier_id', 'suppliers', 'id', ''),
      ('sale_item_batch_allocations', 'sale_item_batch_allocations_batch_id_fkey', 'batch_id', 'stock_batches', 'id', ''),
      ('sale_item_batch_allocations', 'sale_item_batch_allocations_sale_item_id_fkey', 'sale_item_id', 'sale_items', 'id', ''),
      ('sale_items', 'sale_items_medicine_id_fkey', 'medicine_id', 'medicines', 'id', ''),
      ('sale_items', 'sale_items_sale_id_fkey', 'sale_id', 'sales', 'id', ''),
      ('sale_items', 'sale_items_unit_id_fkey', 'unit_id', 'medicine_units', 'id', ''),
      ('sale_payments', 'sale_payments_sale_id_fkey', 'sale_id', 'sales', 'id', ''),
      ('sale_return_items', 'sale_return_items_batch_id_fkey', 'batch_id', 'stock_batches', 'id', ''),
      ('sale_return_items', 'sale_return_items_quarantine_batch_id_fkey', 'quarantine_batch_id', 'stock_batches', 'id', ''),
      ('sale_return_items', 'sale_return_items_restock_unit_id_fkey', 'restock_unit_id', 'medicine_units', 'id', ''),
      ('sale_return_items', 'sale_return_items_return_id_fkey', 'return_id', 'sale_returns', 'id', 'ON DELETE CASCADE'),
      ('sale_return_items', 'sale_return_items_sale_item_batch_allocation_id_fkey', 'sale_item_batch_allocation_id', 'sale_item_batch_allocations', 'id', ''),
      ('sale_return_items', 'sale_return_items_sale_item_id_fkey', 'sale_item_id', 'sale_items', 'id', ''),
      ('sale_returns', 'sale_returns_sale_id_fkey', 'sale_id', 'sales', 'id', ''),
      ('sales', 'sales_customer_id_fkey', 'customer_id', 'customers', 'id', 'ON DELETE SET NULL'),
      ('stock_batches', 'stock_batches_medicine_id_fkey', 'medicine_id', 'medicines', 'id', ''),
      ('stock_batches', 'stock_batches_supplier_id_fkey', 'supplier_id', 'suppliers', 'id', ''),
      ('stock_movements', 'stock_movements_batch_id_fkey', 'batch_id', 'stock_batches', 'id', ''),
      ('supplier_ledger', 'supplier_ledger_purchase_id_fkey', 'purchase_id', 'purchases', 'id', ''),
      ('supplier_ledger', 'supplier_ledger_supplier_id_fkey', 'supplier_id', 'suppliers', 'id', '')
    ) AS fk(table_name, constraint_name, column_name, target_table, target_column, delete_action)
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I (%I) %s NOT VALID',
      v_fk.table_name,
      v_fk.constraint_name,
      v_fk.column_name,
      v_fk.target_table,
      v_fk.target_column,
      v_fk.delete_action
    );
  END LOOP;

  FOR v_fks IN
    SELECT *
    FROM (VALUES
      ('khata_entries', 'khata_entries_customer_id_fkey'),
      ('khata_entries', 'khata_entries_sale_id_fkey'),
      ('medicine_units', 'medicine_units_medicine_id_fkey'),
      ('purchase_items', 'purchase_items_medicine_id_fkey'),
      ('purchase_items', 'purchase_items_purchase_id_fkey'),
      ('purchase_items', 'purchase_items_stock_batch_id_fkey'),
      ('purchase_items', 'purchase_items_unit_id_fkey'),
      ('purchases', 'purchases_supplier_id_fkey'),
      ('sale_item_batch_allocations', 'sale_item_batch_allocations_batch_id_fkey'),
      ('sale_item_batch_allocations', 'sale_item_batch_allocations_sale_item_id_fkey'),
      ('sale_items', 'sale_items_medicine_id_fkey'),
      ('sale_items', 'sale_items_sale_id_fkey'),
      ('sale_items', 'sale_items_unit_id_fkey'),
      ('sale_payments', 'sale_payments_sale_id_fkey'),
      ('sale_return_items', 'sale_return_items_batch_id_fkey'),
      ('sale_return_items', 'sale_return_items_quarantine_batch_id_fkey'),
      ('sale_return_items', 'sale_return_items_restock_unit_id_fkey'),
      ('sale_return_items', 'sale_return_items_return_id_fkey'),
      ('sale_return_items', 'sale_return_items_sale_item_batch_allocation_id_fkey'),
      ('sale_return_items', 'sale_return_items_sale_item_id_fkey'),
      ('sale_returns', 'sale_returns_sale_id_fkey'),
      ('sales', 'sales_customer_id_fkey'),
      ('stock_batches', 'stock_batches_medicine_id_fkey'),
      ('stock_batches', 'stock_batches_supplier_id_fkey'),
      ('stock_movements', 'stock_movements_batch_id_fkey'),
      ('supplier_ledger', 'supplier_ledger_purchase_id_fkey'),
      ('supplier_ledger', 'supplier_ledger_supplier_id_fkey')
    ) AS fk(table_name, constraint_name)
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I VALIDATE CONSTRAINT %I',
      v_fks.table_name,
      v_fks.constraint_name
    );
  END LOOP;
END
$restore_fks$;

COMMIT;
