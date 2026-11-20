-- Read-only verification after applying 202611200003_short_shop_invoice_numbers.sql.
DO $test$
DECLARE
  v_definition text;
  v_counter_not_null boolean;
  v_index_definition text;
BEGIN
  IF to_regprocedure('public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: scoped post_sale is missing.';
  END IF;

  SELECT is_nullable = 'NO'
  INTO v_counter_not_null
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'shops'
    AND column_name = 'next_invoice_sequence';
  IF v_counter_not_null IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: shops.next_invoice_sequence is missing or nullable.';
  END IF;

  SELECT pg_catalog.pg_get_indexdef(index_info.indexrelid)
  INTO v_index_definition
  FROM pg_catalog.pg_index AS index_info
  WHERE index_info.indexrelid = to_regclass('public.sales_shop_invoice_number_key')
    AND index_info.indrelid = 'public.sales'::regclass
    AND index_info.indisunique;
  IF v_index_definition IS NULL
     OR position('(shop_id, invoice_number)' IN v_index_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: unique per-shop invoice index is missing.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)'::regprocedure
  );
  IF position('next_invoice_sequence = next_invoice_sequence + 1' IN v_definition) = 0
     OR position('v_invoice_sequence' IN v_definition) = 0
     OR position('greatest(6, length(v_invoice_sequence::text))' IN v_definition) = 0
     OR position('v_invoice := ''INV-'' || lpad(' IN v_definition) = 0
     OR position('v_invoice := ''INV-'' || replace(v_sale_id::text, ''-'', '''');' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'FAIL: post_sale does not allocate short per-shop invoice numbers as reviewed.';
  END IF;

  RAISE NOTICE 'PASS: non-null per-shop counter, uniqueness, atomic allocation, and minimum six-digit formatting verified.';
END
$test$;
