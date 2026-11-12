BEGIN;

DROP FUNCTION IF EXISTS public.post_sale_with_customer_details(
  uuid, text, text, text, text, text, text, jsonb, integer, integer, integer, jsonb
);
DROP FUNCTION IF EXISTS public.sales_history_range(timestamptz, timestamptz);

COMMIT;
