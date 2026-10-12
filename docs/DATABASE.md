# Database reference

This document is based on the schema export supplied in `supabase/schema_export` and the checked-in purchase migration. No database connection or query was used to prepare it.

> The baseline SQL is a reference snapshot of the supplied export, not an instruction to apply it to the live project. The export folder currently contains one extensionless combined file, rather than the six separately named CSV files described with the handoff. It summarizes table columns, constraints, indexes, RLS policies, RLS-enabled tables, and four function definitions. It does not provide triggers, views, grants, extension setup, or every database property, so the baseline cannot be treated as a verified full-project dump.

## Tables in the supplied schema export

| Table | Purpose and key relationships |
| --- | --- |
| `profiles` | Application staff profile keyed to `auth.users`; stores role, active/deleted state, and module permissions. |
| `customers` | Customer contact and credit balances. |
| `khata_entries` | Customer ledger entries; references customers, optional sales, and creating profiles. |
| `suppliers` | Supplier details and active state. The purchase migration adds `payable_balance_paisa`. |
| `medicines` | Product master: code, barcode, brand/generic names, category and manufacturer text, drug/storage class, rack, reorder threshold, prescription flag, and active state. |
| `medicine_units` | Per-medicine sale/purchase unit, conversion factor, paisa price, default-sale-unit flag, and optional barcode. |
| `stock_batches` | Batch-level received and remaining base-unit quantities, expiry, cost/MRP per base unit, supplier, and status. |
| `stock_movements` | Stock event ledger associated with a batch, signed quantity delta, optional reference ID, reason, and actor. |
| `purchases` | Supplier purchase header, invoice/date, total/paid amounts, payment/status, notes, and creator. The purchase migration adds purchase number, subtotal, discount, payment type, and void reason. |
| `purchase_items` | Purchase lines with medicine, unit, batch/expiry, quantity, conversion factor, unit cost/MRP, line total, and linked stock batch. The purchase migration adds bonus quantity. |
| `sales` | Sale header and invoice, cashier/customer, timestamp, monetary totals, and status. |
| `sale_items` | Sale lines with medicine, chosen unit, quantities, paisa prices/costs, discount percent, and line total. |
| `sale_item_batch_allocations` | Associates a sale line with one or more stock batches and their allocated quantities/cost/expiry. |
| `sale_payments` | Sale payment method and amount. |

All money columns use integer paisa in the exported schema, except `sale_items.discount_percent`, which is numeric.

## Tables introduced by the purchase migration

The export does not list `purchase_number_state` or `supplier_ledger`; the local purchase migration creates them. `purchase_number_state` stores the serialized purchase number counter and has RLS enabled with direct access revoked. `supplier_ledger` stores credit-purchase/void ledger entries, has RLS enabled, and the migration adds a read policy requiring `purchase_history`.

The reviewed categories/brands migration adds `categories` and `brands`; both are backfilled from `medicines.category` and `medicines.company`. Staff read them under RLS, while category-permission writes are exposed through checked RPCs so renames can update the medicine text column atomically. The stock-adjustment migration adds `adjust_stock(...)`, which changes one locked batch and records its movement in one transaction. It removes the exported `quantity_remaining <= quantity_received` constraint so an upward physical-count correction can exceed the original receipt; the separate nonnegative quantity constraint remains. The later `save_medicine(...)` migration is used by the Products form to create/update a medicine and its units transactionally.

The frontend inventory redesign's Phase 1 adds shared display components and pure stock/expiry presentation helpers under `src/components/inventory/`. These are UI-only primitives; Phase 1 does not create or alter database tables, functions, policies, or stored data.

The proposed Products redesign migration `20261010040000_products_redesign_rpc.sql` adds `can_view_cost()`, `products_overview_stats()`, `products_list(...)`, `products_import_preview(...)`, `products_bulk_update(...)`, and `products_bulk_import(...)`. These are `SECURITY DEFINER` RPCs with a fixed `public` search path; product operations require an active, non-deleted profile with Products permission. Product filters, counts, expiry and stock values, ordering, and paging are computed in Postgres. Cost, stock value, and margin are redacted there unless the caller is an active admin, super-admin, or accountant. CSV writes use the existing `save_medicine`, `save_category`, and `save_brand` functions in the same transaction; creating missing categories/manufacturers requires Categories permission. The migration does not change RLS policies or shared permission helpers and is pending manual application. The schema has no medicine-strength field, so strength is neither displayed nor used to infer duplicate imports.

## ACL lockdown proposal (files only; not applied)

The owner reports that a live ACL audit found broad default privileges for `anon`, `authenticated`, and `service_role`. The proposed migration set revokes `anon` privileges on current public tables, views, and sequences; revokes `anon`/`authenticated` table defaults for objects created by `postgres`; revokes authenticated DML on tables whose frontend writes use RPCs; replaces direct supplier writes with permission-checked RPCs; and reasserts profile DML revokes. No RLS policy, `service_role`, `postgres`, or function EXECUTE ACL is changed.

The owner reports the five cost-bearing tables (`stock_batches`, `purchases`, `purchase_items`, `sale_items`, `sale_item_batch_allocations`) are revoked from both `anon` and `authenticated`. This grant state must be preserved and reasserted: a later grant on `stock_batches` previously undid its revoke. Do not directly grant table SELECT on these relations; use permission-checked RPCs.

Because future tables created by `postgres` will no longer inherit grants to `authenticated`, every new table migration must explicitly grant only the required privileges to `authenticated` and define its RLS policy. The existing migrations for `audit_logs`, `print_requests`, `categories`, and `brands` explicitly revoke broad access, grant authenticated SELECT where required, and define RLS policies. Review those grants/policies whenever their schemas change.

The owner reports that `postgres` owns all 20 public relations. The `supabase_admin` default-privilege statements are kept in a separate optional file: running `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` as `postgres` may fail with a membership/permission error (`must be member of role "supabase_admin"`); do not run that optional file unless the SQL Editor role can execute it successfully.

The owner reports that profile INSERT/UPDATE/DELETE for `authenticated` are already revoked and that no non-internal triggers were returned for `auth.users` or `public.profiles`. Reassert profile DML/TRUNCATE revocation while preserving authenticated SELECT. `manage-users` is the only checked-in client-server profile writer and uses its service-role client; password change uses Supabase Auth. The checked-in profile RLS policies still allow an active admin to write through the API if table privileges are granted, which is why DML privileges remain revoked.

Default function EXECUTE grants are not changed in this round. The owner reports default execute grants to `anon` and `authenticated`; reviewing and narrowing those grants is optional future hardening after checking every RPC’s caller and authorization guard.

## Stock flow

1. A posted purchase is submitted through `post_purchase(...)` as a Postgres RPC. The current checked-in migration validates the purchase and each item, locks/advances the purchase-number counter, verifies that each unit belongs to its medicine, and performs all related writes transactionally.
2. For every item, the RPC converts purchased plus bonus units to base units using `medicine_units.conversion_factor`.
3. It inserts a `stock_batches` row with received and remaining quantities, expiry date, and per-base-unit cost/MRP.
4. It inserts a `stock_movements` receipt row linked to that batch and purchase, then a `purchase_items` row linked to both the purchase and batch.
5. Stock inventory should derive current balance from batch quantities and show batch-level movement history from `stock_movements`; a new purchase is visible after the next successful query/refresh.

The exported legacy `post_purchase` function does not match the checked-in purchase migration: the export shows a six-argument function inserting movement type `PURCHASE`, while the exported movement-type constraint does not allow `PURCHASE`. The purchase migration replaces it with the current eight-argument RPC and uses `RECEIPT`. It also preserves legacy `cancelled` purchase rows while adding `void` as the status written by `void_purchase`.

## Live backend verification (2026-10-09)

Read-only checks against the project configured by the app found that its deployed API does not currently match all checked-in migrations:

- `categories` and `brands` are present in the API schema.
- The purchase migration's `purchases.pr_no`, `purchase_items.bonus_qty`, and `suppliers.payable_balance_paisa` columns are absent (`42703`).
- The `purchase_catalog()` and `purchase_history(...)` RPCs are unavailable (`PGRST202`).
- The live `medicines`, `suppliers`, and `stock_batches` tables each currently contain zero rows.
- A later SQL Editor screenshot confirms `adjust_stock(...)` and `save_medicine(...)` are present. The purchase migration failed before its `COMMIT`: the live `purchase_items.line_total_paisa` is generated, but the original migration tried to update it and explicitly insert into it. The migration now checks `pg_attribute.attgenerated`, skipping the backfill for generated columns and omitting that column from inserts when PostgreSQL computes it.

This explains the purchase and purchase-history errors. Products and Categories schema endpoints are present now; empty product data is consistent with the live medicines table containing zero rows. The app's online indicator checks Supabase Auth reachability, not whether page-specific database tables and RPCs exist. Check the migration CLI's linked history (the SQL Editor does not necessarily expose `supabase_migrations.schema_migrations`) and reconcile/apply only pending migrations before expecting those pages to load. Afterward, the catalog will still be empty until medicines and suppliers are added or imported.

The read-only checks did not execute SQL or change remote data. The earlier read-only `to_regclass` check predates the latest screenshot, which shows both `public.categories` and `public.brands` are now present.

## RLS and permissions snapshot

The export reports RLS enabled on all 14 exported tables. The policies shown are permission-gated for authenticated users, with administrative delete/write policies where exported. The export's `is_admin()` recognizes role `admin` only (not `super_admin`); `has_any_permission()` also special-cases `admin`, not `super_admin`. The first migration in the reviewed run order replaces only these two helpers so active `super_admin` accounts receive the same override as `admin`; no existing policy definition is changed by that migration.

The purchase migration enables RLS on its two added tables. Its `purchase_number_state` is intended for RPC-only access; the supplier ledger policy allows reads when `purchase_history` is granted.

See [DATABASE_SCHEMA_COMPARISON.md](./DATABASE_SCHEMA_COMPARISON.md) for schema-vs-app gaps, index/FK findings, and migration deltas.
