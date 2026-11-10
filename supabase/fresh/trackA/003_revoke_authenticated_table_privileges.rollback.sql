GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.customers,
  public.khata_entries,
  public.medicines,
  public.sale_payments,
  public.sales,
  public.stock_movements,
  public.supplier_ledger
TO authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.medicine_units
TO authenticated;

GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.profiles,
  public.suppliers
TO authenticated;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.medicine_barcode_seq
TO authenticated;
