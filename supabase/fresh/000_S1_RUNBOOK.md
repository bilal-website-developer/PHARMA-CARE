# S1 — current-project snapshot and read-only inventory

This package is prepared for the owner to run in the current Supabase SQL Editor. The assistant has not connected to the database or executed SQL.

## Before starting

1. Confirm the Dashboard project selector is the intended current project.
2. Pause writes briefly (do not ring up sales or post purchases) so sequence values and table contents stay aligned during the snapshot.
3. Use the SQL Editor role shown in Q1 of `000_current_only_catalog_queries.sql`. `000_backup_to_schema.sql` requires a superuser or `BYPASSRLS` role with permission to create the schema/tables and read every public table/sequence; the script aborts if access is incomplete. Q1 showed `superuser=false` and `bypasses_rls=true`, which supports attempting the snapshot but does not establish restore privileges. The data restore file requires `rolsuper=true`; verify that separately before ever considering a restore.
4. Do not copy the backup schema contents or any credentials into chat. Only return the one-cell metadata results requested below.

## Run order

1. Run Q1-Q9 and Q11 in `000_current_only_catalog_queries.sql`, one query at a time. Every query returns one cell. If Q1 does not show a role that is both superuser or `BYPASSRLS`, stop.
2. Run Q10 for batch 001. Change `batch_number` to 2, 3, and so on, and rerun until the one-cell output says `NO DEFINITIONS IN THIS BATCH`. Keep the batch labels intact. Do not paste any accidental hard-coded secret or personal literal; report the routine and redact only that literal.
3. Run the current checked-in `000_backup_to_schema.sql` once. It creates `backup_20261107`, copies data from every top-level ordinary/partitioned `public` table (partition rows are selected through their parent), records selected catalog-definition/ACL text and sequence state, then locks the backup schema from API roles with forced RLS and no policies. The transaction aborts on an incomplete copy, a foreign table, or unsupported inheritance. The script received a local static syntax correction after Q10 review; do not run an older copied version.
4. Run `000_backup_smoke_test.sql`. S1 passes only if it returns `complete: true`, every table has matching source/snapshot/current row counts, and it reports no error. Do not begin S2 until this passes.

## Restore and rollback

- `000_backup_restore_data.sql` restores **public-table data only**. It replaces all current public-table rows with the snapshot, in foreign-key-safe order, restores public sequence next-value behavior, suppresses user triggers during replay, and reports before/expected/after counts in one cell. The catalog text is an inspection archive, not a complete or directly executable schema restore. This package does not restore Auth users, Storage objects, platform settings, or schema changes.
- The catalog archive captures selected table, constraint, index, policy, trigger, function/procedure, view, ACL, extension, sequence, type, and aggregate metadata. Type/aggregate entries are inspection records, not executable DDL; role creation and other platform-level objects are not reconstructed. Do not treat this as a complete catalog backup or schema restore.
- The restore file is deliberately disabled by default. Never infer superuser privilege from the role name `postgres`: Q1 reported `rolsuper=false`. Only after separately verifying `rolsuper=true`, rolling back later schema changes, and deciding to discard all public-table changes since S1 should you consider changing `restore_confirmed` from `false` to `true`. If its preflight or row-count check fails, the transaction aborts; stop and do not continue.
- `000_backup_rollback.sql` drops only `backup_20261107`. It is cleanup for the snapshot itself, not a data restore. Do not run it before deciding the snapshot is no longer needed.

## S1 stop point

If snapshot SQL fails, the transaction rolls back; do not run S2. If the smoke test fails after snapshot commit, retain the schema and stop for review. Return Q1-Q9, each Q10 batch, Q11 type/aggregate metadata, the exact S1 result/error, and the barcode-status result. Do not include backup table contents or credentials.
