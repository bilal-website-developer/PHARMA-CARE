-- This removes provider/reference rows stored by the migration; export them before rollback.
BEGIN;

REVOKE ALL ON FUNCTION public.post_sale_with_payment_details(
  uuid, text, text, text, text, text, text, jsonb, integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.post_sale_with_payment_details(
  uuid, text, text, text, text, text, text, jsonb, integer, integer, integer, jsonb
);

REVOKE ALL ON FUNCTION public.sales_history_with_payment_details(integer)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.sales_history_with_payment_details(integer);

REVOKE ALL ON FUNCTION public.sales_history_range_with_payment_details(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.sales_history_range_with_payment_details(timestamptz, timestamptz);

REVOKE ALL ON FUNCTION tenant_private.sales_history_payment_details(integer, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS tenant_private.sales_history_payment_details(integer, timestamptz, timestamptz, text);

DROP TABLE IF EXISTS public.sale_payment_details;

COMMIT;
