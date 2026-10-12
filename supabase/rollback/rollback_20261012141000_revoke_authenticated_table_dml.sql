begin;

grant insert, update, delete, truncate on table
  public.customers,
  public.khata_entries,
  public.medicine_units,
  public.medicines,
  public.sale_payments,
  public.sales,
  public.stock_movements,
  public.supplier_ledger
to authenticated;

commit;
