-- Roll back only the additive 011 stage, while Pharma Care remains the only
-- shop. Existing global unique indexes and single-column foreign keys remain.

BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

DO $rollback_preflight$
DECLARE
  v_object text;
  v_indexes text[] := ARRAY[
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
  v_constraints text[] := ARRAY[
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
  ];
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

  FOREACH v_object IN ARRAY v_indexes LOOP
    IF to_regclass(format('public.%I', v_object)) IS NULL THEN
      RAISE EXCEPTION 'Expected S4 index public.% is missing; stop and inspect.', v_object;
    END IF;
  END LOOP;

  FOREACH v_object IN ARRAY v_constraints LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conname = v_object AND contype = 'f'
    ) THEN
      RAISE EXCEPTION 'Expected S4 constraint % is missing or changed; stop and inspect.', v_object;
    END IF;
  END LOOP;
END
$rollback_preflight$;

ALTER TABLE public.khata_entries DROP CONSTRAINT khata_entries_customer_shop_id_fkey;
ALTER TABLE public.khata_entries DROP CONSTRAINT khata_entries_sale_shop_id_fkey;
ALTER TABLE public.medicine_units DROP CONSTRAINT medicine_units_medicine_shop_id_fkey;
ALTER TABLE public.purchase_items DROP CONSTRAINT purchase_items_medicine_shop_id_fkey;
ALTER TABLE public.purchase_items DROP CONSTRAINT purchase_items_purchase_shop_id_fkey;
ALTER TABLE public.purchase_items DROP CONSTRAINT purchase_items_stock_batch_shop_id_fkey;
ALTER TABLE public.purchase_items DROP CONSTRAINT purchase_items_unit_shop_id_fkey;
ALTER TABLE public.purchases DROP CONSTRAINT purchases_supplier_shop_id_fkey;
ALTER TABLE public.sale_item_batch_allocations DROP CONSTRAINT sale_item_batch_allocations_batch_shop_id_fkey;
ALTER TABLE public.sale_item_batch_allocations DROP CONSTRAINT sale_item_batch_allocations_sale_item_shop_id_fkey;
ALTER TABLE public.sale_items DROP CONSTRAINT sale_items_medicine_shop_id_fkey;
ALTER TABLE public.sale_items DROP CONSTRAINT sale_items_sale_shop_id_fkey;
ALTER TABLE public.sale_items DROP CONSTRAINT sale_items_unit_shop_id_fkey;
ALTER TABLE public.sale_payments DROP CONSTRAINT sale_payments_sale_shop_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_batch_shop_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_quarantine_batch_shop_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_restock_unit_shop_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_return_shop_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_allocation_shop_id_fkey;
ALTER TABLE public.sale_return_items DROP CONSTRAINT sale_return_items_sale_item_shop_id_fkey;
ALTER TABLE public.sale_returns DROP CONSTRAINT sale_returns_sale_shop_id_fkey;
ALTER TABLE public.sales DROP CONSTRAINT sales_customer_shop_id_fkey;
ALTER TABLE public.stock_batches DROP CONSTRAINT stock_batches_medicine_shop_id_fkey;
ALTER TABLE public.stock_batches DROP CONSTRAINT stock_batches_supplier_shop_id_fkey;
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_batch_shop_id_fkey;
ALTER TABLE public.supplier_ledger DROP CONSTRAINT supplier_ledger_purchase_shop_id_fkey;
ALTER TABLE public.supplier_ledger DROP CONSTRAINT supplier_ledger_supplier_shop_id_fkey;

DROP INDEX public.brands_shop_name_lower_key;
DROP INDEX public.categories_shop_name_lower_key;
DROP INDEX public.medicines_shop_code_key;
DROP INDEX public.medicines_shop_barcode_unique;
DROP INDEX public.purchases_shop_pr_no_key;
DROP INDEX public.sales_shop_invoice_number_key;
DROP INDEX public.customers_shop_id_id_key;
DROP INDEX public.sales_shop_id_id_key;
DROP INDEX public.medicines_shop_id_id_key;
DROP INDEX public.purchases_shop_id_id_key;
DROP INDEX public.stock_batches_shop_id_id_key;
DROP INDEX public.medicine_units_shop_id_id_key;
DROP INDEX public.suppliers_shop_id_id_key;
DROP INDEX public.sale_items_shop_id_id_key;
DROP INDEX public.sale_item_batch_allocations_shop_id_id_key;
DROP INDEX public.sale_returns_shop_id_id_key;

COMMIT;
