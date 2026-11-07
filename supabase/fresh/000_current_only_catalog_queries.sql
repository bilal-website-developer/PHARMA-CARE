-- S1 read-only inventory for the CURRENT project only.
-- Run each SELECT separately in SQL Editor. Every query returns one cell.
-- These queries inspect catalog metadata, never business-table rows.
-- Function definitions are source text; do not paste any accidental hard-coded
-- secrets or personal literals. Report the affected function and redact the literal.

-- Q1 — check whether the SQL Editor role can bypass RLS; the snapshot also validates table access.
SELECT pg_catalog.jsonb_build_object(
  'current_role', current_user,
  'superuser', r.rolsuper,
  'bypasses_rls', r.rolbypassrls
)::text AS current_role_check
FROM pg_catalog.pg_roles AS r
WHERE r.rolname = current_user;

-- Q2 — relations, object types, RLS state, partition status (not row contents/counts).
SELECT coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'schema', n.nspname,
      'object', c.relname,
      'kind', c.relkind,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'is_partition', c.relispartition
    )
    ORDER BY c.relkind, c.relname
  ),
  '[]'::jsonb
)::text AS relation_inventory
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S');

-- Q3 — routines, owner, security-definer flag, search path, and ACL.
SELECT pg_catalog.jsonb_build_object(
  'routine_count', count(*),
  'routines', coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'signature', p.oid::regprocedure::text,
        'kind', p.prokind,
        'owner', pg_catalog.pg_get_userbyid(p.proowner),
        'security_definer', p.prosecdef,
        'search_path', coalesce(
          (
            SELECT split_part(setting, '=', 2)
            FROM pg_catalog.unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg(setting)
            WHERE setting LIKE 'search_path=%'
            LIMIT 1
          ),
          '(not set)'
        ),
        'acl', coalesce(p.proacl::text, '(default ACL)')
      )
      ORDER BY p.oid::regprocedure::text
    ),
    '[]'::jsonb
  )
)::text AS routine_inventory
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p', 'w');

-- Q4 — all policies, including exact USING / WITH CHECK expressions.
SELECT coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'table', tablename,
      'policy', policyname,
      'permissive', permissive,
      'roles', roles,
      'command', cmd,
      'using', qual,
      'with_check', with_check
    )
    ORDER BY tablename, policyname
  ),
  '[]'::jsonb
)::text AS policy_inventory
FROM pg_catalog.pg_policies
WHERE schemaname = 'public';

-- Q5 — all non-internal triggers and their exact definitions/state.
SELECT coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'table', pg_catalog.format('%I.%I', n.nspname, t.relname),
      'trigger', tr.tgname,
      'enabled_state', tr.tgenabled,
      'definition', pg_catalog.pg_get_triggerdef(tr.oid, true)
    )
    ORDER BY n.nspname, t.relname, tr.tgname
  ),
  '[]'::jsonb
)::text AS trigger_inventory
FROM pg_catalog.pg_trigger AS tr
JOIN pg_catalog.pg_class AS t ON t.oid = tr.tgrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND NOT tr.tgisinternal;

-- Q6 — explicit relation/schema/routine/default ACL listings.
SELECT coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'object_type', object_type,
      'object_name', object_name,
      'acl', acl
    )
    ORDER BY object_type, object_name
  ),
  '[]'::jsonb
)::text AS acl_inventory
FROM (
  SELECT 'schema'::text AS object_type, n.nspname::text AS object_name, n.nspacl::text AS acl
  FROM pg_catalog.pg_namespace AS n
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'relation', pg_catalog.format('%I.%I', n.nspname, c.relname), c.relacl::text
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  UNION ALL
  SELECT 'routine', p.oid::regprocedure::text, p.proacl::text
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'type', pg_catalog.format('%I.%I', n.nspname, t.typname), t.typacl::text
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'default', pg_catalog.format('%I.%I.%s', n.nspname, r.rolname, d.defaclobjtype), d.defaclacl::text
  FROM pg_catalog.pg_default_acl AS d
  JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
  JOIN pg_catalog.pg_roles AS r ON r.oid = d.defaclrole
  WHERE n.nspname = 'public'
) AS acl_rows;

-- Q7 — constraints and indexes (definitions only).
SELECT pg_catalog.jsonb_build_object(
  'constraints', coalesce(
    (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table', pg_catalog.format('%I.%I', n.nspname, t.relname),
          'constraint', c.conname,
          'type', c.contype,
          'validated', c.convalidated,
          'deferrable', c.condeferrable,
          'definition', pg_catalog.pg_get_constraintdef(c.oid, true)
        )
        ORDER BY t.relname, c.conname
      )
      FROM pg_catalog.pg_constraint AS c
      JOIN pg_catalog.pg_class AS t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
    ),
    '[]'::jsonb
  ),
  'indexes', coalesce(
    (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table', tablename,
          'index', indexname,
          'definition', indexdef
        )
        ORDER BY tablename, indexname
      )
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public'
    ),
    '[]'::jsonb
  )
)::text AS constraint_index_inventory;

-- Q8 — sequence definitions only (sequence values are held inside the S1 snapshot).
SELECT coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'sequence', pg_catalog.format('%I.%I', schemaname, sequencename),
      'data_type', data_type,
      'start_value', start_value,
      'min_value', min_value,
      'max_value', max_value,
      'increment_by', increment_by,
      'cycle', cycle
    )
    ORDER BY sequencename
  ),
  '[]'::jsonb
)::text AS sequence_inventory
FROM pg_catalog.pg_sequences
WHERE schemaname = 'public';

-- Q9 — confirm barcode-assignment routine and global medicine index presence.
SELECT pg_catalog.jsonb_build_object(
  'barcode_assignment_routines', coalesce(
    (
      SELECT pg_catalog.jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname ILIKE '%barcode%'
    ),
    '[]'::jsonb
  ),
  'medicines_barcode_unique_index_exists', EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'medicines_barcode_unique'
  ),
  'matching_index_definition', (
    SELECT indexdef
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'medicines_barcode_unique'
    LIMIT 1
  )
)::text AS barcode_status;

-- Q10 — function-definition batches. Run batch_number 1, then 2, etc.
-- Each result is one cell; the cell states how many batches exist.
-- Batch size is six routines. Continue until the result says NO DEFINITIONS IN THIS BATCH.
WITH settings AS (
  SELECT 1::integer AS batch_number
),
routines AS (
  SELECT
    p.oid::regprocedure::text AS signature,
    pg_catalog.pg_get_functiondef(p.oid) AS definition,
    row_number() OVER (ORDER BY p.oid::regprocedure::text) AS row_number
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p', 'w')
),
summary AS (
  SELECT
    s.batch_number,
    count(r.signature)::integer AS routine_count,
    coalesce(max(r.row_number), 0)::integer AS total_count
  FROM settings AS s
  LEFT JOIN routines AS r ON true
  GROUP BY s.batch_number
),
selected AS (
  SELECT r.*
  FROM routines AS r
  CROSS JOIN settings AS s
  WHERE r.row_number BETWEEN ((s.batch_number - 1) * 6 + 1) AND (s.batch_number * 6)
)
SELECT pg_catalog.format(
         'BATCH %s; TOTAL ROUTINES %s; TOTAL BATCHES %s',
         pg_catalog.lpad(summary.batch_number::text, 3, '0'),
         summary.total_count,
         CASE WHEN summary.total_count = 0 THEN 0 ELSE ceil(summary.total_count / 6.0)::integer END
       )
       || E'\n'
       || coalesce(
         (
           SELECT pg_catalog.string_agg(
             pg_catalog.format('-- %s\n%s', selected.signature, selected.definition),
             E'\n\n'
             ORDER BY selected.row_number
           )
           FROM selected
         ),
         'NO DEFINITIONS IN THIS BATCH'
       ) AS function_definition_batch
FROM summary;

-- Q11 — standalone type definitions and aggregate routine metadata.
SELECT pg_catalog.jsonb_build_object(
  'types', coalesce(
    (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', pg_catalog.format('%I.%I', n.nspname, t.typname),
          'catalog_row', pg_catalog.to_jsonb(t),
          'formatted_type', pg_catalog.format_type(t.oid, NULL),
          'enum_labels', coalesce((
            SELECT pg_catalog.jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
            FROM pg_catalog.pg_enum AS e
            WHERE e.enumtypid = t.oid
          ), '[]'::jsonb),
          'domain_constraints', coalesce((
            SELECT pg_catalog.jsonb_agg(
                     pg_catalog.jsonb_build_object(
                       'name', c.conname,
                       'definition', pg_catalog.pg_get_constraintdef(c.oid, true)
                     )
                     ORDER BY c.conname
                   )
            FROM pg_catalog.pg_constraint AS c
            WHERE c.contypid = t.oid
          ), '[]'::jsonb),
          'composite_attributes', coalesce((
            SELECT pg_catalog.jsonb_agg(
                     pg_catalog.jsonb_build_object(
                       'name', a.attname,
                       'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
                       'not_null', a.attnotnull,
                       'default_or_expression', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
                     )
                     ORDER BY a.attnum
                   )
            FROM pg_catalog.pg_attribute AS a
            LEFT JOIN pg_catalog.pg_attrdef AS d
              ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = t.typrelid
              AND a.attnum > 0
              AND NOT a.attisdropped
          ), '[]'::jsonb),
          'range_metadata', (
            SELECT pg_catalog.jsonb_build_object(
              'subtype', pg_catalog.format_type(r.rngsubtype, NULL),
              'collation', r.rngcollation,
              'canonical_function', CASE WHEN r.rngcanonical = 0 THEN NULL ELSE r.rngcanonical::regprocedure::text END,
              'subdiff_function', CASE WHEN r.rngsubdiff = 0 THEN NULL ELSE r.rngsubdiff::regprocedure::text END,
              'multirange_type', CASE WHEN r.rngmultitypid = 0 THEN NULL ELSE r.rngmultitypid::regtype::text END
            )
            FROM pg_catalog.pg_range AS r
            WHERE r.rngtypid = t.oid
          )
        )
        ORDER BY t.typname
      )
      FROM pg_catalog.pg_type AS t
      JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typtype <> 'p'
    ),
    '[]'::jsonb
  ),
  'aggregates', coalesce(
    (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'signature', p.oid::regprocedure::text,
          'catalog_row', pg_catalog.to_jsonb(a),
          'owner', pg_catalog.pg_get_userbyid(p.proowner),
          'identity_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
          'result_type', pg_catalog.format_type(p.prorettype, NULL),
          'transition_function', a.aggtransfn::regprocedure::text,
          'final_function', CASE WHEN a.aggfinalfn = 0 THEN NULL ELSE a.aggfinalfn::regprocedure::text END,
          'combine_function', CASE WHEN a.aggcombinefn = 0 THEN NULL ELSE a.aggcombinefn::regprocedure::text END,
          'serialize_function', CASE WHEN a.aggserialfn = 0 THEN NULL ELSE a.aggserialfn::regprocedure::text END,
          'deserialize_function', CASE WHEN a.aggdeserialfn = 0 THEN NULL ELSE a.aggdeserialfn::regprocedure::text END,
          'state_type', pg_catalog.format_type(a.aggtranstype, NULL),
          'moving_transition_function', CASE WHEN a.aggmtransfn = 0 THEN NULL ELSE a.aggmtransfn::regprocedure::text END,
          'moving_inverse_function', CASE WHEN a.aggminvtransfn = 0 THEN NULL ELSE a.aggminvtransfn::regprocedure::text END,
          'moving_final_function', CASE WHEN a.aggmfinalfn = 0 THEN NULL ELSE a.aggmfinalfn::regprocedure::text END,
          'moving_state_type', CASE WHEN a.aggmtranstype = 0 THEN NULL ELSE pg_catalog.format_type(a.aggmtranstype, NULL) END,
          'sort_operator', CASE WHEN a.aggsortop = 0 THEN NULL ELSE a.aggsortop::regoperator::text END
        )
        ORDER BY p.oid::regprocedure::text
      )
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_aggregate AS a ON a.aggfnoid = p.oid
      WHERE n.nspname = 'public'
    ),
    '[]'::jsonb
  )
)::text AS type_and_aggregate_inventory;
