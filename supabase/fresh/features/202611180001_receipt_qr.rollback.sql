-- Receipt QR package rollback. Owner-run only; destroys QR settings and links.
-- Deliberately contains no top-level BEGIN/COMMIT.
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this rollback as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regclass('public.sale_receipt_links') IS NULL
     OR to_regclass('public.shop_receipt_qr_settings') IS NULL
     OR to_regclass('public.receipt_public_rate_limits') IS NULL THEN
    RAISE EXCEPTION 'Receipt QR tables are incomplete; stop and inspect before rollback.';
  END IF;
END
$preflight$;

DROP FUNCTION public.record_public_receipt_view(uuid);
DROP FUNCTION public.consume_receipt_rate_limit(text, integer, integer);
DROP FUNCTION public.sale_id_for_receipt_invoice(text);
DROP FUNCTION public.revoke_receipt_link(uuid);
DROP FUNCTION public.resolve_receipt_link(text);
DROP FUNCTION public.get_or_create_receipt_link(uuid);
DROP FUNCTION public.update_receipt_qr_settings(jsonb);
DROP FUNCTION public.get_receipt_qr_settings();
DROP TABLE public.receipt_public_rate_limits;
DROP TABLE public.sale_receipt_links;
DROP TABLE public.shop_receipt_qr_settings;

NOTIFY pgrst, 'reload schema';
