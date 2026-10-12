begin;

-- Restore the captured current-table ACLs for anon. All other public tables and
-- views remain revoked from anon, as they were absent from the supplied ACL capture.
grant delete, insert, references, select, trigger, truncate, update on table
  public.customers,
  public.khata_entries,
  public.medicine_units,
  public.medicines,
  public.sale_payments,
  public.sales,
  public.stock_movements,
  public.supplier_ledger,
  public.suppliers
to anon;

grant references, select, trigger, truncate on table public.profiles to anon;

-- Restore the captured default ACLs for future objects created by postgres.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on sequences to anon;

-- Existing sequence grants were not included in the supplied ACL capture.
-- Capture their pre-migration ACLs before running the migration, then add only
-- the exact required GRANT statements here before using this rollback file.

commit;
