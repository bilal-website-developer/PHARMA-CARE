begin;

grant select, insert, update, delete, truncate, references, trigger, maintain on table
  public.customers,
  public.khata_entries,
  public.medicines,
  public.sale_payments,
  public.sales,
  public.stock_movements,
  public.supplier_ledger
to authenticated;

grant insert, update, delete, truncate, references, trigger, maintain on table
  public.medicine_units
to authenticated;

grant select, references, trigger, maintain on table
  public.profiles,
  public.suppliers
to authenticated;

grant select, update, usage on sequence public.medicine_barcode_seq
to authenticated;

commit;
