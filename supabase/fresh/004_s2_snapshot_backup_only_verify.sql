-- Read-only verification for the already-created S2 snapshot.
-- Unlike verify_snapshot(), this does not require live public row counts to remain
-- unchanged after capture. It checks recorded-vs-copied counts and backup isolation.
-- Run in the Supabase SQL Editor as a role with BYPASSRLS.

CREATE TEMP TABLE IF NOT EXISTS s2_snapshot_verification_result (
  report jsonb
);
TRUNCATE TABLE pg_temp.s2_snapshot_verification_result;

DO $verify$
DECLARE
  backup_schema constant text := 'backup_s2_20261111_2213';
  r record;
  api_role text;
  copied_count bigint;
  bypasses_rls boolean;
  issues jsonb := '[]'::jsonb;
  table_count integer := 0;
  snapshot_oid oid;
BEGIN
  SELECT coalesce(rolsuper OR rolbypassrls, false)
    INTO bypasses_rls
  FROM pg_catalog.pg_roles
  WHERE rolname = current_user;

  IF NOT coalesce(bypasses_rls, false) THEN
    RAISE EXCEPTION 'Run this verification as a database role that bypasses RLS.';
  END IF;

  IF pg_catalog.to_regnamespace(backup_schema) IS NULL THEN
    RAISE EXCEPTION 'Snapshot schema % does not exist.', backup_schema;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = backup_schema
  ) THEN
    issues := issues || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('check', 'backup_schema_has_no_policies', 'passed', false)
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = backup_schema
      AND c.relkind = 'r'
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    issues := issues || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('check', 'all_backup_tables_force_rls', 'passed', false)
    );
  END IF;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_schema_privilege(api_role, backup_schema, 'USAGE') THEN
      issues := issues || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'check', 'api_role_has_no_backup_schema_usage',
          'role', api_role,
          'passed', false
        )
      );
    END IF;

    FOR r IN
      SELECT table_name
      FROM backup_s2_20261111_2213._snapshot_counts
      UNION ALL
      SELECT unnest(ARRAY['_snapshot_counts', '_object_definitions', '_sequence_snapshots'])
    LOOP
      snapshot_oid := pg_catalog.to_regclass(
        pg_catalog.format('%I.%I', backup_schema, r.table_name)
      );

      IF snapshot_oid IS NOT NULL
         AND pg_catalog.has_table_privilege(api_role, snapshot_oid, 'SELECT') THEN
        issues := issues || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'check', 'api_role_cannot_select_backup_tables',
            'role', api_role,
            'table', r.table_name,
            'passed', false
          )
        );
      END IF;
    END LOOP;
  END LOOP;

  FOR r IN
    SELECT table_name, source_row_count, snapshot_row_count
    FROM backup_s2_20261111_2213._snapshot_counts
    ORDER BY table_name
  LOOP
    table_count := table_count + 1;
    snapshot_oid := pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', backup_schema, r.table_name)
    );

    IF snapshot_oid IS NULL THEN
      issues := issues || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'check', 'snapshot_table_exists',
          'table', r.table_name,
          'passed', false
        )
      );
      CONTINUE;
    END IF;

    EXECUTE pg_catalog.format(
      'SELECT count(*) FROM %I.%I',
      backup_schema,
      r.table_name
    ) INTO copied_count;

    IF r.source_row_count <> r.snapshot_row_count
       OR copied_count <> r.snapshot_row_count THEN
      issues := issues || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'check', 'recorded_count_matches_backup',
          'table', r.table_name,
          'source_at_snapshot', r.source_row_count,
          'recorded_copy', r.snapshot_row_count,
          'backup_now', copied_count,
          'passed', false
        )
      );
    END IF;

    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', r.table_name)) IS NULL THEN
      issues := issues || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'check', 'source_table_exists',
          'table', r.table_name,
          'passed', false
        )
      );
    END IF;
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
        FROM backup_s2_20261111_2213._snapshot_counts AS s
        WHERE s.table_name = c.relname
      )
  ) THEN
    issues := issues || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('check', 'all_public_tables_are_listed', 'passed', false)
    );
  END IF;

  INSERT INTO pg_temp.s2_snapshot_verification_result (report)
  VALUES (
    pg_catalog.jsonb_build_object(
      'complete', pg_catalog.jsonb_array_length(issues) = 0,
      'backup_schema', backup_schema,
      'tables_checked', table_count,
      'checks', CASE
        WHEN pg_catalog.jsonb_array_length(issues) = 0 THEN '[]'::jsonb
        ELSE issues
      END,
      'live_row_counts_compared', false
    )
  );
END
$verify$;

SELECT report AS s2_backup_verification
FROM pg_temp.s2_snapshot_verification_result;
