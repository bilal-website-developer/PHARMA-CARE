-- Read-only diagnosis for the S2 snapshot verifier failure on audit_logs.
-- Returns counts only; it does not read or return audit-log contents.

SELECT jsonb_build_object(
  'backup_schema', 'backup_s2_20261111_2213',
  'table', counts.table_name,
  'rows_at_snapshot', counts.source_row_count,
  'rows_copied', counts.snapshot_row_count,
  'backup_rows_now', (SELECT count(*) FROM backup_s2_20261111_2213.audit_logs),
  'live_rows_now', (SELECT count(*) FROM public.audit_logs),
  'recorded_copy_matches',
    counts.source_row_count = counts.snapshot_row_count
      AND counts.snapshot_row_count = (
        SELECT count(*) FROM backup_s2_20261111_2213.audit_logs
      )
)::text AS s2_audit_log_snapshot_counts
FROM backup_s2_20261111_2213._snapshot_counts AS counts
WHERE counts.table_name = 'audit_logs';
