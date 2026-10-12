# Staging Supabase Bootstrap and Read-Only Comparison

**Purpose:** prepare a separate, disposable Supabase staging project from the checked-in baseline and forward migrations, then compare public database catalog metadata with the current project before any multi-shop migration is written.

**Gate:** stop after returning the comparison results. Do not apply any multi-shop migration. Do not run migrations or write SQL against the current project. No SQL has been run by the assistant.

## Important limitations

- `supabase/baseline/00_baseline_schema.sql` is explicitly a reconstructed reference snapshot, not a complete project dump. Its header says the source export omits grants, triggers, views, extensions, and other database properties. It may not reproduce the current project by itself.
- Applying the listed local migrations creates the **local checked-in target schema** on staging; it does not prove that the current project is at that same migration level. The catalog comparison is intended to identify and resolve differences before tenant migrations are designed.
- A matching catalog does not prove that business rows, Auth settings, Edge Function deployments, secrets, or storage configuration match. The queries below deliberately inspect metadata only and do not read business-table data.
- Use a brand-new staging project. Never use the current project as the staging target. Do not put project URLs, keys, passwords, pooler URLs, or customer data in this repository or chat.
- The migration directory contains two files named as rollbacks with timestamp-like names. They are **not forward migrations**. A broad CLI push may order them as migrations and undo the barcode migrations. For this bootstrap, apply only the explicitly listed forward files, one at a time, in the Supabase SQL Editor. Do not run `supabase db push` against this directory.
- The old barcode assignment/index migrations are included below only to reproduce the checked-in pre-multi-shop state on staging. Do not apply them to the current project. The future multi-shop registry migration must replace the medicine-only global index and cover both `medicines.barcode` and `medicine_units.barcode`.

## Build the staging project

1. Create a separate Supabase project named for staging. Confirm the project selector shows staging before opening its SQL Editor. Keep it empty and do not import production data.
2. In the staging SQL Editor, run `supabase/baseline/00_baseline_schema.sql` once. This file is marked **already applied on the live project** and is only for a new empty project. If it fails, stop and report the exact error; do not patch around it or continue to the migrations.
3. Apply each forward migration listed below, in order, individually. Check the SQL Editor result after each file. On any error, stop and report the filename and error; do not continue with later migrations. Do not apply rollback files.
4. `20261012140500_optional_lockdown_supabase_admin_defaults.sql` is optional. Skip it unless the staging SQL role has the required membership in `supabase_admin`; a membership/permission error is not a reason to change the script or role setup.
5. Do not add application data or production credentials. Do not deploy Edge Functions as part of this bootstrap.
6. After the staging schema is built, run every query in **Catalog comparison queries** in both projects. Copy the result sets separately, label them `CURRENT` and `STAGING`, and return them for review. These are SELECT-only metadata checks.

### Forward migration order

Run the following files in this order after the baseline. Skip the optional B file when role membership is unavailable.

1. `20261008220000_allow_super_admin_admin_override.sql`
2. `20261008230000_complete_purchase_workflow.sql`
3. `20261009190000_add_medicine_categories_and_brands.sql`
4. `20261009191000_add_stock_adjustment_rpc.sql`
5. `20261009192000_save_medicine_rpc.sql`
6. `20261009200000_create_audit_logs.sql`
7. `20261009201000_add_pos_print_permissions.sql`
8. `20261009202000_create_print_requests.sql`
9. `20261010035000_add_medicine_strength.sql`
10. `20261010040000_products_redesign_rpc.sql`
11. `20261010050000_master_data_overview_merge.sql`
12. `20261010055000_sellable_stock_status_alignment.sql`
13. `20261010060000_stock_inventory_functions.sql`
14. `20261010061000_write_off_expired_batch.sql`
15. `20261010070000_purchase_cost_visibility.sql`
16. `20261010080000_revoke_direct_table_access.sql`
17. `20261012130000_scope_cost_visibility.sql`
18. `20261012140000_lockdown_anon_public_access.sql`
19. `20261012140500_optional_lockdown_supabase_admin_defaults.sql` (optional; see above)
20. `20261012141000_revoke_authenticated_table_dml.sql`
21. `20261012142000_supplier_write_rpcs.sql`
22. `20261012143000_revoke_authenticated_supplier_dml.sql`
23. `20261012144000_lockdown_profile_dml.sql`
24. `20261012160000_modify_print_requests.sql`
25. `20261012170000_trash_bin_history.sql`
26. `20261012180000_assign_medicine_barcodes.sql` (staging only, legacy comparison state)
27. `20261012181000_medicines_barcode_unique_index.sql` (staging only, legacy comparison state)

Do **not** apply `20261012180001_assign_medicine_barcodes_rollback.sql` or `20261012181001_medicines_barcode_unique_index_rollback.sql` during bootstrap.

## Catalog comparison queries

Run these unchanged in the SQL Editor of **both** projects. They are read-only and return catalog metadata, not pharmacy business rows. Keep the `CURRENT` and `STAGING` results separate.

### Objects and row-security flags

```sql
select n.nspname as schema_name,
       c.relname as object_name,
       c.relkind as object_kind,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
order by c.relkind, c.relname;
```

### Functions, owner, security-definer flag, and configured search path

```sql
select n.nspname as schema_name,
       p.oid::regprocedure::text as function_signature,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       coalesce(
         (
           select split_part(cfg.setting, '=', 2)
           from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
           where cfg.setting like 'search_path=%'
           limit 1
         ),
         '(not set on function)'
       ) as configured_search_path,
       coalesce(array_to_string(p.proconfig, ', '), '(no function settings)') as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.oid::regprocedure::text;
```

### RLS policy definitions

```sql
select schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

### Table/view and sequence grants

```sql
select grantee, table_name, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
order by table_name, grantee, privilege_type;
```

```sql
select grantee,
       object_name as sequence_name,
       privilege_type,
       is_grantable
from information_schema.role_usage_grants
where object_schema = 'public'
  and object_type = 'SEQUENCE'
order by object_name, grantee, privilege_type;
```

### Effective access to the `public` schema

```sql
select rolname as role_name,
       has_schema_privilege(rolname, 'public', 'USAGE') as can_use_schema,
       has_schema_privilege(rolname, 'public', 'CREATE') as can_create_in_schema
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role', 'postgres')
order by rolname;
```

### Function grants

```sql
select grantee,
       routine_name,
       specific_name,
       privilege_type,
       is_grantable
from information_schema.role_routine_grants
where specific_schema = 'public'
order by routine_name, specific_name, grantee, privilege_type;
```

### Constraints

```sql
select n.nspname as schema_name,
       t.relname as table_name,
       c.conname as constraint_name,
       c.contype as constraint_type,
       c.convalidated as is_validated,
       c.condeferrable as is_deferrable,
       pg_get_constraintdef(c.oid, true) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
order by t.relname, c.conname;
```

### Indexes

```sql
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;
```

### Installed extensions

```sql
select e.extname as extension_name,
       e.extversion as extension_version,
       n.nspname as installed_schema,
       pg_get_userbyid(e.extowner) as owner
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
order by e.extname;
```

## Return checkpoint

Return the labeled CURRENT and STAGING outputs for the queries above, and report:

- Which migrations were successfully applied to staging, including whether optional migration B was skipped.
- Any file that failed, with the exact error text.
- Whether the current project is already known to have the barcode assignment function and the global `medicines_barcode_unique` index; use the index/function metadata results, not a new migration.

No multi-shop migration will be written until these results are reviewed. The global barcode index will be replaced in the future registry design; do not leave it as the final uniqueness rule.
