BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.sales') IS NULL
     OR to_regclass('public.customers') IS NULL
     OR to_regclass('public.medicines') IS NULL
     OR to_regclass('public.medicine_units') IS NULL
     OR to_regclass('public.sale_items') IS NULL
     OR to_regclass('public.sale_payments') IS NULL
     OR to_regclass('public.sale_item_batch_allocations') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL THEN
    RAISE EXCEPTION 'POS customer details prerequisites are missing; inspect the deployed S4/S5 schema before applying';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'shop_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'shop_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'medicines' AND column_name = 'shop_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'medicine_units' AND column_name = 'shop_id'
  ) THEN
    RAISE EXCEPTION 'Shop-scoped POS tables are required; do not apply this migration to an earlier tenant schema';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc routine
    WHERE routine.oid = to_regprocedure(
      'public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)'
    )
      AND routine.prosecdef
      AND position('search_path=public' IN coalesce(array_to_string(routine.proconfig, ','), '')) > 0
      AND routine.prorettype = 'jsonb'::regtype
  ) THEN
    RAISE EXCEPTION 'The existing post_sale routine is not the expected protected JSON routine; inspect it before applying';
  END IF;
END;
$preflight$;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'WALK_IN',
  ADD COLUMN IF NOT EXISTS customer_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_whatsapp text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_notes text NOT NULL DEFAULT '';

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_customer_type_check'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_customer_type_check
      CHECK (customer_type IN (
        'WALK_IN', 'REGISTERED', 'CREDIT', 'DOCTOR_CLINIC', 'WHOLESALE_RETAILER'
      )) NOT VALID;
  END IF;
END;
$constraint$;

UPDATE public.sales sale
SET customer_type = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.sale_payments payment
    WHERE payment.sale_id = sale.id AND payment.payment_method = 'CREDIT'
  ) THEN 'CREDIT'
  WHEN sale.customer_id IS NOT NULL THEN 'REGISTERED'
  ELSE 'WALK_IN'
END;

UPDATE public.sales sale
SET customer_phone = customer.phone,
    customer_address = customer.address
FROM public.customers customer
WHERE customer.id = sale.customer_id
  AND customer.shop_id = sale.shop_id;

ALTER TABLE public.sales VALIDATE CONSTRAINT sales_customer_type_check;

CREATE OR REPLACE FUNCTION public.post_sale_with_customer_details(
  p_customer_id uuid,
  p_customer_name text,
  p_customer_type text,
  p_customer_phone text,
  p_customer_whatsapp text,
  p_customer_address text,
  p_customer_notes text,
  p_items jsonb,
  p_discount_paisa integer,
  p_rounding_paisa integer,
  p_tendered_paisa integer,
  p_payments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_phone text := coalesce(nullif(btrim(p_customer_phone), ''), '');
  v_whatsapp text := coalesce(nullif(btrim(p_customer_whatsapp), ''), '');
  v_address text := coalesce(nullif(btrim(p_customer_address), ''), '');
  v_notes text := coalesce(nullif(btrim(p_customer_notes), ''), '');
  v_result jsonb;
  v_sale_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active
      AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['pos']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with POS permission is required';
  END IF;

  IF p_customer_type IS NULL OR p_customer_type NOT IN (
    'WALK_IN', 'REGISTERED', 'CREDIT', 'DOCTOR_CLINIC', 'WHOLESALE_RETAILER'
  ) THEN
    RAISE EXCEPTION 'Invalid customer type';
  END IF;
  IF p_customer_id IS NULL AND (
    (v_phone <> '' AND v_phone !~ '^\+?[0-9]+$')
    OR (v_whatsapp <> '' AND v_whatsapp !~ '^\+?[0-9]+$')
  ) THEN
    RAISE EXCEPTION 'Customer phone numbers must contain digits and an optional leading +';
  END IF;

  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = p_customer_id AND shop_id = v_shop_id
  ) THEN
    RAISE EXCEPTION 'Select a customer from the active shop';
  END IF;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS requested(value)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.medicines medicine
      JOIN public.medicine_units unit ON unit.medicine_id = medicine.id
      WHERE medicine.id = nullif(requested.value->>'medicine_id', '')::uuid
        AND unit.id = nullif(requested.value->>'unit_id', '')::uuid
        AND medicine.shop_id = v_shop_id
        AND unit.shop_id = v_shop_id
    )
  ) THEN
    RAISE EXCEPTION 'Every sale item must belong to the active shop';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT
      coalesce(nullif(v_phone, ''), customer.phone),
      coalesce(nullif(v_address, ''), customer.address)
    INTO v_phone, v_address
    FROM public.customers customer
    WHERE customer.id = p_customer_id AND customer.shop_id = v_shop_id;
  END IF;

  v_result := public.post_sale(
    p_customer_id,
    p_customer_name,
    p_items,
    p_discount_paisa,
    p_rounding_paisa,
    p_tendered_paisa,
    p_payments
  );
  v_sale_id := nullif(v_result->>'id', '')::uuid;
  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'The sale routine returned no sale identifier';
  END IF;

  UPDATE public.sales
  SET customer_type = p_customer_type,
      customer_phone = coalesce(v_phone, ''),
      customer_whatsapp = v_whatsapp,
      customer_address = coalesce(v_address, ''),
      customer_notes = v_notes
  WHERE id = v_sale_id AND shop_id = v_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The sale was not recorded in the active shop';
  END IF;

  RETURN v_result || jsonb_build_object(
    'customerType', p_customer_type,
    'customerPhone', coalesce(v_phone, ''),
    'customerWhatsapp', v_whatsapp,
    'customerAddress', coalesce(v_address, ''),
    'customerNotes', v_notes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sales_history_range(
  p_from timestamptz,
  p_to_exclusive timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active
      AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['reports']::text[]) THEN
    RAISE EXCEPTION 'An active shop user with Reports permission is required';
  END IF;
  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_from >= p_to_exclusive THEN
    RAISE EXCEPTION 'Choose a valid inclusive sales date range';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', selected.id,
    'invoiceNumber', '',
    'timestamp', selected."timestamp",
    'cashierName', '',
    'customerId', null,
    'customerName', '',
    'customerPhone', '',
    'customerType', selected.customer_type,
    'subtotalPaisa', selected.subtotal_paisa,
    'discountPaisa', selected.discount_paisa,
    'totalPaisa', selected.total_paisa,
    'roundingPaisa', selected.rounding_paisa,
    'amountTenderedPaisa', selected.amount_tendered_paisa,
    'changePaisa', selected.change_paisa,
    'paymentMethod', CASE
      WHEN EXISTS (
        SELECT 1 FROM public.sale_payments payment
        WHERE payment.sale_id = selected.id AND payment.payment_method = 'CREDIT'
      ) THEN 'CREDIT'
      WHEN (
        SELECT count(*) FROM public.sale_payments payment
        WHERE payment.sale_id = selected.id
      ) > 1 THEN 'SPLIT'
      ELSE (
        SELECT payment.payment_method FROM public.sale_payments payment
        WHERE payment.sale_id = selected.id
        ORDER BY payment.created_at
        LIMIT 1
      )
    END,
    'items', selected.items
  ) ORDER BY selected."timestamp" DESC, selected.id DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT sale.*,
      (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', item.id,
          'medicineId', item.medicine_id,
          'unitId', item.unit_id,
          'productName', item.product_name,
          'genericName', item.generic_name,
          'unitName', item.unit_name,
          'conversionFactor', item.conversion_factor,
          'quantityInUnit', item.quantity_in_unit,
          'quantityBaseUnits', item.quantity_base_units,
          'pricePaisaPerUnit', item.price_paisa_per_unit,
          'drugClass', medicine.drug_class,
          'lineDiscountPaisa', item.line_discount_paisa,
          'lineTotalPaisa', item.line_total_paisa,
          'batchAllocations', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'id', allocation.id,
              'batchId', allocation.batch_id,
              'batchNumber', allocation.batch_number,
              'expiryDate', allocation.expiry_date,
              'quantityBaseUnits', allocation.quantity_base_units
            ) ORDER BY allocation.expiry_date, allocation.batch_id), '[]'::jsonb)
            FROM public.sale_item_batch_allocations allocation
            WHERE allocation.sale_item_id = item.id
          )
        ) ORDER BY item.created_at, item.id), '[]'::jsonb)
        FROM public.sale_items item
        JOIN public.medicines medicine
          ON medicine.id = item.medicine_id AND medicine.shop_id = v_shop_id
        WHERE item.sale_id = sale.id
      ) AS items
    FROM public.sales sale
    WHERE sale.shop_id = v_shop_id
      AND sale."timestamp" >= p_from
      AND sale."timestamp" < p_to_exclusive
  ) selected;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.post_sale_with_customer_details(
  uuid, text, text, text, text, text, text, jsonb, integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_with_customer_details(
  uuid, text, text, text, text, text, text, jsonb, integer, integer, integer, jsonb
) TO authenticated;
REVOKE ALL ON FUNCTION public.sales_history_range(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_history_range(timestamptz, timestamptz)
  TO authenticated;

COMMIT;
