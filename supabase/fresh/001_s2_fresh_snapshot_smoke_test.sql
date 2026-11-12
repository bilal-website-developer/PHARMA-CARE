-- S2 fresh snapshot verification. Run only after 001_s2_fresh_snapshot.sql completes successfully.
-- Stop if complete is not true, any table count differs, or an error is returned.

SELECT backup_s2_20261111_2153.verify_snapshot()::text AS s2_fresh_snapshot_smoke_test;
