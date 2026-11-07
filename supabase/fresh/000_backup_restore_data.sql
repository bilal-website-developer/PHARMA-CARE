-- S1.2 — restore public-table DATA only from backup_20261107.
-- This overwrites all current public-table rows with the S1 snapshot.
-- It does not restore Auth users, Storage objects, platform settings, or schema objects.
-- First review all preflight failures. Set restore_confirmed to true only when intentionally
-- discarding all public-table changes made after S1. Run as the database owner/superuser.

BEGIN;

DO $restore$
DECLARE
  backup_schema constant text := 'backup_20261107';
  restore_confirmed constant boolean := false;
  source_table record;
  source_columns text;
  snapshot_columns text;
  has_identity boolean;
  current_count bigint;
  copied_count bigint;
  expected_count bigint;
  table_list text;
  candidate record;
  sequence_row record;
  next_sequence_value numeric;
  current_sequence_count integer;
  snapshot_sequence_count integer;
  trigger_row record;
  is_superuser boolean;
BEGIN
  IF NOT restore_confirmed THEN
    RAISE EXCEPTION
      'Restore guard is closed. Review the impact, then manually set restore_confirmed to true in this file.';
  END IF;

  SELECT r.rolsuper INTO is_superuser
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = current_user;
  IF NOT coalesce(is_superuser, false) THEN
    RAISE EXCEPTION 'Data restore requires the database superuser so triggers and all rows can be restored.';
  END IF;

  IF pg_catalog.to_regnamespace(backup_schema) IS NULL THEN
    RAISE EXCEPTION 'Required S1 snapshot schema % does not exist.', backup_schema;
  END IF;

  CREATE TEMP TABLE s1_restore_counts (
    table_name text PRIMARY KEY,
    before_count bigint NOT NULL,
    expected_count bigint NOT NULL,
    after_count bigint
  ) ON COMMIT DROP;

  CREATE TEMP TABLE s1_restore_pending (
    table_oid oid PRIMARY KEY,
    schema_name name NOT NULL,
    table_name name NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE s1_restore_order (
    restore_order integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_oid oid NOT NULL,
    schema_name name NOT NULL,
    table_name name NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE s1_trigger_states (
    schema_name name NOT NULL,
    table_name name NOT NULL,
    trigger_name name NOT NULL,
    enabled_state "char" NOT NULL
  ) ON COMMIT DROP;

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
  ) OR EXISTS (
    SELECT 1
    FROM backup_20261107._snapshot_counts AS s
    WHERE pg_catalog.to_regclass(pg_catalog.format('public.%I', s.table_name)) IS NULL
  ) THEN
    RAISE EXCEPTION 'Public table inventory differs from S1. Restore is refused; reconcile schema changes first.';
  END IF;

  FOR source_table IN
    SELECT s.table_name, s.source_row_count, s.snapshot_row_count
    FROM backup_20261107._snapshot_counts AS s
    ORDER BY s.table_name
  LOOP
    IF source_table.source_row_count <> source_table.snapshot_row_count THEN
      RAISE EXCEPTION 'S1 snapshot was incomplete for table %.', source_table.table_name;
    END IF;

    SELECT pg_catalog.string_agg(
             pg_catalog.format('%I:%s',
               a.attname,
               pg_catalog.format_type(a.atttypid, a.atttypmod)),
             ',' ORDER BY a.attnum
           ),
           coalesce(bool_or(a.attidentity <> ''), false)
      INTO source_columns, has_identity
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = pg_catalog.format('public.%I', source_table.table_name)::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped;

    SELECT pg_catalog.string_agg(
             pg_catalog.format('%I:%s',
               a.attname,
               pg_catalog.format_type(a.atttypid, a.atttypmod)),
             ',' ORDER BY a.attnum
           )
      INTO snapshot_columns
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = pg_catalog.format('%I.%I', backup_schema, source_table.table_name)::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF source_columns IS DISTINCT FROM snapshot_columns THEN
      RAISE EXCEPTION 'Columns changed for public.%. Roll back later schema stages before restoring S1 data.',
        source_table.table_name;
    END IF;

    SELECT pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO source_columns
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = pg_catalog.format('public.%I', source_table.table_name)::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attgenerated = '';

    EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I', source_table.table_name)
      INTO current_count;
    EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I', backup_schema, source_table.table_name)
      INTO copied_count;

    IF copied_count <> source_table.snapshot_row_count THEN
      RAISE EXCEPTION 'Snapshot table % changed after S1; expected %, found %.',
        source_table.table_name, source_table.snapshot_row_count, copied_count;
    END IF;

    INSERT INTO s1_restore_counts (table_name, before_count, expected_count)
    VALUES (source_table.table_name, current_count, source_table.snapshot_row_count);

    INSERT INTO s1_restore_pending (table_oid, schema_name, table_name)
    SELECT c.oid, n.nspname, c.relname
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = source_table.table_name
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition;
  END LOOP;

  SELECT count(*) INTO current_sequence_count
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'S';
  SELECT count(*) INTO snapshot_sequence_count
  FROM backup_20261107._sequence_snapshots;
  IF current_sequence_count <> snapshot_sequence_count THEN
    RAISE EXCEPTION 'Public sequence inventory differs from S1; restore is refused.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM backup_20261107._sequence_snapshots AS s
    LEFT JOIN pg_catalog.pg_class AS c
      ON c.relname = s.sequence_name
     AND c.relnamespace = pg_catalog.to_regnamespace('public')
    LEFT JOIN pg_catalog.pg_namespace AS n
      ON n.oid = c.relnamespace AND n.nspname = 'public'
    LEFT JOIN pg_catalog.pg_sequence AS q ON q.seqrelid = c.oid
    WHERE n.oid IS NULL
       OR q.seqstart <> s.start_value
       OR q.seqmin <> s.min_value
       OR q.seqmax <> s.max_value
       OR q.seqincrement <> s.increment_by
       OR q.seqcache <> s.cache_size
       OR q.seqcycle <> s.cycles
  ) THEN
    RAISE EXCEPTION 'A public sequence definition changed after S1; restore is refused.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS fk
    JOIN s1_restore_pending AS child ON child.table_oid = fk.conrelid
    JOIN s1_restore_pending AS parent ON parent.table_oid = fk.confrelid
    WHERE fk.contype = 'f'
      AND fk.conrelid = fk.confrelid
      AND NOT fk.condeferrable
  ) THEN
    RAISE EXCEPTION 'A non-deferrable self-referencing foreign key exists; a safe SQL restore order cannot be guaranteed.';
  END IF;

  CREATE TEMP TABLE s1_public_triggers ON COMMIT DROP AS
  SELECT n.nspname AS schema_name, t.relname AS table_name, tr.tgname AS trigger_name, tr.tgenabled
  FROM pg_catalog.pg_trigger AS tr
  JOIN pg_catalog.pg_class AS t ON t.oid = tr.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND NOT tr.tgisinternal;

  INSERT INTO s1_trigger_states
  SELECT schema_name, table_name, trigger_name, tgenabled
  FROM s1_public_triggers;

  FOR trigger_row IN
    SELECT schema_name, table_name, trigger_name
    FROM s1_trigger_states
    WHERE enabled_state <> 'D'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE %I.%I DISABLE TRIGGER %I',
      trigger_row.schema_name, trigger_row.table_name, trigger_row.trigger_name
    );
  END LOOP;

  SET CONSTRAINTS ALL DEFERRED;

  WHILE EXISTS (SELECT 1 FROM s1_restore_pending) LOOP
    SELECT p.table_oid, p.schema_name, p.table_name
      INTO candidate
    FROM s1_restore_pending AS p
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS fk
      JOIN s1_restore_pending AS parent ON parent.table_oid = fk.confrelid
      WHERE fk.contype = 'f'
        AND fk.conrelid = p.table_oid
        AND fk.confrelid <> p.table_oid
    )
    ORDER BY p.table_name
    LIMIT 1;

    IF NOT FOUND THEN
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS fk
        JOIN s1_restore_pending AS child ON child.table_oid = fk.conrelid
        JOIN s1_restore_pending AS parent ON parent.table_oid = fk.confrelid
        WHERE fk.contype = 'f'
          AND fk.conrelid <> fk.confrelid
          AND NOT fk.condeferrable
      ) THEN
        RAISE EXCEPTION 'A non-deferrable foreign-key cycle exists; restore is refused.';
      END IF;

      SELECT p.table_oid, p.schema_name, p.table_name
        INTO candidate
      FROM s1_restore_pending AS p
      ORDER BY p.table_name
      LIMIT 1;
    END IF;

    INSERT INTO s1_restore_order (table_oid, schema_name, table_name)
    VALUES (candidate.table_oid, candidate.schema_name, candidate.table_name);
    DELETE FROM s1_restore_pending WHERE table_oid = candidate.table_oid;
  END LOOP;

  SELECT pg_catalog.string_agg(
           pg_catalog.format('%I.%I', schema_name, table_name),
           ', ' ORDER BY restore_order
         )
    INTO table_list
  FROM s1_restore_order;

  IF table_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || table_list || ' RESTART IDENTITY';
  END IF;

  FOR source_table IN
    SELECT table_name
    FROM s1_restore_order
    ORDER BY restore_order
  LOOP
    SELECT pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' ORDER BY a.attnum),
           coalesce(bool_or(a.attidentity <> ''), false)
      INTO source_columns, has_identity
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = pg_catalog.format('public.%I', source_table.table_name)::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attgenerated = '';

    IF has_identity THEN
      EXECUTE pg_catalog.format(
        'INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM %I.%I',
        source_table.table_name,
        source_columns,
        source_columns,
        backup_schema,
        source_table.table_name
      );
    ELSE
      EXECUTE pg_catalog.format(
        'INSERT INTO public.%I (%s) SELECT %s FROM %I.%I',
        source_table.table_name,
        source_columns,
        source_columns,
        backup_schema,
        source_table.table_name
      );
    END IF;
  END LOOP;

  FOR sequence_row IN
    SELECT s.sequence_name,
           s.last_value,
           s.is_called,
           s.min_value,
           s.max_value,
           s.increment_by,
           s.cycles
    FROM backup_20261107._sequence_snapshots AS s
    ORDER BY s.sequence_name
  LOOP
    next_sequence_value := sequence_row.last_value;
    IF sequence_row.is_called THEN
      next_sequence_value := sequence_row.last_value + sequence_row.increment_by;
      IF sequence_row.cycles AND sequence_row.increment_by > 0
         AND next_sequence_value > sequence_row.max_value THEN
        next_sequence_value := sequence_row.min_value;
      ELSIF sequence_row.cycles AND sequence_row.increment_by < 0
         AND next_sequence_value < sequence_row.min_value THEN
        next_sequence_value := sequence_row.max_value;
      ELSIF next_sequence_value < sequence_row.min_value
         OR next_sequence_value > sequence_row.max_value THEN
        RAISE EXCEPTION 'Sequence % is exhausted and cannot be restored by RESTART.',
          sequence_row.sequence_name;
      END IF;
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER SEQUENCE public.%I RESTART WITH %s',
      sequence_row.sequence_name,
      next_sequence_value
    );
  END LOOP;

  FOR trigger_row IN
    SELECT schema_name, table_name, trigger_name, enabled_state
    FROM s1_trigger_states
    WHERE enabled_state <> 'D'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE %I.%I %s TRIGGER %I',
      trigger_row.schema_name,
      trigger_row.table_name,
      CASE trigger_row.enabled_state
        WHEN 'A' THEN 'ENABLE ALWAYS'
        WHEN 'R' THEN 'ENABLE REPLICA'
        ELSE 'ENABLE'
      END,
      trigger_row.trigger_name
    );
  END LOOP;

  FOR source_table IN
    SELECT table_name, expected_count
    FROM s1_restore_counts
    ORDER BY table_name
  LOOP
    EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I', source_table.table_name)
      INTO current_count;

    IF current_count <> source_table.expected_count THEN
      RAISE EXCEPTION 'Restored row-count mismatch for public.%. Expected %, got %.',
        source_table.table_name, source_table.expected_count, current_count;
    END IF;

    UPDATE s1_restore_counts
    SET after_count = current_count
    WHERE table_name = source_table.table_name;
  END LOOP;
END
$restore$;

SELECT pg_catalog.jsonb_build_object(
  'restore_complete', true,
  'tables', coalesce(
    (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table', table_name,
          'before_restore', before_count,
          'restored_from_snapshot', expected_count,
          'after_restore', after_count,
          'match', after_count = expected_count
        )
        ORDER BY table_name
      )
      FROM s1_restore_counts
    ),
    '[]'::jsonb
  )
)::text AS s1_restore_report;

COMMIT;
