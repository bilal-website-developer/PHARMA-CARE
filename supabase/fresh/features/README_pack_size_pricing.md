# Part B pack-size pricing SQL drafts

These are reviewed drafts, not an instruction to deploy. No SQL has been run.
Do not run the migration, tests, or rollback before the shop delivery and a
separate owner approval. Do not start Part A or edit the application without
that approval.

## SQL Editor order

1. Open `202610290001_pack_size_pricing.preflight.sql`. Run each numbered
   `SELECT` (1 through 6) separately, with only that statement selected. Each
   returns one JSON cell and contains schema facts, aggregate counts, or
   aggregate totals; it does not return product, customer, staff, or barcode
   row values. Stop if a statement errors or the results do not match the
   expected schema. Save all six outputs for review.
2. After the preflight is reviewed and a test window is approved, dry-run
   `202610290001_pack_size_pricing.sql`. The file intentionally has no
   transaction boundary. In the SQL Editor, submit the entire file as one
   script with `BEGIN;` before its contents and `ROLLBACK;` after its contents.
   Never run this file without an explicit transaction wrapper. Do not replace
   the dry-run `ROLLBACK;` with `COMMIT;`.
3. Only on an approved, isolated test project where the migration has actually
   been applied, run `202610290001_pack_size_pricing.test.sql` as one script.
   It creates test fixtures and calls RPCs inside its own transaction, then
   rolls them back. A migration dry run ends in rollback, so the test script
   cannot run successfully immediately after that dry run.
4. Use `202610290001_pack_size_pricing.rollback.sql` only if the migration was
   applied, the owner explicitly approves rollback, and the live dependencies,
   fallback units, and grants have been reviewed. The rollback deliberately
   stops if any migration-created fallback unit remains. Preserve or explicitly
   reassign such units and their references before considering rollback. The
   rollback leaves the migration's restricted `medicine_units` grants in place;
   compare the saved preflight ACL output and restore any previous grants
   separately, only after review.

## What to report back

Paste the six one-cell preflight results, the migration dry-run completion or
error text, and any specific SQL Editor warning. Do not paste credentials,
keys, customer/staff data, or screenshots containing them. A successful dry
run has no SQL errors, passes the migration's before/after totals assertion,
and ends with an explicit `ROLLBACK`; it leaves no migration changes behind.
The SQL Editor may display an RLS/security confirmation popup for a statement.
For these reviewed statements only, choose **Run this query** (or the equivalent
run-confirmation button). Do not choose an option to disable RLS or broaden
access.

## Review limitations

The preflight is read-only, but results still need owner review. Live columns,
constraints, RPC definitions/permissions, shop scope, and grants are not
verified yet. The migration does not replace the existing POS catalog or
workflow RPCs; consequently, display of inactive or unpriced units and
dosage/base-label persistence still need coordinated follow-up. Multi-pack
CSV round-tripping is also not implemented. Do not treat this draft as complete
Part B or as production-ready.

Static review risks to resolve before any application:

- The existing `pos_catalog()` still returns every unit using legacy
  `price_paisa`; it does not filter newly inactive or unpriced units. The sale
  trigger rejects an inactive or NULL-priced unit at insert time, so POS may
  show a unit that checkout later rejects.
- Clearing a configured nullable price synchronizes legacy `price_paisa` to
  zero so the old catalog/RPC remains compatible. The client can therefore
  display zero for a unit that the new trigger treats as unpriced. New
  `save_medicine()` inserts with legacy price zero also leave the nullable price
  unset; verify that zero and “not configured” are intended to differ.
- For a medicine with no units, the migration proposes the earliest-expiring
  eligible batch's MRP as the new base-unit sale price. That is a business-price
  assumption, not a verified product price. If no eligible batch exists, the
  unit remains unpriced.
- The deferred default-unit trigger enforces exactly one active default at
  transaction end. This avoids an immediate unique-index conflict with the
  current `save_medicine()` loop, which updates units in caller-provided order.
  Concurrent/direct table writes and all live RPC paths still need isolated
  testing.
- Purchase posting must resolve to an active unit and updates that unit's
  latest pack cost. The trigger checks conversion and locks medicine then unit;
  live `purchase_items` columns/types and the deployed `post_purchase()` body
  remain **ASSUMED: verify**.
- The rollback cannot restore unknown pre-migration ACLs. It deliberately keeps
  the restricted column grants and stops if migration-created fallback units
  remain; a rollback needs a reviewed, manual grant plan and explicit unit
  handling.
- Sale, purchase, and return RPC signatures/security/grants; the exact live
  columns/constraints; `medicine_units` RLS/ACL; absence of shop isolation;
  existing default counts; and baseline totals are all **ASSUMED: verify**.
  Return RPCs are not replaced, and this trigger does not rewrite existing
  return records or conversion behavior.
