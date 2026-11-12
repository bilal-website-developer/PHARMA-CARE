-- Read-only verification for S4 key/FK cutover stage 014.
WITH old_indexes(index_name) AS (
  VALUES
    ('brands_name_lower_key'),
    ('categories_name_lower_key'),
    ('medicines_code_key'),
    ('medicines_barcode_unique'),
    ('purchases_pr_no_key'),
    ('sales_invoice_number_key')
),
old_constraints(table_name, constraint_name) AS (
  VALUES
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
    ('supplier_ledger', 'supplier_ledger_supplier_id_fkey'),
    ('medicines', 'medicines_code_key'),
    ('sales', 'sales_invoice_number_key')
),
new_constraints(table_name, constraint_name) AS (
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
),
index_checks AS (
  SELECT
    count(*) = 6 AS expected_old_index_count,
    coalesce(bool_and(index_info.indexrelid IS NULL), false) AS old_global_indexes_absent
  FROM old_indexes AS expected
  LEFT JOIN pg_catalog.pg_class AS index_class
    ON index_class.relname = expected.index_name
  LEFT JOIN pg_catalog.pg_namespace AS index_schema
    ON index_schema.oid = index_class.relnamespace
   AND index_schema.nspname = 'public'
  LEFT JOIN pg_catalog.pg_index AS index_info
    ON index_info.indexrelid = index_class.oid
   AND index_schema.nspname = 'public'
),
old_fk_checks AS (
  SELECT
    count(*) = 29 AS expected_old_constraint_count,
    coalesce(bool_and(constraint_info.oid IS NULL), false) AS old_constraints_absent
  FROM old_constraints AS expected
  LEFT JOIN pg_catalog.pg_constraint AS constraint_info
    ON constraint_info.conrelid = to_regclass(format('public.%I', expected.table_name))
   AND constraint_info.conname = expected.constraint_name
),
new_fk_checks AS (
  SELECT
    count(*) = 27 AS expected_new_constraint_count,
    coalesce(bool_and(
      constraint_info.oid IS NOT NULL
      AND constraint_info.contype = 'f'
      AND constraint_info.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_info.oid, true)
        LIKE 'FOREIGN KEY (shop_id,%'
    ), false) AS all_composite_constraints_validated
  FROM new_constraints AS expected
  LEFT JOIN pg_catalog.pg_constraint AS constraint_info
    ON constraint_info.conrelid = to_regclass(format('public.%I', expected.table_name))
   AND constraint_info.conname = expected.constraint_name
)
SELECT jsonb_build_object(
  'global_indexes', to_jsonb(index_checks),
  'old_constraints', to_jsonb(old_fk_checks),
  'composite_constraints', to_jsonb(new_fk_checks),
  'all_passed',
    index_checks.expected_old_index_count
    AND index_checks.old_global_indexes_absent
    AND old_fk_checks.expected_old_constraint_count
    AND old_fk_checks.old_constraints_absent
    AND new_fk_checks.expected_new_constraint_count
    AND new_fk_checks.all_composite_constraints_validated
) AS s4_global_key_fk_cutover_smoke_test
FROM index_checks
CROSS JOIN old_fk_checks
CROSS JOIN new_fk_checks;
