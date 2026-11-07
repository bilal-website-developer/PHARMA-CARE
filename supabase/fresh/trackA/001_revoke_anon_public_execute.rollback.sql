-- Track A / A1 rollback
-- This restores the pre-lockdown public-EXECUTE state for the 16 functions that were previously exposed.
-- Use only if the dry run or live run fails and you want to restore the prior state.

GRANT EXECUTE ON FUNCTION public.deactivate_supplier(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_permission(text[]) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.master_data_overview() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_purchase(uuid, text, date, integer, text, jsonb, integer, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_catalog() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_detail(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_history(text, text, date, date, integer, integer, boolean) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_supplier(uuid, text, text, text, text, text, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_adjustments_log(integer, integer, date, date, text, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_batches_list(text, text, text, integer, integer, uuid, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_expiry_buckets() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_overview_stats() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_purchase(uuid, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_off_expired_batch(uuid, text) TO PUBLIC, anon, authenticated, service_role;

-- If the earlier app state had more PUBLIC/anon execute grants, re-grant them here as needed.
