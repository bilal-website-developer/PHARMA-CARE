-- Read-only metadata check for S4 additive stage 011.
WITH expected_indexes(index_name) AS (
  VALUES
    ('brands_shop_name_lower_key'),
    ('categories_shop_name_lower_key'),
    ('medicines_shop_code_key'),
    ('medicines_shop_barcode_unique'),
    ('purchases_shop_pr_no_key'),
    ('sales_shop_invoice_number_key'),
    ('customers_shop_id_id_key'),
    ('sales_shop_id_id_key'),
    ('medicines_shop_id_id_key'),
    ('purchases_shop_id_id_key'),
    ('stock_batches_shop_id_id_key'),
    ('medicine_units_shop_id_id_key'),
    ('suppliers_shop_id_id_key'),
    ('sale_items_shop_id_id_key'),
    ('sale_item_batch_allocations_shop_id_id_key'),
    ('sale_returns_shop_id_id_key')
),
expected_constraints(table_name, constraint_name) AS (
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
index_check AS (
  SELECT
    count(*) = 16 AS expected_index_count,
    coalesce(bool_and(
      index_info.indexrelid IS NOT NULL
      AND index_info.indisunique
      AND index_info.indisvalid
      AND index_info.indisready
    ), false)
      AS all_indexes_unique_valid_and_ready
  FROM expected_indexes AS expected
  LEFT JOIN pg_catalog.pg_class AS index_class
    ON index_class.relname = expected.index_name
  LEFT JOIN pg_catalog.pg_namespace AS index_schema
    ON index_schema.oid = index_class.relnamespace
   AND index_schema.nspname = 'public'
  LEFT JOIN pg_catalog.pg_index AS index_info
    ON index_info.indexrelid = index_class.oid
   AND index_schema.nspname = 'public'
),
constraint_check AS (
  SELECT
    count(*) = 27 AS expected_constraint_count,
    coalesce(bool_and(
      constraint_info.oid IS NOT NULL
      AND constraint_info.contype = 'f'
      AND constraint_info.convalidated = false
      AND pg_catalog.pg_get_constraintdef(constraint_info.oid, true) LIKE 'FOREIGN KEY (shop_id,%'
    ), false) AS all_constraints_are_unvalidated_composite_fks
  FROM expected_constraints AS expected
  LEFT JOIN pg_catalog.pg_constraint AS constraint_info
    ON constraint_info.conrelid = to_regclass(format('public.%I', expected.table_name))
   AND constraint_info.conname = expected.constraint_name
)
SELECT jsonb_build_object(
  'indexes', to_jsonb(index_check),
  'constraints', to_jsonb(constraint_check),
  'all_passed',
    index_check.expected_index_count
    AND index_check.all_indexes_unique_valid_and_ready
    AND constraint_check.expected_constraint_count
    AND constraint_check.all_constraints_are_unvalidated_composite_fks
) AS s4_additive_keys_fks_smoke_test
FROM index_check
CROSS JOIN constraint_check;
