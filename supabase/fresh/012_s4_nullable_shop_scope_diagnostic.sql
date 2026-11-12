-- Read-only diagnosis for nullable shop_id rows after the 011 preflight stop.
-- Returns counts and actor-role categories only; no log content or identifiers.
WITH unassigned AS (
  SELECT 'audit_logs'::text AS table_name, count(*)::bigint AS row_count
  FROM public.audit_logs WHERE shop_id IS NULL
  UNION ALL SELECT 'brands', count(*)::bigint FROM public.brands WHERE shop_id IS NULL
  UNION ALL SELECT 'categories', count(*)::bigint FROM public.categories WHERE shop_id IS NULL
  UNION ALL SELECT 'customers', count(*)::bigint FROM public.customers WHERE shop_id IS NULL
  UNION ALL SELECT 'khata_entries', count(*)::bigint FROM public.khata_entries WHERE shop_id IS NULL
  UNION ALL SELECT 'medicine_units', count(*)::bigint FROM public.medicine_units WHERE shop_id IS NULL
  UNION ALL SELECT 'medicines', count(*)::bigint FROM public.medicines WHERE shop_id IS NULL
  UNION ALL SELECT 'print_requests', count(*)::bigint FROM public.print_requests WHERE shop_id IS NULL
  UNION ALL SELECT 'purchase_items', count(*)::bigint FROM public.purchase_items WHERE shop_id IS NULL
  UNION ALL SELECT 'purchase_number_state', count(*)::bigint FROM public.purchase_number_state WHERE shop_id IS NULL
  UNION ALL SELECT 'purchases', count(*)::bigint FROM public.purchases WHERE shop_id IS NULL
  UNION ALL SELECT 'return_policy_settings', count(*)::bigint FROM public.return_policy_settings WHERE shop_id IS NULL
  UNION ALL SELECT 'sale_item_batch_allocations', count(*)::bigint FROM public.sale_item_batch_allocations WHERE shop_id IS NULL
  UNION ALL SELECT 'sale_items', count(*)::bigint FROM public.sale_items WHERE shop_id IS NULL
  UNION ALL SELECT 'sale_payments', count(*)::bigint FROM public.sale_payments WHERE shop_id IS NULL
  UNION ALL SELECT 'sale_return_items', count(*)::bigint FROM public.sale_return_items WHERE shop_id IS NULL
  UNION ALL SELECT 'sale_returns', count(*)::bigint FROM public.sale_returns WHERE shop_id IS NULL
  UNION ALL SELECT 'sales', count(*)::bigint FROM public.sales WHERE shop_id IS NULL
  UNION ALL SELECT 'stock_batches', count(*)::bigint FROM public.stock_batches WHERE shop_id IS NULL
  UNION ALL SELECT 'stock_movements', count(*)::bigint FROM public.stock_movements WHERE shop_id IS NULL
  UNION ALL SELECT 'supplier_ledger', count(*)::bigint FROM public.supplier_ledger WHERE shop_id IS NULL
  UNION ALL SELECT 'suppliers', count(*)::bigint FROM public.suppliers WHERE shop_id IS NULL
  UNION ALL SELECT 'trash_bin_events', count(*)::bigint FROM public.trash_bin_events WHERE shop_id IS NULL
),
actor_scope AS (
  SELECT
    'audit_logs'::text AS table_name,
    count(*) FILTER (WHERE log.shop_id IS NULL)::bigint AS null_shop_rows,
    count(*) FILTER (
      WHERE log.shop_id IS NULL AND profile.role::text = 'super_admin'
    )::bigint AS null_shop_super_admin_actor_rows,
    count(*) FILTER (
      WHERE log.shop_id IS NULL AND log.actor_id IS NULL
    )::bigint AS null_shop_null_actor_rows,
    count(*) FILTER (
      WHERE log.shop_id IS NULL AND log.actor_id IS NOT NULL
        AND profile.id IS NULL
    )::bigint AS null_shop_missing_profile_rows,
    count(*) FILTER (
      WHERE log.shop_id IS NULL AND profile.id IS NOT NULL
        AND profile.role::text <> 'super_admin'
    )::bigint AS null_shop_non_super_admin_actor_rows
  FROM public.audit_logs AS log
  LEFT JOIN public.profiles AS profile ON profile.id = log.actor_id

  UNION ALL

  SELECT
    'trash_bin_events',
    count(*) FILTER (WHERE bin_row.shop_id IS NULL)::bigint,
    count(*) FILTER (
      WHERE bin_row.shop_id IS NULL AND profile.role::text = 'super_admin'
    )::bigint,
    count(*) FILTER (
      WHERE bin_row.shop_id IS NULL AND bin_row.actor_id IS NULL
    )::bigint,
    count(*) FILTER (
      WHERE bin_row.shop_id IS NULL AND bin_row.actor_id IS NOT NULL
        AND profile.id IS NULL
    )::bigint,
    count(*) FILTER (
      WHERE bin_row.shop_id IS NULL AND profile.id IS NOT NULL
        AND profile.role::text <> 'super_admin'
    )::bigint
  FROM public.trash_bin_events AS bin_row
  LEFT JOIN public.profiles AS profile ON profile.id = bin_row.actor_id
),
new_indexes(index_name) AS (
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
)
SELECT jsonb_build_object(
  'unassigned_rows_by_table', coalesce(
    (SELECT jsonb_object_agg(table_name, row_count)
     FROM unassigned WHERE row_count > 0),
    '{}'::jsonb
  ),
  'nullable_actor_rows', coalesce(
    (SELECT jsonb_object_agg(table_name, to_jsonb(actor_scope))
     FROM actor_scope),
    '{}'::jsonb
  ),
  '011_objects_present', jsonb_build_object(
    'shop_scoped_indexes', (
      SELECT count(*) FROM new_indexes AS expected
      JOIN pg_catalog.pg_class AS object ON object.relname = expected.index_name
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = object.relnamespace AND namespace.nspname = 'public'
    ),
    'composite_foreign_keys', (
      SELECT count(*) FROM new_constraints AS expected
      JOIN pg_catalog.pg_constraint AS constraint_info
        ON constraint_info.conname = expected.constraint_name
      JOIN pg_catalog.pg_class AS source
        ON source.oid = constraint_info.conrelid
       AND source.relname = expected.table_name
      JOIN pg_catalog.pg_namespace AS source_schema
        ON source_schema.oid = source.relnamespace
       AND source_schema.nspname = 'public'
    )
  )
) AS s4_nullable_scope_diagnostic;
