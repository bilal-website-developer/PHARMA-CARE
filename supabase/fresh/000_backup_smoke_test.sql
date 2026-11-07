-- S1.3 — run only after 000_backup_to_schema.sql reports success.
-- One result cell contains per-table source/snapshot row counts.
-- Stop before S2 if this statement errors or returns complete=false.

SELECT backup_20261107.verify_snapshot()::text AS s1_smoke_test;
