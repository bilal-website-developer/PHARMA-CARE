begin;

revoke all on function public.process_sale_return(uuid, jsonb) from authenticated, anon, public;
drop function if exists public.process_sale_return(uuid, jsonb);

revoke all on function public.reject_sale_return(uuid, text) from authenticated, anon, public;
drop function if exists public.reject_sale_return(uuid, text);

revoke all on function public.pending_sale_returns() from authenticated, anon, public;
drop function if exists public.pending_sale_returns();

revoke all on function public.request_sale_return(uuid, text, jsonb) from authenticated, anon, public;
drop function if exists public.request_sale_return(uuid, text, jsonb);

revoke all on function public.sale_for_return(text) from authenticated, anon, public;
drop function if exists public.sale_for_return(text);

revoke all on function public.sales_history(integer) from authenticated, anon, public;
drop function if exists public.sales_history(integer);

revoke all on function public.post_sale(uuid, text, jsonb, integer, integer, integer, jsonb) from authenticated, anon, public;
drop function if exists public.post_sale(uuid, text, jsonb, integer, integer, integer, jsonb);

revoke all on function public.update_return_policy_settings(integer, integer) from authenticated, anon, public;
drop function if exists public.update_return_policy_settings(integer, integer);

revoke all on function public.get_return_policy_settings() from authenticated, anon, public;
drop function if exists public.get_return_policy_settings();

revoke all on function public.customer_accounts_summary() from authenticated, anon, public;
drop function if exists public.customer_accounts_summary();

revoke all on function public.record_customer_payment(uuid, integer, text) from authenticated, anon, public;
drop function if exists public.record_customer_payment(uuid, integer, text);

revoke all on function public.save_customer(text, text, text, text, integer) from authenticated, anon, public;
drop function if exists public.save_customer(text, text, text, text, integer);

revoke all on function public.pos_customers() from authenticated, anon, public;
drop function if exists public.pos_customers();

drop index if exists public.sale_return_items_allocation_idx;
drop index if exists public.sale_return_items_sale_line_idx;
drop index if exists public.sale_returns_sale_status_idx;

-- These tables are introduced by this migration; dropping them removes their return records.
drop table if exists public.sale_return_items;
drop table if exists public.sale_returns;
drop table if exists public.return_policy_settings;

alter table public.customers
  drop constraint if exists customers_store_credit_paisa_check;

alter table public.customers
  drop column if exists store_credit_paisa;

-- The preceding stock-adjustment migration already removed stock_batches_check.
alter table public.stock_batches
  drop constraint if exists stock_batches_received_and_returned_check;

alter table public.stock_batches
  drop column if exists returned_quantity;

alter table public.sale_items
  drop column if exists unit_id,
  drop column if exists line_adjustment_paisa,
  drop column if exists line_discount_paisa;

alter table public.sales
  drop column if exists change_paisa,
  drop column if exists amount_tendered_paisa,
  drop column if exists rounding_paisa;

commit;
