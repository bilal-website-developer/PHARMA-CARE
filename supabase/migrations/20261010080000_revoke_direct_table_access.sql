begin;

revoke all privileges on table
  public.stock_batches,
  public.purchases,
  public.purchase_items,
  public.sale_items,
  public.sale_item_batch_allocations
from anon, authenticated;

commit;
