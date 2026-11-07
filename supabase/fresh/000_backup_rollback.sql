-- S1 rollback: removes only the isolated S1 snapshot schema.
-- Do not run this to restore public data. Use 000_backup_restore_data.sql first
-- if restoring the point-in-time table data is intentional and its guard is approved.
-- This does not undo later tenant stages.

BEGIN;

DROP SCHEMA backup_20261107 CASCADE;

COMMIT;
