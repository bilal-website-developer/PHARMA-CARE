-- Read-only check after the failed first S3 attempt.
-- Run this before retrying anything; do not include or execute migration SQL.
WITH expected_tables(table_name) AS (
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
)
SELECT pg_catalog.jsonb_build_object(
  'shops_table_exists', pg_catalog.to_regclass('public.shops') IS NOT NULL,
  'tenant_private_schema_exists', pg_catalog.to_regnamespace('tenant_private') IS NOT NULL,
  'shop_id_columns_present', coalesce((
    SELECT pg_catalog.jsonb_agg(expected.table_name ORDER BY expected.table_name)
    FROM expected_tables AS expected
    WHERE EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = pg_catalog.to_regclass(format('public.%I', expected.table_name))
        AND attribute.attname = 'shop_id'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    )
  ), '[]'::jsonb),
  'shop_id_column_count', (
    SELECT count(*)
    FROM expected_tables AS expected
    WHERE EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = pg_catalog.to_regclass(format('public.%I', expected.table_name))
        AND attribute.attname = 'shop_id'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    )
  )
) AS s3_failed_attempt_state;
