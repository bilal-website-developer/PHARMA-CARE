begin;

revoke all on function public.assign_missing_barcodes(uuid[]) from authenticated;
revoke all on function public.assign_medicine_barcode(uuid, text, boolean) from authenticated;

drop function if exists public.assign_missing_barcodes(uuid[]);
drop function if exists public.assign_medicine_barcode(uuid, text, boolean);
drop function if exists public.ean13_check_digit(text);

drop sequence if exists public.medicine_barcode_seq;

commit;
