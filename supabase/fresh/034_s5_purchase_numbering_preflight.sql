-- Read-only preflight for converting purchase numbering to per-shop state.
-- Returns indexes, constraints, and aggregate shop-coverage data only.
WITH expected_tables(table_name) AS (
  VALUES
    ('purchase_number_state'),
    ('purchases'),
    ('purchase_items'),
    ('suppliers'),
    ('stock_batches'),
    ('stock_movements'),
    ('supplier_ledger')
),
table_rows AS (
  SELECT 'purchase_number_state' AS table_name, shop_id FROM public.purchase_number_state
  UNION ALL
  SELECT 'purchases', shop_id FROM public.purchases
  UNION ALL
  SELECT 'purchase_items', shop_id FROM public.purchase_items
  UNION ALL
  SELECT 'suppliers', shop_id FROM public.suppliers
  UNION ALL
  SELECT 'stock_batches', shop_id FROM public.stock_batches
  UNION ALL
  SELECT 'stock_movements', shop_id FROM public.stock_movements
  UNION ALL
  SELECT 'supplier_ledger', shop_id FROM public.supplier_ledger
),
table_coverage AS (
  SELECT
    expected.table_name,
    count(row_data.table_name)::bigint AS row_count,
    count(*) FILTER (
      WHERE row_data.table_name IS NOT NULL AND row_data.shop_id IS NULL
    )::bigint AS null_shop_id_count,
    count(DISTINCT row_data.shop_id)::bigint AS distinct_shop_count
  FROM expected_tables expected
  LEFT JOIN table_rows row_data ON row_data.table_name = expected.table_name
  GROUP BY expected.table_name
),
counter_summary AS (
  SELECT jsonb_build_object(
    'row_count', count(*)::bigint,
    'null_shop_id_count', count(*) FILTER (WHERE shop_id IS NULL)::bigint,
    'non_one_id_count', count(*) FILTER (WHERE id <> 1)::bigint,
    'distinct_shop_count', count(DISTINCT shop_id)::bigint,
    'duplicate_shop_counter_groups', (
      SELECT count(*)::bigint
      FROM (
        SELECT shop_id
        FROM public.purchase_number_state
        WHERE shop_id IS NOT NULL
        GROUP BY shop_id
        HAVING count(*) > 1
      ) duplicate_counters
    ),
    'shops_missing_counter_count', (
      SELECT count(*)::bigint
      FROM public.shops shop
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.purchase_number_state counter
        WHERE counter.shop_id = shop.id
      )
    ),
    'max_last_number', max(last_number)
  ) AS summary
  FROM public.purchase_number_state
),
purchase_number_summary AS (
  SELECT jsonb_build_object(
    'purchase_count', count(*)::bigint,
    'null_shop_id_count', count(*) FILTER (WHERE shop_id IS NULL)::bigint,
    'null_pr_no_count', count(*) FILTER (WHERE pr_no IS NULL)::bigint,
    'unparseable_pr_no_count', count(*) FILTER (
      WHERE pr_no IS NOT NULL AND pr_no !~ '^PR-[0-9]+$'
    )::bigint,
    'distinct_shop_count', count(DISTINCT shop_id)::bigint,
    'max_numeric_pr_no', max(substring(pr_no FROM '^PR-([0-9]+)$')::numeric)
  ) AS summary
  FROM public.purchases
),
per_shop_number_summary AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'shop_ordinal', shop_ordinal,
    'purchase_count', purchase_count,
    'null_pr_no_count', null_pr_no_count,
    'unparseable_pr_no_count', unparseable_pr_no_count,
    'max_numeric_pr_no', max_numeric_pr_no,
    'counter_row_count', counter_row_count,
    'max_last_number', max_last_number
  ) ORDER BY shop_ordinal), '[]'::jsonb) AS summary
  FROM (
    SELECT
      row_number() OVER (ORDER BY shop.id)::integer AS shop_ordinal,
      count(DISTINCT purchase.id)::bigint AS purchase_count,
      count(DISTINCT purchase.id) FILTER (WHERE purchase.pr_no IS NULL)::bigint AS null_pr_no_count,
      count(DISTINCT purchase.id) FILTER (
        WHERE purchase.pr_no IS NOT NULL AND purchase.pr_no !~ '^PR-[0-9]+$'
      )::bigint AS unparseable_pr_no_count,
      max(substring(purchase.pr_no FROM '^PR-([0-9]+)$')::numeric) AS max_numeric_pr_no,
      count(DISTINCT counter.id)::bigint AS counter_row_count,
      max(counter.last_number) AS max_last_number
    FROM public.shops shop
    LEFT JOIN public.purchases purchase ON purchase.shop_id = shop.id
    LEFT JOIN public.purchase_number_state counter ON counter.shop_id = shop.id
    GROUP BY shop.id
  ) per_shop
),
purchase_number_collisions AS (
  SELECT jsonb_build_object(
    'duplicate_pr_no_groups_within_shop', (
      SELECT count(*)::bigint
      FROM (
        SELECT shop_id, pr_no
        FROM public.purchases
        WHERE shop_id IS NOT NULL AND pr_no IS NOT NULL
        GROUP BY shop_id, pr_no
        HAVING count(*) > 1
      ) duplicate_numbers
    ),
    'pr_no_values_shared_across_shops', (
      SELECT count(*)::bigint
      FROM (
        SELECT pr_no
        FROM public.purchases
        WHERE shop_id IS NOT NULL AND pr_no IS NOT NULL
        GROUP BY pr_no
        HAVING count(DISTINCT shop_id) > 1
      ) shared_numbers
    )
  ) AS summary
),
index_inventory AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table_name', index_table.relname,
    'index_name', index_class.relname,
    'is_unique', index_info.indisunique,
    'is_primary', index_info.indisprimary,
    'is_valid', index_info.indisvalid,
    'definition', pg_catalog.pg_get_indexdef(index_class.oid)
  ) ORDER BY index_table.relname, index_class.relname), '[]'::jsonb) AS indexes
  FROM pg_catalog.pg_index index_info
  JOIN pg_catalog.pg_class index_table ON index_table.oid = index_info.indrelid
  JOIN pg_catalog.pg_class index_class ON index_class.oid = index_info.indexrelid
  JOIN pg_catalog.pg_namespace table_schema ON table_schema.oid = index_table.relnamespace
  WHERE table_schema.nspname = 'public'
    AND index_table.relname IN ('purchases', 'purchase_number_state')
),
constraint_inventory AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table_name', table_class.relname,
    'constraint_name', constraint_row.conname,
    'constraint_type', constraint_row.contype,
    'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)
  ) ORDER BY table_class.relname, constraint_row.conname), '[]'::jsonb) AS constraints
  FROM pg_catalog.pg_constraint constraint_row
  JOIN pg_catalog.pg_class table_class ON table_class.oid = constraint_row.conrelid
  JOIN pg_catalog.pg_namespace table_schema ON table_schema.oid = table_class.relnamespace
  WHERE table_schema.nspname = 'public'
    AND table_class.relname IN ('purchases', 'purchase_number_state')
)
SELECT jsonb_build_object(
  'table_coverage', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'row_count', row_count,
      'null_shop_id_count', null_shop_id_count,
      'distinct_shop_count', distinct_shop_count
    ) ORDER BY table_name), '[]'::jsonb)
    FROM table_coverage
  ),
  'purchase_number_state', (SELECT summary FROM counter_summary),
  'purchase_number_summary', (SELECT summary FROM purchase_number_summary),
  'per_shop_number_summary', (SELECT summary FROM per_shop_number_summary),
  'purchase_number_collisions', (SELECT summary FROM purchase_number_collisions),
  'indexes', (SELECT indexes FROM index_inventory),
  'constraints', (SELECT constraints FROM constraint_inventory)
) AS s5_purchase_numbering_preflight;
