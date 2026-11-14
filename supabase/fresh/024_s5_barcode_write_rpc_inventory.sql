-- Read-only S5 review of barcode writers, sequence grants/indexes, and duplicate counts.
-- Duplicate output contains counts only; no barcode values are returned.
WITH expected AS (
  SELECT *
  FROM (VALUES
    ('public.assign_medicine_barcode', 'public.assign_medicine_barcode(uuid,text,boolean)'),
    ('public.assign_missing_barcodes', 'public.assign_missing_barcodes(uuid[])'),
    ('public.ean13_check_digit', 'public.ean13_check_digit(text)')
  ) AS routine_list(expected_name, signature)
),
duplicate_groups AS (
  SELECT shop_id, lower(btrim(barcode)) AS normalized_barcode,
         count(*) AS row_count, count(DISTINCT source) AS source_count
  FROM (
    SELECT shop_id, barcode, 'medicine'::text AS source
    FROM public.medicines
    WHERE nullif(btrim(barcode), '') IS NOT NULL
    UNION ALL
    SELECT shop_id, barcode, 'medicine_unit'::text AS source
    FROM public.medicine_units
    WHERE nullif(btrim(barcode), '') IS NOT NULL
  ) AS all_values
  GROUP BY shop_id, lower(btrim(barcode))
  HAVING count(*) > 1
)
SELECT jsonb_build_object(
  'routines', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'expected_name', expected.expected_name,
      'signature', expected.signature,
      'routine_found', routine.oid IS NOT NULL,
      'identity_arguments', CASE
        WHEN routine.oid IS NULL THEN NULL
        ELSE pg_catalog.pg_get_function_identity_arguments(routine.oid)
      END,
      'security_definer', routine.prosecdef,
      'function_settings', routine.proconfig,
      'anon_can_execute', CASE
        WHEN routine.oid IS NULL THEN NULL
        ELSE has_function_privilege('anon', routine.oid, 'EXECUTE')
      END,
      'authenticated_can_execute', CASE
        WHEN routine.oid IS NULL THEN NULL
        ELSE has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      END,
      'function_definition', CASE
        WHEN routine.oid IS NULL THEN NULL
        ELSE pg_catalog.pg_get_functiondef(routine.oid)
      END
    ) ORDER BY expected.expected_name), '[]'::jsonb)
    FROM expected
    LEFT JOIN pg_catalog.pg_proc AS routine
      ON routine.oid = to_regprocedure(expected.signature)
  ),
  'barcode_sequence', jsonb_build_object(
    'sequence_found', to_regclass('public.medicine_barcode_seq') IS NOT NULL,
    'increment_by', (
      SELECT sequence.seqincrement
      FROM pg_catalog.pg_sequence AS sequence
      WHERE sequence.seqrelid = to_regclass('public.medicine_barcode_seq')
    ),
    'minimum_value', (
      SELECT sequence.seqmin
      FROM pg_catalog.pg_sequence AS sequence
      WHERE sequence.seqrelid = to_regclass('public.medicine_barcode_seq')
    ),
    'maximum_value', (
      SELECT sequence.seqmax
      FROM pg_catalog.pg_sequence AS sequence
      WHERE sequence.seqrelid = to_regclass('public.medicine_barcode_seq')
    ),
    'cache_size', (
      SELECT sequence.seqcache
      FROM pg_catalog.pg_sequence AS sequence
      WHERE sequence.seqrelid = to_regclass('public.medicine_barcode_seq')
    ),
    'cycle', (
      SELECT sequence.seqcycle
      FROM pg_catalog.pg_sequence AS sequence
      WHERE sequence.seqrelid = to_regclass('public.medicine_barcode_seq')
    ),
    'acl', (
      SELECT coalesce(class.relacl::text, '(default ACL)')
      FROM pg_catalog.pg_class AS class
      WHERE class.oid = to_regclass('public.medicine_barcode_seq')
    ),
    'anon_usage', CASE
      WHEN to_regclass('public.medicine_barcode_seq') IS NULL
        OR to_regrole('anon') IS NULL THEN NULL
      ELSE has_sequence_privilege(
        to_regrole('anon'), to_regclass('public.medicine_barcode_seq'), 'USAGE'
      )
    END,
    'authenticated_usage', CASE
      WHEN to_regclass('public.medicine_barcode_seq') IS NULL
        OR to_regrole('authenticated') IS NULL THEN NULL
      ELSE has_sequence_privilege(
        to_regrole('authenticated'), to_regclass('public.medicine_barcode_seq'), 'USAGE'
      )
    END
  ),
  'barcode_indexes', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table_name', table_class.relname,
      'index_name', index_class.relname,
      'is_unique', index_info.indisunique,
      'is_valid', index_info.indisvalid,
      'is_ready', index_info.indisready,
      'definition', pg_catalog.pg_get_indexdef(index_info.indexrelid)
    ) ORDER BY table_class.relname, index_class.relname), '[]'::jsonb)
    FROM pg_catalog.pg_index AS index_info
    JOIN pg_catalog.pg_class AS table_class
      ON table_class.oid = index_info.indrelid
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_info.indexrelid
    WHERE index_info.indrelid IN (
      'public.medicines'::regclass,
      'public.medicine_units'::regclass
    )
      AND pg_catalog.pg_get_indexdef(index_info.indexrelid) ILIKE '%barcode%'
  ),
  'duplicate_summary', (
    SELECT jsonb_build_object(
      'duplicate_groups', count(*),
      'rows_in_duplicate_groups', coalesce(sum(row_count), 0),
      'groups_spanning_medicine_and_unit', count(*) FILTER (WHERE source_count > 1),
      'unassigned_shop_groups', count(*) FILTER (WHERE shop_id IS NULL)
    )
    FROM duplicate_groups
  )
) AS s5_barcode_write_inventory;
