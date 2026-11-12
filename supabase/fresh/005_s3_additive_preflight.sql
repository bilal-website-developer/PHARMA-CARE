-- S3 additive-schema preflight. Read-only; no business rows are returned.
-- Run each SELECT separately in the intended Supabase SQL Editor project.
-- Query 1 helps the owner identify the existing Admin profile for Shop 1.
-- Do not paste the candidate list or its personal details into chat.

-- Query 1: candidate Admin profiles. Identify the existing Shop 1 Admin yourself.
SELECT
  id,
  full_name,
  email,
  is_active,
  deleted_at
FROM public.profiles
WHERE role = 'admin'
ORDER BY is_active DESC, full_name, id;

-- Query 2: current public base-table schema and constraints.
-- This includes columns and definitions only, not table contents.
SELECT pg_catalog.jsonb_build_object(
  'tables', coalesce((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'object_name', c.relname,
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity,
        'columns', coalesce((
          SELECT pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'name', a.attname,
              'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
              'nullable', NOT a.attnotnull,
              'identity', a.attidentity,
              'generated', a.attgenerated,
              'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
            )
            ORDER BY a.attnum
          )
          FROM pg_catalog.pg_attribute AS a
          LEFT JOIN pg_catalog.pg_attrdef AS d
            ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = c.oid
            AND a.attnum > 0
            AND NOT a.attisdropped
        ), '[]'::jsonb),
        'constraints', coalesce((
          SELECT pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'name', con.conname,
              'type', con.contype,
              'validated', con.convalidated,
              'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
            )
            ORDER BY con.conname
          )
          FROM pg_catalog.pg_constraint AS con
          WHERE con.conrelid = c.oid
        ), '[]'::jsonb),
        'indexes', coalesce((
          SELECT pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'name', i.relname,
              'definition', pg_catalog.pg_get_indexdef(i.oid)
            )
            ORDER BY i.relname
          )
          FROM pg_catalog.pg_index AS ix
          JOIN pg_catalog.pg_class AS i ON i.oid = ix.indexrelid
          WHERE ix.indrelid = c.oid
        ), '[]'::jsonb)
      )
      ORDER BY c.relname
    )
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
  ), '[]'::jsonb),
  'policies', coalesce((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'table', p.tablename,
        'name', p.policyname,
        'permissive', p.permissive,
        'roles', p.roles,
        'command', p.cmd,
        'using', p.qual,
        'with_check', p.with_check
      )
      ORDER BY p.tablename, p.policyname
    )
    FROM pg_catalog.pg_policies AS p
    WHERE p.schemaname = 'public'
  ), '[]'::jsonb)
)::text AS s3_schema_preflight;

-- Query 3: discover shop-related tables, views, and sequences already present.
SELECT coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'object_name', c.relname,
      'object_type', CASE c.relkind
        WHEN 'S' THEN 'sequence'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized_view'
        ELSE 'table'
      END,
      'columns', coalesce((
        SELECT pg_catalog.jsonb_agg(a.attname ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = c.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
      ), '[]'::jsonb)
    )
    ORDER BY c.relname
  ),
  '[]'::jsonb
)::text AS existing_shop_objects
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  AND (
    c.relname ILIKE '%shop%'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = c.oid
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attname = 'shop_id'
    )
  );

-- Query 4: capture the live profile constraints and indexes that S3/S6 must preserve.
SELECT pg_catalog.jsonb_build_object(
  'constraints', coalesce((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', con.conname,
        'type', con.contype,
        'validated', con.convalidated,
        'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
      )
      ORDER BY con.conname
    )
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.profiles'::regclass
  ), '[]'::jsonb),
  'indexes', coalesce((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', i.relname,
        'definition', pg_catalog.pg_get_indexdef(i.oid)
      )
      ORDER BY i.relname
    )
    FROM pg_catalog.pg_index AS ix
    JOIN pg_catalog.pg_class AS i ON i.oid = ix.indexrelid
    WHERE ix.indrelid = 'public.profiles'::regclass
  ), '[]'::jsonb)
)::text AS profile_constraints_and_indexes;

-- Query 5: effective schema/table privileges and configured default ACLs.
-- Required before adding columns: table-wide SELECT grants also expose new columns.
SELECT pg_catalog.jsonb_build_object(
  'public_schema', (
    SELECT pg_catalog.jsonb_build_object(
      'acl', n.nspacl::text,
      'anon_usage', pg_catalog.has_schema_privilege('anon', n.oid, 'USAGE'),
      'authenticated_usage', pg_catalog.has_schema_privilege('authenticated', n.oid, 'USAGE'),
      'service_role_usage', pg_catalog.has_schema_privilege('service_role', n.oid, 'USAGE')
    )
    FROM pg_catalog.pg_namespace AS n
    WHERE n.nspname = 'public'
  ),
  'table_privileges', coalesce((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'table', c.relname,
        'object_type', c.relkind,
        'acl', c.relacl::text,
        'anon', pg_catalog.jsonb_build_object(
          'select', pg_catalog.has_table_privilege('anon', c.oid, 'SELECT'),
          'insert', pg_catalog.has_table_privilege('anon', c.oid, 'INSERT'),
          'update', pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE'),
          'delete', pg_catalog.has_table_privilege('anon', c.oid, 'DELETE')
        ),
        'authenticated', pg_catalog.jsonb_build_object(
          'select', pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT'),
          'insert', pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT'),
          'update', pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE'),
          'delete', pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE')
        ),
        'service_role', pg_catalog.jsonb_build_object(
          'select', pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT'),
          'insert', pg_catalog.has_table_privilege('service_role', c.oid, 'INSERT'),
          'update', pg_catalog.has_table_privilege('service_role', c.oid, 'UPDATE'),
          'delete', pg_catalog.has_table_privilege('service_role', c.oid, 'DELETE')
        )
      )
      ORDER BY c.relname
    )
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  ), '[]'::jsonb),
  'default_privileges', coalesce((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'creator', r.rolname,
        'schema', n.nspname,
        'object_type', d.defaclobjtype,
        'acl', d.defaclacl::text
      )
      ORDER BY r.rolname, n.nspname NULLS FIRST, d.defaclobjtype
    )
    FROM pg_catalog.pg_default_acl AS d
    JOIN pg_catalog.pg_roles AS r ON r.oid = d.defaclrole
    LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
    WHERE d.defaclnamespace IS NULL
       OR n.nspname = 'public'
  ), '[]'::jsonb)
)::text AS s3_privilege_preflight;

-- Query 6: inspect public views and routine outputs that could expose newly
-- added shop_id columns. Definitions are included only for routines with
-- composite/record returns or whole-row JSON / SELECT * patterns.
-- Review output locally and redact any accidental secret literal before sharing.
WITH routines AS (
  SELECT
    p.oid,
    p.oid::regprocedure::text AS signature,
    pg_catalog.pg_get_function_result(p.oid) AS result_type,
    p.prosecdef AS security_definer,
    pg_catalog.pg_get_functiondef(p.oid) AS definition,
    p.prorettype = 'record'::regtype
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type AS rt
        JOIN pg_catalog.pg_class AS rc ON rc.oid = rt.typrelid
        JOIN pg_catalog.pg_namespace AS rn ON rn.oid = rc.relnamespace
        WHERE rt.oid = p.prorettype
          AND rn.nspname = 'public'
          AND rc.relkind IN ('r', 'p', 'v', 'm')
      ) AS returns_composite,
    pg_catalog.pg_get_functiondef(p.oid) ~* 'to_jsonb[[:space:]]*\(|row_to_json[[:space:]]*\(|select[[:space:]]+\*' AS may_return_whole_row
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
)
SELECT pg_catalog.jsonb_build_object(
  'views', coalesce((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', schemaname || '.' || viewname,
        'definition', definition
      )
      ORDER BY viewname
    )
    FROM pg_catalog.pg_views
    WHERE schemaname = 'public'
  ), '[]'::jsonb),
  'potential_shop_id_routine_outputs', coalesce((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'signature', signature,
        'result_type', result_type,
        'security_definer', security_definer,
        'returns_composite', returns_composite,
        'may_return_whole_row', may_return_whole_row,
        'definition', definition
      )
      ORDER BY signature
    )
    FROM routines
    WHERE returns_composite OR may_return_whole_row
  ), '[]'::jsonb)
)::text AS s3_output_surface_preflight;
