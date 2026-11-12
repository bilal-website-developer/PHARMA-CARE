-- S4 read-only catalog inventory. Returns schema definitions only, not row data.
-- Run before preparing unique-index or same-shop foreign-key changes.
WITH scoped_tables(table_name) AS (
    VALUES
      ('profiles'),
      ('audit_logs'),
      ('brands'),
      ('categories'),
      ('customers'),
      ('khata_entries'),
      ('medicine_units'),
      ('medicines'),
      ('print_requests'),
      ('purchase_items'),
      ('purchase_number_state'),
      ('purchases'),
      ('return_policy_settings'),
      ('sale_item_batch_allocations'),
      ('sale_items'),
      ('sale_payments'),
      ('sale_return_items'),
      ('sale_returns'),
      ('sales'),
      ('stock_batches'),
      ('stock_movements'),
      ('supplier_ledger'),
      ('suppliers'),
      ('trash_bin_events')
),
unique_indexes AS (
    SELECT
      table_class.relname AS table_name,
      index_class.relname AS index_name,
      constraint_info.conname AS constraint_name,
      pg_catalog.pg_get_indexdef(index_info.indexrelid) AS definition,
      index_info.indisvalid AS is_valid,
      index_info.indisready AS is_ready
    FROM pg_catalog.pg_index AS index_info
    JOIN pg_catalog.pg_class AS table_class
      ON table_class.oid = index_info.indrelid
    JOIN pg_catalog.pg_namespace AS table_schema
      ON table_schema.oid = table_class.relnamespace
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_info.indexrelid
    LEFT JOIN pg_catalog.pg_constraint AS constraint_info
      ON constraint_info.conindid = index_info.indexrelid
     AND constraint_info.contype = 'u'
    WHERE table_schema.nspname = 'public'
      AND table_class.relname IN (
        'brands', 'categories', 'medicines', 'medicine_units', 'sales', 'purchases'
      )
      AND index_info.indisunique
),
foreign_keys AS (
    SELECT
      source.relname AS source_table,
      constraint_info.conname AS constraint_name,
      target.relname AS target_table,
      pg_catalog.pg_get_constraintdef(constraint_info.oid, true) AS definition,
      constraint_info.convalidated AS is_validated
    FROM pg_catalog.pg_constraint AS constraint_info
    JOIN pg_catalog.pg_class AS source
      ON source.oid = constraint_info.conrelid
    JOIN pg_catalog.pg_namespace AS source_schema
      ON source_schema.oid = source.relnamespace
    JOIN pg_catalog.pg_class AS target
      ON target.oid = constraint_info.confrelid
    JOIN pg_catalog.pg_namespace AS target_schema
      ON target_schema.oid = target.relnamespace
    WHERE constraint_info.contype = 'f'
      AND source_schema.nspname = 'public'
      AND target_schema.nspname = 'public'
      AND (
        source.relname IN (SELECT table_name FROM scoped_tables)
        OR target.relname IN (SELECT table_name FROM scoped_tables)
      )
)
SELECT jsonb_build_object(
  'unique_indexes', coalesce(
    (SELECT jsonb_agg(to_jsonb(unique_indexes) ORDER BY table_name, index_name)
     FROM unique_indexes),
    '[]'::jsonb
  ),
  'foreign_keys', coalesce(
    (SELECT jsonb_agg(to_jsonb(foreign_keys) ORDER BY source_table, constraint_name)
     FROM foreign_keys),
    '[]'::jsonb
  )
) AS s4_key_and_fk_inventory;
