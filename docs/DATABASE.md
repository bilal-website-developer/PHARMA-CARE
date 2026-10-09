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
