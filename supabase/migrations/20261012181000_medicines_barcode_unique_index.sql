begin;

create unique index if not exists medicines_barcode_unique
  on public.medicines (barcode)
  where barcode is not null and btrim(barcode) <> '';

commit;

notify pgrst, 'reload schema';
