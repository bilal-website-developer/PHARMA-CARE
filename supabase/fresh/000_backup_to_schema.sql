-- S1.1 — snapshot public-table data and selected catalog definitions inside the database.
-- Run only in the current Supabase SQL Editor as a role with BYPASSRLS.
-- This is not a full database backup and does not include Auth users, Storage objects,
-- platform configuration, or data outside public.

BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

DO $snapshot$
DECLARE
  backup_schema constant text := 'backup_20261107';
  source_table record;
  source_count bigint;
  backup_count bigint;
  is_superuser boolean;
  bypasses_rls boolean;
  sequence_row record;
  sequence_last_value bigint;
  sequence_is_called boolean;
  role_acl text;
BEGIN
  SELECT r.rolsuper, r.rolbypassrls
    INTO is_superuser, bypasses_rls
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = current_user;

  IF NOT coalesce(is_superuser OR bypasses_rls, false) THEN
    RAISE EXCEPTION 'S1 must run as a database role that bypasses RLS; no snapshot was created.';
  END IF;

  IF pg_catalog.to_regnamespace(backup_schema) IS NOT NULL THEN
    RAISE EXCEPTION 'Schema % already exists. Stop; do not overwrite or drop an existing snapshot.', backup_schema;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'f'
  ) THEN
    RAISE EXCEPTION 'Foreign tables exist in public. Review them before S1; this script does not copy foreign-table data.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_inherits AS i
    JOIN pg_catalog.pg_class AS child ON child.oid = i.inhrelid
    JOIN pg_catalog.pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_catalog.pg_class AS parent ON parent.oid = i.inhparent
    JOIN pg_catalog.pg_namespace AS parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE child_ns.nspname = 'public'
      AND parent_ns.nspname <> 'public'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_inherits AS i
    JOIN pg_catalog.pg_class AS parent ON parent.oid = i.inhparent
    JOIN pg_catalog.pg_namespace AS parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE parent_ns.nspname = 'public'
      AND parent.relkind <> 'p'
  ) THEN
    RAISE EXCEPTION 'Unsupported cross-schema or non-partition table inheritance exists in public. Review it before S1.';
  END IF;

  EXECUTE pg_catalog.format('CREATE SCHEMA %I', backup_schema);
  EXECUTE pg_catalog.format(
    'CREATE TABLE %I._snapshot_counts (
       table_name text PRIMARY KEY,
       source_row_count bigint NOT NULL,
       snapshot_row_count bigint NOT NULL
     )',
    backup_schema
  );
  EXECUTE pg_catalog.format(
    'CREATE TABLE %I._object_definitions (
       object_type text NOT NULL,
       object_name text NOT NULL,
       definition text NOT NULL
     )',
    backup_schema
  );
  EXECUTE pg_catalog.format(
    'CREATE TABLE %I._sequence_snapshots (
       sequence_name text PRIMARY KEY,
       last_value bigint NOT NULL,
       is_called boolean NOT NULL,
       data_type text NOT NULL,
       start_value bigint NOT NULL,
       min_value bigint NOT NULL,
       max_value bigint NOT NULL,
       increment_by bigint NOT NULL,
       cache_size bigint NOT NULL,
       cycles boolean NOT NULL
     )',
    backup_schema
  );

  FOR source_table IN
    SELECT c.relname, c.relkind
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
    ORDER BY c.relname
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT count(*) FROM public.%I',
      source_table.relname
    ) INTO source_count;

    EXECUTE pg_catalog.format(
      'CREATE TABLE %I.%I AS SELECT * FROM public.%I',
      backup_schema,
      source_table.relname,
      source_table.relname
    );

    EXECUTE pg_catalog.format(
      'SELECT count(*) FROM %I.%I',
      backup_schema,
      source_table.relname
    ) INTO backup_count;

    IF source_count <> backup_count THEN
      RAISE EXCEPTION 'Snapshot row-count mismatch for public.%: source %, snapshot %.',
        source_table.relname, source_count, backup_count;
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      backup_schema,
      source_table.relname
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
      backup_schema,
      source_table.relname
    );

    EXECUTE pg_catalog.format(
      'INSERT INTO %I._snapshot_counts VALUES ($1, $2, $3)',
      backup_schema
    ) USING source_table.relname, source_count, backup_count;

    INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
    SELECT 'table_columns',
           pg_catalog.format('%I.%I', 'public', source_table.relname),
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'column', a.attname,
                 'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
                 'not_null', a.attnotnull,
                 'identity', a.attidentity,
                 'generated', a.attgenerated,
                 'default_or_expression', pg_catalog.pg_get_expr(d.adbin, d.adrelid),
                 'collation', CASE
                   WHEN a.attcollation = t.typcollation THEN NULL
                   ELSE pg_catalog.format('%I.%I', cn.nspname, coll.collname)
                 END
               )
               ORDER BY a.attnum
             )::text,
             '[]'
           )
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid
    LEFT JOIN pg_catalog.pg_attrdef AS d
      ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_collation AS coll ON coll.oid = a.attcollation
    LEFT JOIN pg_catalog.pg_namespace AS cn ON cn.oid = coll.collnamespace
    WHERE a.attrelid = pg_catalog.format('public.%I', source_table.relname)::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped;
  END LOOP;

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'constraint',
         pg_catalog.format('%I.%I.%I', n.nspname, t.relname, c.conname),
         pg_catalog.format(
           'ALTER TABLE %I.%I ADD CONSTRAINT %I %s;',
           n.nspname, t.relname, c.conname, pg_catalog.pg_get_constraintdef(c.oid, true)
         )
  FROM pg_catalog.pg_constraint AS c
  JOIN pg_catalog.pg_class AS t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public';

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'index',
         pg_catalog.format('%I.%I', n.nspname, i.relname),
         pg_catalog.pg_get_indexdef(i.oid)
  FROM pg_catalog.pg_index AS x
  JOIN pg_catalog.pg_class AS i ON i.oid = x.indexrelid
  JOIN pg_catalog.pg_class AS t ON t.oid = x.indrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public';

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'policy',
         pg_catalog.format('%I.%I.%I', p.schemaname, p.tablename, p.policyname),
         pg_catalog.format(
           'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
           p.policyname,
           p.schemaname,
           p.tablename,
           CASE p.permissive WHEN 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
           p.cmd,
           coalesce((
             SELECT pg_catalog.string_agg(
               CASE WHEN role_name = 'public' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(role_name) END,
               ', ' ORDER BY role_name
             )
             FROM pg_catalog.unnest(p.roles) AS roles(role_name)
           ), 'PUBLIC'),
           CASE WHEN p.qual IS NULL THEN '' ELSE pg_catalog.format(' USING (%s)', p.qual) END,
           CASE WHEN p.with_check IS NULL THEN '' ELSE pg_catalog.format(' WITH CHECK (%s)', p.with_check) END
         )
  FROM pg_catalog.pg_policies AS p
  WHERE p.schemaname = 'public';

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'trigger',
         pg_catalog.format('%I.%I.%I', n.nspname, t.relname, tr.tgname),
         pg_catalog.pg_get_triggerdef(tr.oid, true)
           || pg_catalog.format(E'\n-- Original trigger enable state: %s', tr.tgenabled)
  FROM pg_catalog.pg_trigger AS tr
  JOIN pg_catalog.pg_class AS t ON t.oid = tr.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND NOT tr.tgisinternal;

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END,
         p.oid::regprocedure::text,
         pg_catalog.pg_get_functiondef(p.oid)
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p', 'w');

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT CASE c.relkind WHEN 'm' THEN 'materialized_view' ELSE 'view' END,
         pg_catalog.format('%I.%I', n.nspname, c.relname),
         pg_catalog.format(
           'CREATE %s %I.%I AS %s;',
           CASE WHEN c.relkind = 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,
           n.nspname,
           c.relname,
           pg_catalog.pg_get_viewdef(c.oid, true)
         )
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('v', 'm');

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'table_rls',
         pg_catalog.format('%I.%I', n.nspname, c.relname),
         pg_catalog.format(
           'relrowsecurity=%s; relforcerowsecurity=%s',
           c.relrowsecurity,
           c.relforcerowsecurity
         )
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p');

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'acl_schema',
         n.nspname,
         coalesce(n.nspacl::text, '(NULL ACL; PostgreSQL defaults apply)')
  FROM pg_catalog.pg_namespace AS n
  WHERE n.nspname = 'public';

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'acl_relation',
         pg_catalog.format('%I.%I', n.nspname, c.relname),
         coalesce(c.relacl::text, '(NULL ACL; PostgreSQL defaults apply)')
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S');

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'acl_routine',
         p.oid::regprocedure::text,
         coalesce(p.proacl::text, '(NULL ACL; PostgreSQL defaults apply)')
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public';

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'acl_type',
         pg_catalog.format('%I.%I', n.nspname, t.typname),
         coalesce(t.typacl::text, '(NULL ACL; PostgreSQL defaults apply)')
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public';

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'type_metadata',
         pg_catalog.format('%I.%I', n.nspname, t.typname),
         pg_catalog.jsonb_build_object(
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
         )::text
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typtype <> 'p';

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'acl_default',
         pg_catalog.format('%I.%I.%s', n.nspname, r.rolname, d.defaclobjtype),
         d.defaclacl::text
  FROM pg_catalog.pg_default_acl AS d
  JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
  JOIN pg_catalog.pg_roles AS r ON r.oid = d.defaclrole
  WHERE n.nspname = 'public';

  FOR sequence_row IN
    SELECT c.relname,
           s.seqtypid,
           s.seqstart,
           s.seqmin,
           s.seqmax,
           s.seqincrement,
           s.seqcache,
           s.seqcycle
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_sequence AS s ON s.seqrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
    ORDER BY c.relname
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT last_value, is_called FROM public.%I',
      sequence_row.relname
    ) INTO sequence_last_value, sequence_is_called;

    INSERT INTO backup_20261107._sequence_snapshots
    VALUES (
      sequence_row.relname,
      sequence_last_value,
      sequence_is_called,
      pg_catalog.format_type(sequence_row.seqtypid, NULL),
      sequence_row.seqstart,
      sequence_row.seqmin,
      sequence_row.seqmax,
      sequence_row.seqincrement,
      sequence_row.seqcache,
      sequence_row.seqcycle
    );

    INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
    VALUES (
      'sequence',
      pg_catalog.format('%I.%I', 'public', sequence_row.relname),
      pg_catalog.format(
        'CREATE SEQUENCE %I.%I AS %s INCREMENT BY %s MINVALUE %s MAXVALUE %s START WITH %s CACHE %s %s; -- snapshot last_value=%s, is_called=%s',
        'public',
        sequence_row.relname,
        pg_catalog.format_type(sequence_row.seqtypid, NULL),
        sequence_row.seqincrement,
        sequence_row.seqmin,
        sequence_row.seqmax,
        sequence_row.seqstart,
        sequence_row.seqcache,
        CASE WHEN sequence_row.seqcycle THEN 'CYCLE' ELSE 'NO CYCLE' END,
        sequence_last_value,
        sequence_is_called
      )
    );
  END LOOP;

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'extension',
         e.extname,
         pg_catalog.format(
           'extension=%I; version=%s; schema=%I; owner=%I',
           e.extname, e.extversion, n.nspname, r.rolname
         )
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
  JOIN pg_catalog.pg_roles AS r ON r.oid = e.extowner;

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'aggregate_metadata',
         p.oid::regprocedure::text,
         pg_catalog.jsonb_build_object(
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
         )::text
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_aggregate AS a ON a.aggfnoid = p.oid
  WHERE n.nspname = 'public';

  INSERT INTO backup_20261107._object_definitions (object_type, object_name, definition)
  SELECT 'table_definition_summary',
         'public',
         pg_catalog.jsonb_build_object(
          'top_level_tables', (
            SELECT count(*)
            FROM pg_catalog.pg_class AS c
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p')
              AND NOT c.relispartition
          ),
          'functions_and_procedures', (
            SELECT count(*)
            FROM pg_catalog.pg_proc AS p
            JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.prokind IN ('f', 'p', 'w')
          ),
          'aggregates', (
            SELECT count(*)
            FROM pg_catalog.pg_proc AS p
            JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
            JOIN pg_catalog.pg_aggregate AS a ON a.aggfnoid = p.oid
            WHERE n.nspname = 'public'
          ),
          'policies', (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public'),
          'triggers', (
            SELECT count(*)
            FROM pg_catalog.pg_trigger AS tr
            JOIN pg_catalog.pg_class AS t ON t.oid = tr.tgrelid
            JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND NOT tr.tgisinternal
          ),
          'sequences', (SELECT count(*) FROM backup_20261107._sequence_snapshots)
         )::text;

  FOR role_acl IN
    SELECT 'PUBLIC' UNION ALL SELECT 'anon' UNION ALL SELECT 'authenticated' UNION ALL SELECT 'service_role'
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %s',
      backup_schema,
      CASE WHEN role_acl = 'PUBLIC' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(role_acl) END
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM %s',
      backup_schema,
      CASE WHEN role_acl = 'PUBLIC' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(role_acl) END
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM %s',
      backup_schema,
      CASE WHEN role_acl = 'PUBLIC' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(role_acl) END
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM %s',
      backup_schema,
      CASE WHEN role_acl = 'PUBLIC' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(role_acl) END
    );
  END LOOP;

  FOR source_table IN
    SELECT c.relname
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = backup_schema
      AND c.relkind = 'r'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', backup_schema, source_table.relname);
    EXECUTE pg_catalog.format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', backup_schema, source_table.relname);
  END LOOP;

END
$snapshot$;

CREATE FUNCTION backup_20261107.verify_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, backup_20261107
AS $verify$
DECLARE
  r record;
  current_count bigint;
  copied_count bigint;
  results jsonb := '[]'::jsonb;
  api_role text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'backup_20261107'
  ) THEN
    RAISE EXCEPTION 'Backup schema has an RLS policy; API isolation check failed.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'backup_20261107'
      AND c.relkind = 'r'
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'A backup table does not have forced RLS enabled.';
  END IF;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_schema_privilege(api_role, 'backup_20261107', 'USAGE') THEN
      RAISE EXCEPTION 'API role % can use the backup schema.', api_role;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM backup_20261107._snapshot_counts AS s
      WHERE pg_catalog.has_table_privilege(
        api_role,
        pg_catalog.to_regclass(pg_catalog.format('backup_20261107.%I', s.table_name)),
        'SELECT'
      )
    ) OR pg_catalog.has_table_privilege(
      api_role, 'backup_20261107._snapshot_counts'::regclass, 'SELECT'
    ) OR pg_catalog.has_table_privilege(
      api_role, 'backup_20261107._object_definitions'::regclass, 'SELECT'
    ) OR pg_catalog.has_table_privilege(
      api_role, 'backup_20261107._sequence_snapshots'::regclass, 'SELECT'
    ) THEN
      RAISE EXCEPTION 'API role % can read a backup table.', api_role;
    END IF;
  END LOOP;

  FOR r IN
    SELECT table_name, source_row_count, snapshot_row_count
    FROM backup_20261107._snapshot_counts
    ORDER BY table_name
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', r.table_name)) IS NULL
       OR pg_catalog.to_regclass(pg_catalog.format('backup_20261107.%I', r.table_name)) IS NULL THEN
      RAISE EXCEPTION 'A source or snapshot table is missing: %.', r.table_name;
    END IF;

    EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I', r.table_name)
      INTO current_count;
    EXECUTE pg_catalog.format('SELECT count(*) FROM backup_20261107.%I', r.table_name)
      INTO copied_count;

    IF r.source_row_count <> r.snapshot_row_count
       OR current_count <> r.source_row_count
       OR copied_count <> r.snapshot_row_count THEN
      RAISE EXCEPTION 'S1 row-count check failed for %.', r.table_name;
    END IF;

    results := results || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'table', r.table_name,
        'source_at_snapshot', r.source_row_count,
        'snapshot', r.snapshot_row_count,
        'current_source', current_count,
        'match', true
      )
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND NOT EXISTS (
        SELECT 1
        FROM backup_20261107._snapshot_counts AS s
        WHERE s.table_name = c.relname
      )
  ) THEN
    RAISE EXCEPTION 'A public table is missing from the S1 snapshot.';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'complete', true,
    'backup_schema', 'backup_20261107',
    'tables', results
  );
END
$verify$;

REVOKE ALL PRIVILEGES ON FUNCTION backup_20261107.verify_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
