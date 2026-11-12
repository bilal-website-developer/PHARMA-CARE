-- Read-only verification that all 27 S4 composite foreign keys are validated.
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
),
checks AS (
  SELECT
    count(*) = 27 AS expected_constraint_count,
    coalesce(bool_and(
      constraint_info.oid IS NOT NULL
      AND constraint_info.contype = 'f'
      AND constraint_info.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_info.oid, true)
        LIKE 'FOREIGN KEY (shop_id,%'
    ), false) AS all_constraints_validated
  FROM expected
  LEFT JOIN pg_catalog.pg_constraint AS constraint_info
    ON constraint_info.conrelid = to_regclass(format('public.%I', expected.table_name))
   AND constraint_info.conname = expected.constraint_name
)
SELECT jsonb_build_object(
  'checks', to_jsonb(checks),
  'all_passed', checks.expected_constraint_count AND checks.all_constraints_validated
) AS s4_composite_fk_validation_smoke_test
FROM checks;
