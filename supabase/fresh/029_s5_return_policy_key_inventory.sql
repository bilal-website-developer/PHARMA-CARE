-- Read-only preflight for Batch 029's per-shop return-policy key change.
-- Returns key, nullability, row-integrity, and coverage metadata without exposing shop IDs.
WITH policy_table AS (
  SELECT to_regclass('public.return_policy_settings') AS table_oid
),
policy_columns AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'column_name', column_info.column_name,
    'data_type', column_info.data_type,
    'is_nullable', column_info.is_nullable
  ) ORDER BY column_info.ordinal_position), '[]'::jsonb) AS details
  FROM information_schema.columns column_info
  WHERE column_info.table_schema = 'public'
    AND column_info.table_name = 'return_policy_settings'
),
primary_keys AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'constraint_name', constraint_row.conname,
    'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)
  ) ORDER BY constraint_row.conname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = (SELECT table_oid FROM policy_table)
    AND constraint_row.contype = 'p'
),
unique_indexes AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'index_name', index_class.relname,
    'definition', pg_catalog.pg_get_indexdef(index_class.oid),
    'is_primary', index_row.indisprimary,
    'is_valid', index_row.indisvalid
  ) ORDER BY index_class.relname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_index index_row
  JOIN pg_catalog.pg_class index_class ON index_class.oid = index_row.indexrelid
  WHERE index_row.indrelid = (SELECT table_oid FROM policy_table)
    AND index_row.indisunique
),
foreign_key_references AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'constraint_name', constraint_row.conname,
    'referencing_table', constraint_row.conrelid::regclass::text,
    'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)
  ) ORDER BY constraint_row.conname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.confrelid = (SELECT table_oid FROM policy_table)
    AND constraint_row.contype = 'f'
),
row_summary AS (
  SELECT jsonb_build_object(
    'row_count', count(*),
    'shop_id_null_count', count(*) FILTER (WHERE settings.shop_id IS NULL),
    'non_one_id_count', count(*) FILTER (WHERE settings.id <> 1),
    'missing_shop_reference_count', count(*) FILTER (WHERE shop.id IS NULL),
    'distinct_shop_count', count(DISTINCT settings.shop_id)
  ) AS details
  FROM public.return_policy_settings settings
  LEFT JOIN public.shops shop ON shop.id = settings.shop_id
),
shop_coverage AS (
  SELECT jsonb_build_object(
    'shop_count', (SELECT count(*) FROM public.shops),
    'shops_missing_policy_count', (
      SELECT count(*)
      FROM public.shops shop
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.return_policy_settings settings
        WHERE settings.shop_id = shop.id AND settings.id = 1
      )
    )
  ) AS details
)
SELECT jsonb_build_object(
  'table_found', (SELECT table_oid IS NOT NULL FROM policy_table),
  'rls_enabled', coalesce((
    SELECT table_class.relrowsecurity
    FROM policy_table
    JOIN pg_catalog.pg_class table_class ON table_class.oid = policy_table.table_oid
  ), false),
  'columns', (SELECT details FROM policy_columns),
  'primary_keys', (SELECT details FROM primary_keys),
  'unique_indexes', (SELECT details FROM unique_indexes),
  'foreign_key_references', (SELECT details FROM foreign_key_references),
  'policy_rows', (SELECT details FROM row_summary),
  'shop_coverage', (SELECT details FROM shop_coverage)
) AS s5_return_policy_key_inventory;
