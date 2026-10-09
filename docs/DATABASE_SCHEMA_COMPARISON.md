# Database schema comparison

**Evidence reviewed:** the supplied combined export at `supabase/schema_export`, the checked-in `supabase/migrations/20261008230000_complete_purchase_workflow.sql`, and current frontend source. No database connection was made, and no SQL was executed. The export is a schema summary, not a complete `pg_dump`; triggers, views, grants, and some metadata were not supplied.

## Missing tables

| Table / data concept | Export status | App status |
| --- | --- | --- |
| `medicines` | Exists | Product master used by the purchase catalog and intended Products page. |
| `medicine_units` | Exists | Unit/packaging records used by purchase catalog and unit conversions. |
| `stock_batches` | Exists | Batch quantities, expiries, cost/MRP used by purchases and intended Stock Inventory. |
| `stock_movements` | Exists | Batch event ledger used by purchase posting and intended adjustments. |
| `categories`, `brands` | Absent from the export; created by `20261009190000_add_medicine_categories_and_brands.sql` | Seeded from the existing medicine category and company text. The migration retains the text columns and exposes category-permission RPC writes. |
| `expenses` | Absent | The Expense/Cash Book UI is currently in-memory/demo-backed; no current frontend Supabase table query targets it. |
| `purchase_number_state`, `supplier_ledger` | Absent from export; created by the purchase migration | Required by the migrated purchase workflow. They are created by the checked-in migration, not missing after it is applied. |

No table directly queried by the current frontend via `.from(...)` is missing from the export: those direct queries target `profiles` and `suppliers`. The purchase page uses the `purchase_catalog` RPC, whose function references the exported medicine/unit/batch tables.

## Columns used by the selected pages and migration

The exported product/inventory columns needed by the planned Products and Stock Inventory pages exist:

- `medicines`: `id`, `code`, `barcode`, `brand_name`, `generic_name`, `category`, `company`, `drug_class`, `storage_condition`, `rack_location`, `min_stock_alert`, `requires_prescription`, `is_active`, `created_at`.
- `medicine_units`: `id`, `medicine_id`, `name`, `conversion_factor`, `is_default_sale_unit`, `price_paisa`, `barcode`.
- `stock_batches`: `id`, `medicine_id`, `supplier_id`, `batch_number`, `expiry_date`, `received_date`, `cost_paisa_per_base_unit`, `mrp_paisa_per_base_unit`, `quantity_received`, `quantity_remaining`, `status`, `created_at`.
- `stock_movements`: `id`, `batch_id`, `movement_type`, `quantity_delta`, `reference_id`, `reason`, `created_by`, `created_at`.

These columns required by the current purchase UI/migration are **not in the supplied baseline export**; the checked-in migration adds them:

| Table | Missing from export | Added by purchase migration |
| --- | --- | --- |
| `purchases` | `pr_no`, `subtotal_paisa`, `discount_paisa`, `payment_type`, `void_reason` | Yes |
| `purchase_items` | `bonus_qty` | Yes |
| `suppliers` | `payable_balance_paisa` | Yes |

The export’s legacy `post_purchase` RPC takes six arguments and returns a UUID; current `StockPurchaseView` calls the eight-argument purchase RPC contract implemented in the migration. Its movement constraint also excludes `PURCHASE` even though the exported legacy function inserts that value. This is a material baseline/migration mismatch; confirm migration application before relying on Purchases.

## Index coverage

The export includes `medicines(code)` unique, `medicine_units(medicine_id, name)` unique, and `stock_batches(medicine_id, expiry_date)`. The latter two support medicine-to-unit and medicine-to-batch lookups; current purchase catalog also filters active medicines and sorts by brand.

No matching indexes are shown for:

- `medicines.is_active` and `medicines.brand_name` (catalog filtering and ordering).
- `medicines.barcode`, `brand_name`, `generic_name`, `category`, and `company` for search/category filters. A normal btree does not accelerate substring `ILIKE`; consider a suitable trigram/index strategy only after query design and extension availability are confirmed.
- `stock_batches.expiry_date` alone for global near-expiry filters, `status`, or `quantity_remaining` for stock filters. `(medicine_id, expiry_date)` does not efficiently cover expiry-only scans.
- `suppliers.is_active` and `suppliers.name` for the existing active-supplier filter/order.

The purchase migration adds `stock_movements(reference_id)` and `(purchase_date DESC, created_at DESC)` indexes. It also creates `purchase_items(purchase_id)`, although the export already has an equivalent `purchase_items_purchase_idx` on that column; check for/reconcile this redundant index before applying the migration. The current Products and Stock Inventory screens are demo-backed, so these are coverage gaps for the requested database-backed filters, not measured production slow queries. Avoid creating additional indexes until query plans/data volumes are known.

## Foreign-key coverage

All exported foreign keys and the absence of constraints are listed in the baseline reference. Notable relationship columns without exported foreign keys:

- `purchases.created_by` does not reference `profiles(id)`.
- `stock_movements.reference_id` has no FK; it appears polymorphic, referring to different business documents.

The export shows the primary medicine/unit/batch/purchase chain linked by FKs. It does not show indexes on every FK column; potential missing supporting indexes include `medicine_units(medicine_id)` (covered by its unique composite index), `purchase_items(unit_id, stock_batch_id)`, `stock_batches(supplier_id)`, `sale_payments(sale_id)`, `sale_item_batch_allocations(sale_item_id, batch_id)`, `sales(customer_id, cashier_id)`, and ledger creator/sale references. This is a performance observation, not a recommendation to add all indexes indiscriminately.

## RLS status

The export reports RLS enabled for all 14 exported tables: `customers`, `khata_entries`, `medicine_units`, `medicines`, `profiles`, `purchase_items`, `purchases`, `sale_item_batch_allocations`, `sale_items`, `sale_payments`, `sales`, `stock_batches`, `stock_movements`, and `suppliers`. No exported table is reported without RLS.

The purchase migration enables RLS for `purchase_number_state` and `supplier_ledger`; it revokes direct access to `purchase_number_state` and adds a `purchase_history`-gated supplier-ledger select policy. The schema export has no row for `expenses` because that relation does not exist in the captured public schema.

The categories/brands migration enables RLS on both new tables. Authenticated users receive read-only table grants; all writes go through SECURITY DEFINER RPCs that require the categories permission. The RPCs check products permission before renaming an item currently used by medicines, because existing medicine write policies require products. The stock-adjustment RPC checks the active profile and stock_inventory permission and does not alter existing RLS policies.

The stock-adjustment migration removes `stock_batches_check` (`quantity_remaining <= quantity_received`) so a physical count can increase remaining stock above the originally received amount. The separate `stock_batches_quantity_remaining_check` (`quantity_remaining >= 0`) remains; the RPC also rejects negative results and values above the integer storage limit.

The Products page uses `save_medicine(uuid, jsonb, jsonb)` from `20261009192000_save_medicine_rpc.sql` for transactional medicine/unit creation and editing. It requires an active user with `products` permission and validates active category/manufacturer selections; this migration does not alter RLS policies or helper functions.

The exported helper/policy implementation has role asymmetries: `is_admin()` recognizes only `admin`, and `has_any_permission()` grants its role override only to `admin`. That differs from the frontend’s Admin/Super Admin override. The first migration in the run order replaces only those two helpers to include active `super_admin` users; it does not alter any policy definition.

The `medicines` insert/update policies require `products`, not `categories`. There is no separate category table or category-specific write policy in the export; a user granted only `categories` can read medicines but cannot persist category edits by directly updating `medicines.category` under these policies. A future implementation must respect this rather than implying that category changes can be saved for that role.

## Verification limits

The export path contains one combined extensionless 91 KB file, not separate `1_columns.csv` through `6_triggers_views.csv` files. The combined file does not include trigger/view definitions or database grants, and is not an executable SQL dump. `00_baseline_schema.sql` is a reconstructed reference; verify it against a complete schema-only dump before using it to bootstrap a new project. No live/staging connectivity or write tests were performed.
