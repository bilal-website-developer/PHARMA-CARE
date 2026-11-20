-- Owner-run rollback. Restores UUID invoice assignment for future sales.
-- Existing invoice values are not rewritten and the counter column is retained
-- so a later re-apply cannot reuse numbers already assigned.
BEGIN;

DO $rollback$
DECLARE
  v_definition text;
  v_updated_definition text;
  v_new_declaration text := E'  v_invoice_sequence bigint;\n';
  v_old_declaration text := '';
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
  IF to_regprocedure('public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'post_sale is missing; inspect the deployed schema before rollback.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)'::regprocedure
  );
  IF position(v_new_declaration IN v_definition) = 0
     OR position(v_new_assignment IN v_definition) = 0
     OR position('public.shops.next_invoice_sequence' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'post_sale does not match the reviewed short-invoice implementation; stop and inspect.';
  END IF;

  v_updated_definition := replace(v_definition, v_new_declaration, v_old_declaration);
  v_updated_definition := replace(v_updated_definition, v_new_assignment, v_old_assignment);
  EXECUTE v_updated_definition;
END
$rollback$;

COMMIT;
