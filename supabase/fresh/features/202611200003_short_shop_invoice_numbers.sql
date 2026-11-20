-- Owner-run feature patch. Apply after the scoped post_sale function in Batch 027.
-- New sales receive a per-shop sequential invoice number; existing numbers are untouched.
BEGIN;

DO $preflight$
DECLARE
  v_definition text;
  v_index_definition text;
BEGIN
  IF to_regprocedure('public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)') IS NULL
     OR to_regclass('public.shops') IS NULL
     OR to_regclass('public.sales') IS NULL THEN
    RAISE EXCEPTION 'Required shops, sales, or scoped post_sale objects are missing; inspect the deployed schema.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shops'
      AND column_name = 'next_invoice_sequence'
  ) THEN
    RAISE EXCEPTION 'shops.next_invoice_sequence already exists; inspect the current counter and function before applying.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)'::regprocedure
  );
  IF position('v_invoice := ''INV-'' || replace(v_sale_id::text, ''-'', '''');' IN v_definition) = 0
     OR position('  v_invoice text;' IN v_definition) = 0
     OR position('v_invoice_sequence' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'post_sale differs from the reviewed UUID-invoice implementation; stop and inspect before patching.';
  END IF;

  SELECT pg_catalog.pg_get_indexdef(index_info.indexrelid)
  INTO v_index_definition
  FROM pg_catalog.pg_index AS index_info
  WHERE index_info.indexrelid = to_regclass('public.sales_shop_invoice_number_key')
    AND index_info.indrelid = 'public.sales'::regclass
    AND index_info.indisunique;
  IF v_index_definition IS NULL
     OR position('(shop_id, invoice_number)' IN v_index_definition) = 0 THEN
    RAISE EXCEPTION 'Expected unique (shop_id, invoice_number) index is missing; stop and inspect the deployed keys.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sales
    WHERE invoice_number ~ '^INV-[0-9]{19,}$'
  ) THEN
    RAISE EXCEPTION 'A numeric invoice suffix exceeds the safe backfill range; inspect existing invoice numbers.';
  END IF;
END
$preflight$;

ALTER TABLE public.shops
  ADD COLUMN next_invoice_sequence bigint NOT NULL DEFAULT 1
  CHECK (next_invoice_sequence > 0);

UPDATE public.shops AS shop
SET next_invoice_sequence = coalesce((
  SELECT max(substring(sale.invoice_number FROM 5)::bigint) + 1
  FROM public.sales AS sale
  WHERE sale.shop_id = shop.id
    AND sale.invoice_number ~ '^INV-[0-9]{1,18}$'
), 1);

COMMENT ON COLUMN public.shops.next_invoice_sequence
  IS 'Next per-shop invoice sequence value; allocated atomically by post_sale.';

DO $replace_function$
DECLARE
  v_definition text;
  v_updated_definition text;
  v_old_declaration text := '  v_invoice text;';
  v_new_declaration text := E'  v_invoice_sequence bigint;\n  v_invoice text;';
  v_old_assignment text := '  v_invoice := ''INV-'' || replace(v_sale_id::text, ''-'', '''');';
  v_new_assignment text := $assignment$
  -- The row update serializes invoice allocation within this shop.
  UPDATE public.shops
  SET next_invoice_sequence = next_invoice_sequence + 1
  WHERE id = v_shop_id
    AND next_invoice_sequence < 9223372036854775807
  RETURNING next_invoice_sequence - 1 INTO v_invoice_sequence;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop invoice sequence is unavailable or exhausted';
  END IF;
  v_invoice := 'INV-' || lpad(
    v_invoice_sequence::text,
    greatest(6, length(v_invoice_sequence::text)),
    '0'
  );
$assignment$;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)'::regprocedure
  );

  IF position(v_old_declaration IN v_definition) = 0
     OR position(v_old_assignment IN v_definition) = 0
     OR (length(v_definition) - length(replace(v_definition, v_old_declaration, ''))) / length(v_old_declaration) <> 1
     OR (length(v_definition) - length(replace(v_definition, v_old_assignment, ''))) / length(v_old_assignment) <> 1 THEN
    RAISE EXCEPTION 'post_sale no longer has the exact reviewed declaration and assignment; transaction aborted.';
  END IF;

  v_updated_definition := replace(v_definition, v_old_declaration, v_new_declaration);
  v_updated_definition := replace(v_updated_definition, v_old_assignment, v_new_assignment);
  EXECUTE v_updated_definition;
END
$replace_function$;

COMMIT;
