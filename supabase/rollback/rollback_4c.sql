begin;

grant delete, insert, references, select, trigger, truncate, update on table
  public.stock_batches,
  public.purchases,
  public.purchase_items,
  public.sale_items,
  public.sale_item_batch_allocations
to anon, authenticated;

commit;
