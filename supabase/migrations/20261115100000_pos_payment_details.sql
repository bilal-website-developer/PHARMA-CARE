BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.sales') IS NULL
     OR to_regclass('public.sale_payments') IS NULL
     OR to_regclass('public.sale_items') IS NULL
     OR to_regclass('public.sale_item_batch_allocations') IS NULL
     OR to_regclass('public.medicines') IS NULL
     OR to_regclass('public.customers') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regnamespace('tenant_private') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.post_sale_with_customer_details(uuid,text,text,text,text,text,text,jsonb,integer,integer,integer,jsonb)') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL THEN
    RAISE EXCEPTION 'POS payment-details prerequisites are missing; inspect the deployed tenant and POS schema before applying';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'shop_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sale_items' AND column_name = 'shop_id'
  ) THEN
    RAISE EXCEPTION 'Shop-scoped sales and sale items are required; do not apply this migration to an earlier tenant schema';
  END IF;
END;
$preflight$;

CREATE TABLE public.sale_payment_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  payment_method text NOT NULL CHECK (payment_method IN ('CASH', 'CARD', 'EASYPAISA', 'JAZZCASH', 'CREDIT')),
  provider_id text CHECK (provider_id IN (
    'cash', 'jazzcash', 'easypaisa', 'sadapay', 'nayapay',
    'meezan', 'hbl', 'ubl', 'mcb', 'abl', 'alfalah', 'faysal',
    'bop', 'askari', 'other_bank_transfer_raast', 'card'
  )),
  amount_paisa integer NOT NULL CHECK (amount_paisa > 0),
  reference text CHECK (reference IS NULL OR length(reference) <= 200),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_payment_details_provider_method_check CHECK (
    (provider_id IS NULL AND payment_method = 'CREDIT')
    OR (provider_id = 'cash' AND payment_method = 'CASH')
    OR (provider_id = 'easypaisa' AND payment_method = 'EASYPAISA')
    OR (provider_id = 'jazzcash' AND payment_method = 'JAZZCASH')
    OR (
      provider_id IN (
        'sadapay', 'nayapay', 'meezan', 'hbl', 'ubl', 'mcb', 'abl',
        'alfalah', 'faysal', 'bop', 'askari', 'other_bank_transfer_raast', 'card'
      )
      AND payment_method = 'CARD'
    )
  )
);

CREATE INDEX sale_payment_details_shop_sale_idx
  ON public.sale_payment_details (shop_id, sale_id, created_at, id);

ALTER TABLE public.sale_payment_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sale_payment_details FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_sale_with_payment_details(
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
  v_payment jsonb;
  v_provider_id text;
  v_payment_method text;
  v_expected_method text;
  v_reference text;
  v_aggregated_payments jsonb;
  v_result jsonb;
  v_payment_details jsonb;
  v_summary_method text;
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

  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array'
     OR jsonb_array_length(p_payments) = 0
     OR jsonb_array_length(p_payments) > 100 THEN
    RAISE EXCEPTION 'A sale must contain between 1 and 100 payment rows';
  END IF;

  FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payments)
  LOOP
    v_payment_method := v_payment->>'payment_method';
    v_provider_id := nullif(btrim(v_payment->>'provider_id'), '');
    v_reference := nullif(btrim(v_payment->>'reference'), '');

    IF coalesce(nullif(v_payment->>'amount_paisa', '')::integer, 0) <= 0 THEN
      RAISE EXCEPTION 'Payment amounts must be greater than zero';
    END IF;
    IF v_reference IS NOT NULL AND length(v_reference) > 200 THEN
      RAISE EXCEPTION 'Payment reference must be 200 characters or fewer';
    END IF;

    v_expected_method := CASE
      WHEN v_provider_id = 'cash' THEN 'CASH'
      WHEN v_provider_id = 'easypaisa' THEN 'EASYPAISA'
      WHEN v_provider_id = 'jazzcash' THEN 'JAZZCASH'
      WHEN v_provider_id IN (
        'sadapay', 'nayapay', 'meezan', 'hbl', 'ubl', 'mcb', 'abl',
        'alfalah', 'faysal', 'bop', 'askari', 'other_bank_transfer_raast', 'card'
      ) THEN 'CARD'
      WHEN v_provider_id IS NULL AND v_payment_method = 'CREDIT' THEN 'CREDIT'
      ELSE NULL
    END;
    IF v_expected_method IS NULL OR v_payment_method IS DISTINCT FROM v_expected_method THEN
      RAISE EXCEPTION 'Payment provider does not match its payment method';
    END IF;
    IF v_provider_id = 'cash' AND v_reference IS NOT NULL THEN
      RAISE EXCEPTION 'Cash payments cannot include a transaction reference';
    END IF;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object(
    'payment_method', mapped.payment_method,
    'amount_paisa', mapped.amount_paisa
  ) ORDER BY mapped.payment_method)
  INTO v_aggregated_payments
  FROM (
    SELECT CASE
      WHEN payment.value->>'provider_id' = 'cash' THEN 'CASH'
      WHEN payment.value->>'provider_id' = 'easypaisa' THEN 'EASYPAISA'
      WHEN payment.value->>'provider_id' = 'jazzcash' THEN 'JAZZCASH'
      WHEN payment.value->>'payment_method' = 'CREDIT' THEN 'CREDIT'
      ELSE 'CARD'
    END AS payment_method,
    sum((payment.value->>'amount_paisa')::integer)::integer AS amount_paisa
    FROM jsonb_array_elements(p_payments) AS payment(value)
    GROUP BY 1
  ) AS mapped;

  v_result := public.post_sale_with_customer_details(
    p_customer_id,
    p_customer_name,
    p_customer_type,
    p_customer_phone,
    p_customer_whatsapp,
    p_customer_address,
    p_customer_notes,
    p_items,
    p_discount_paisa,
    p_rounding_paisa,
    p_tendered_paisa,
    v_aggregated_payments
  );

  v_summary_method := CASE
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_aggregated_payments) payment(value)
      WHERE payment.value->>'payment_method' = 'CREDIT'
    ) THEN 'CREDIT'
    WHEN jsonb_array_length(p_payments) > 1 THEN 'SPLIT'
    ELSE v_aggregated_payments->0->>'payment_method'
  END;

  INSERT INTO public.sale_payment_details (
    sale_id, shop_id, payment_method, provider_id,
    amount_paisa, reference, created_by
  )
  SELECT
    (v_result->>'id')::uuid,
    v_shop_id,
    payment.value->>'payment_method',
    nullif(btrim(payment.value->>'provider_id'), ''),
    (payment.value->>'amount_paisa')::integer,
    nullif(btrim(payment.value->>'reference'), ''),
    auth.uid()
  FROM jsonb_array_elements(p_payments) AS payment(value);

  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'paymentMethod', details.payment_method,
    'providerId', details.provider_id,
    'amountPaisa', details.amount_paisa,
    'reference', details.reference
  )) ORDER BY details.created_at, details.id), '[]'::jsonb)
  INTO v_payment_details
  FROM public.sale_payment_details details
  WHERE details.sale_id = (v_result->>'id')::uuid
    AND details.shop_id = v_shop_id;

  RETURN v_result || jsonb_build_object(
    'paymentMethod', v_summary_method,
    'paymentDetails', v_payment_details
  );
END;
$function$;

CREATE OR REPLACE FUNCTION tenant_private.sales_history_payment_details(
  p_limit integer,
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_permission text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_is_range boolean := p_from IS NOT NULL OR p_to_exclusive IS NOT NULL;
BEGIN
  IF p_permission NOT IN ('sales_history', 'reports') THEN
    RAISE EXCEPTION 'Sales history permission is invalid';
  END IF;
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active
      AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY[p_permission]::text[]) THEN
    RAISE EXCEPTION 'An active shop user with the required permission is required';
  END IF;
  IF v_is_range AND (
    p_permission <> 'reports'
    OR p_from IS NULL OR p_to_exclusive IS NULL OR p_from >= p_to_exclusive
  ) THEN
    RAISE EXCEPTION 'Choose a valid inclusive sales date range';
  END IF;

  SELECT coalesce(jsonb_agg(selected.sale_json
    ORDER BY selected.sale_timestamp DESC, selected.id DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT sale.id,
      sale."timestamp" AS sale_timestamp,
      CASE WHEN v_is_range THEN
        jsonb_build_object(
          'id', sale.id,
          'invoiceNumber', '',
          'timestamp', sale."timestamp",
          'cashierName', '',
          'customerId', null,
          'customerName', '',
          'customerPhone', '',
          'customerType', sale.customer_type,
          'subtotalPaisa', sale.subtotal_paisa,
          'discountPaisa', sale.discount_paisa,
          'totalPaisa', sale.total_paisa,
          'roundingPaisa', sale.rounding_paisa,
          'amountTenderedPaisa', sale.amount_tendered_paisa,
          'changePaisa', sale.change_paisa,
          'paymentMethod', CASE
            WHEN EXISTS (
              SELECT 1 FROM public.sale_payments payment
              WHERE payment.sale_id = sale.id AND payment.payment_method = 'CREDIT'
            ) THEN 'CREDIT'
            WHEN (
              SELECT count(*) FROM public.sale_payment_details details
              WHERE details.sale_id = sale.id AND details.shop_id = v_shop_id
            ) > 1 OR (
              SELECT count(*) FROM public.sale_payments payment
              WHERE payment.sale_id = sale.id
            ) > 1 THEN 'SPLIT'
            ELSE (
              SELECT payment.payment_method FROM public.sale_payments payment
              WHERE payment.sale_id = sale.id ORDER BY payment.created_at LIMIT 1
            )
          END,
          'paymentDetails', (
            SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'paymentMethod', details.payment_method,
              'providerId', details.provider_id,
              'amountPaisa', details.amount_paisa,
              'reference', details.reference
            )) ORDER BY details.created_at, details.id), '[]'::jsonb)
            FROM public.sale_payment_details details
            WHERE details.sale_id = sale.id AND details.shop_id = v_shop_id
          ),
          'items', sale_items.items
        )
      ELSE
        jsonb_build_object(
          'id', sale.id,
          'invoiceNumber', sale.invoice_number,
          'timestamp', sale."timestamp",
          'cashierName', sale.cashier_name,
          'customerId', sale.customer_id,
          'customerName', sale.customer_name,
          'customerPhone', coalesce(customer.phone, ''),
          'customerType', sale.customer_type,
          'subtotalPaisa', sale.subtotal_paisa,
          'discountPaisa', sale.discount_paisa,
          'totalPaisa', sale.total_paisa,
          'roundingPaisa', sale.rounding_paisa,
          'amountTenderedPaisa', sale.amount_tendered_paisa,
          'changePaisa', sale.change_paisa,
          'paymentMethod', CASE
            WHEN EXISTS (
              SELECT 1 FROM public.sale_payments payment
              WHERE payment.sale_id = sale.id AND payment.payment_method = 'CREDIT'
            ) THEN 'CREDIT'
            WHEN (
              SELECT count(*) FROM public.sale_payment_details details
              WHERE details.sale_id = sale.id AND details.shop_id = v_shop_id
            ) > 1 OR (
              SELECT count(*) FROM public.sale_payments payment
              WHERE payment.sale_id = sale.id
            ) > 1 THEN 'SPLIT'
            ELSE (
              SELECT payment.payment_method FROM public.sale_payments payment
              WHERE payment.sale_id = sale.id ORDER BY payment.created_at LIMIT 1
            )
          END,
          'paymentDetails', (
            SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'paymentMethod', details.payment_method,
              'providerId', details.provider_id,
              'amountPaisa', details.amount_paisa,
              'reference', details.reference
            )) ORDER BY details.created_at, details.id), '[]'::jsonb)
            FROM public.sale_payment_details details
            WHERE details.sale_id = sale.id AND details.shop_id = v_shop_id
          ),
          'status', sale.status,
          'items', sale_items.items
        )
      END AS sale_json
    FROM public.sales sale
    LEFT JOIN public.customers customer
      ON customer.id = sale.customer_id AND customer.shop_id = v_shop_id
    CROSS JOIN LATERAL (
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
      ) ORDER BY item.created_at, item.id), '[]'::jsonb) AS items
      FROM public.sale_items item
      JOIN public.medicines medicine
        ON medicine.id = item.medicine_id AND medicine.shop_id = v_shop_id
      WHERE item.sale_id = sale.id AND item.shop_id = v_shop_id
    ) AS sale_items
    WHERE sale.shop_id = v_shop_id
      AND (NOT v_is_range OR (
        sale."timestamp" >= p_from AND sale."timestamp" < p_to_exclusive
      ))
    ORDER BY sale."timestamp" DESC, sale.id DESC
    LIMIT CASE WHEN v_is_range THEN NULL ELSE v_limit END
  ) AS selected;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sales_history_with_payment_details(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT tenant_private.sales_history_payment_details(p_limit, NULL, NULL, 'sales_history');
$function$;

CREATE OR REPLACE FUNCTION public.sales_history_range_with_payment_details(
  p_from timestamptz,
  p_to_exclusive timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT tenant_private.sales_history_payment_details(NULL, p_from, p_to_exclusive, 'reports');
$function$;

REVOKE ALL ON FUNCTION public.post_sale_with_payment_details(
  uuid, text, text, text, text, text, text, jsonb, integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_with_payment_details(
  uuid, text, text, text, text, text, text, jsonb, integer, integer, integer, jsonb
) TO authenticated;

REVOKE ALL ON FUNCTION public.sales_history_with_payment_details(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_history_with_payment_details(integer)
  TO authenticated;
REVOKE ALL ON FUNCTION public.sales_history_range_with_payment_details(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_history_range_with_payment_details(timestamptz, timestamptz)
  TO authenticated;
REVOKE ALL ON FUNCTION tenant_private.sales_history_payment_details(integer, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
