-- Scope the five authenticated business RPCs identified by 050G.
-- Apply only after reviewing 050G_s5_catalog_candidate_review.sql output.
BEGIN;

DO $preflight$
DECLARE
  v_signature text;
  v_function pg_catalog.pg_proc%rowtype;
  v_definition text;
  v_owner text;
  v_signatures text[] := ARRAY[
    'public.master_data_overview()',
    'public.pos_customers()',
    'public.save_customer(text,text,text,text,integer)',
    'public.record_customer_payment(uuid,integer,text)',
    'public.sales_history(integer)'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this migration as the reviewed database owner role with RLS bypass.';
  END IF;

  IF to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL
     OR to_regprocedure('public.can_view_cost()') IS NULL THEN
    RAISE EXCEPTION 'Shop or permission prerequisites are missing; inspect before applying.';
  END IF;

  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Reviewed RPC % is missing; stop and inspect.', v_signature;
    END IF;

    SELECT *
    INTO v_function
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure(v_signature);

    v_definition := lower(pg_catalog.pg_get_functiondef(v_function.oid));
    v_owner := pg_catalog.pg_get_userbyid(v_function.proowner);

    IF NOT v_function.prosecdef
       OR pg_catalog.pg_get_function_result(v_function.oid) <> 'jsonb'
       OR v_owner <> 'postgres'
       OR coalesce(v_function.proconfig, ARRAY[]::text[]) <> ARRAY['search_path=public']::text[]
       OR position('tenant_private.current_shop_id()' IN v_definition) > 0
       OR position('shop_id' IN v_definition) > 0
       OR NOT has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function.oid, 'EXECUTE')
       OR has_function_privilege('anon', v_function.oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM aclexplode(coalesce(
           v_function.proacl,
           acldefault('f', v_function.proowner)
         )) privilege
         WHERE privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       )
       OR EXISTS (
         SELECT 1
         FROM aclexplode(coalesce(
           v_function.proacl,
           acldefault('f', v_function.proowner)
         )) privilege
         WHERE privilege.privilege_type = 'EXECUTE'
           AND privilege.grantee NOT IN (
             v_function.proowner,
             to_regrole('authenticated')::oid,
             to_regrole('service_role')::oid
           )
       ) THEN
      RAISE EXCEPTION 'Live RPC % differs from the reviewed definition or ACL; stop and inspect.', v_signature;
    END IF;

    IF (v_signature = 'public.master_data_overview()'
        AND (
          position('manufacturer_count' IN v_definition) = 0
          OR position('stock_value_paisa' IN v_definition) = 0
          OR position('near_expiry' IN v_definition) = 0
        ))
       OR (v_signature = 'public.pos_customers()'
        AND (
          position('creditlimitpaisa' IN v_definition) = 0
          OR position('from public.customers c' IN v_definition) = 0
        ))
       OR (v_signature = 'public.save_customer(text,text,text,text,integer)'
        AND (
          position('insert into public.customers (name, phone, cnic, address, credit_limit_paisa)' IN v_definition) = 0
          OR position('customer_created' IN v_definition) = 0
        ))
       OR (v_signature = 'public.record_customer_payment(uuid,integer,text)'
        AND (
          position('payment cannot exceed the customer' IN v_definition) = 0
          OR position('customer_payment_recorded' IN v_definition) = 0
        ))
       OR (v_signature = 'public.sales_history(integer)'
        AND (
          position('invoice_number' IN v_definition) = 0
          OR position('batchallocations' IN v_definition) = 0
          OR position('drug_class' IN v_definition) = 0
        )) THEN
      RAISE EXCEPTION 'Live RPC % does not match the reviewed behavior; stop and inspect.', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT expected.table_name
    FROM (VALUES
      ('profiles'), ('categories'), ('brands'), ('medicines'), ('medicine_units'),
      ('stock_batches'), ('customers'), ('khata_entries'), ('sales'), ('sale_items'),
      ('sale_payments'), ('sale_item_batch_allocations'), ('audit_logs')
    ) AS expected(table_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public'
        AND column_info.table_name = expected.table_name
        AND column_info.column_name = 'shop_id'
    )
  ) THEN
    RAISE EXCEPTION 'A required shop_id column is missing; stop and inspect.';
  END IF;

  IF EXISTS (
    SELECT expected.table_name
    FROM (VALUES
      ('profiles'), ('categories'), ('brands'), ('medicines'), ('medicine_units'),
      ('stock_batches'), ('customers'), ('khata_entries'), ('sales'), ('sale_items'),
      ('sale_payments'), ('sale_item_batch_allocations'), ('audit_logs')
    ) AS expected(table_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class relation
      WHERE relation.oid = to_regclass('public.' || expected.table_name)
        AND relation.relrowsecurity
    )
  ) THEN
    RAISE EXCEPTION 'A required tenant table is missing or has RLS disabled; stop and inspect.';
  END IF;

  IF EXISTS (
    SELECT expected.constraint_name
    FROM (VALUES
      ('khata_entries', 'khata_entries_customer_shop_id_fkey'),
      ('sales', 'sales_customer_shop_id_fkey'),
      ('medicine_units', 'medicine_units_medicine_shop_id_fkey'),
      ('stock_batches', 'stock_batches_medicine_shop_id_fkey'),
      ('sale_items', 'sale_items_medicine_shop_id_fkey'),
      ('sale_items', 'sale_items_sale_shop_id_fkey'),
      ('sale_items', 'sale_items_unit_shop_id_fkey'),
      ('sale_payments', 'sale_payments_sale_shop_id_fkey'),
      ('sale_item_batch_allocations', 'sale_item_batch_allocations_batch_shop_id_fkey'),
      ('sale_item_batch_allocations', 'sale_item_batch_allocations_sale_item_shop_id_fkey')
    ) AS expected(table_name, constraint_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = to_regclass('public.' || expected.table_name)
        AND constraint_row.conname = expected.constraint_name
        AND constraint_row.contype = 'f'
        AND constraint_row.convalidated
    )
  ) THEN
    RAISE EXCEPTION 'A required validated same-shop reference constraint is missing; stop and inspect.';
  END IF;

  IF EXISTS (
    SELECT expected.index_name
    FROM (VALUES
      ('medicines', 'medicines_shop_id_id_key'),
      ('customers', 'customers_shop_id_id_key'),
      ('sales', 'sales_shop_id_id_key'),
      ('medicine_units', 'medicine_units_shop_id_id_key'),
      ('stock_batches', 'stock_batches_shop_id_id_key'),
      ('sale_items', 'sale_items_shop_id_id_key'),
      ('sale_item_batch_allocations', 'sale_item_batch_allocations_shop_id_id_key')
    ) AS expected(table_name, index_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index index_info
      JOIN pg_catalog.pg_class index_class ON index_class.oid = index_info.indexrelid
      WHERE index_info.indrelid = to_regclass('public.' || expected.table_name)
        AND index_class.relname = expected.index_name
        AND index_info.indisunique
        AND index_info.indisvalid
    )
  ) THEN
    RAISE EXCEPTION 'A required valid same-shop unique index is missing; stop and inspect.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.master_data_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_actor public.profiles%rowtype;
  v_can_view_cost boolean;
BEGIN
  SELECT profile.*
  INTO v_actor
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.shop_id = v_shop_id
    AND profile.is_active
    AND profile.deleted_at IS NULL;

  IF auth.uid() IS NULL
     OR v_shop_id IS NULL
     OR v_actor.id IS NULL
     OR NOT public.has_any_permission(ARRAY['categories']::text[]) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'An active shop user with categories permission is required';
  END IF;

  v_can_view_cost := public.can_view_cost();

  RETURN jsonb_build_object(
    'categories', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', category.id,
          'name', category.name,
          'is_active', category.is_active,
          'product_count', (
            SELECT count(*)
            FROM public.medicines medicine
            WHERE medicine.shop_id = v_shop_id
              AND lower(btrim(medicine.category)) = lower(btrim(category.name))
          ),
          'low_count', (
            SELECT count(*)
            FROM public.medicines medicine
            LEFT JOIN LATERAL (
              SELECT sum(batch.quantity_remaining)::bigint AS quantity
              FROM public.stock_batches batch
              WHERE batch.medicine_id = medicine.id
                AND batch.shop_id = v_shop_id
                AND batch.quantity_remaining > 0
                AND batch.expiry_date >= current_date
                AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
            ) stock ON true
            WHERE medicine.shop_id = v_shop_id
              AND lower(btrim(medicine.category)) = lower(btrim(category.name))
              AND medicine.is_active
              AND medicine.min_stock_alert > 0
              AND coalesce(stock.quantity, 0) > 0
              AND stock.quantity <= medicine.min_stock_alert
          ),
          'out_count', (
            SELECT count(*)
            FROM public.medicines medicine
            LEFT JOIN LATERAL (
              SELECT sum(batch.quantity_remaining)::bigint AS quantity
              FROM public.stock_batches batch
              WHERE batch.medicine_id = medicine.id
                AND batch.shop_id = v_shop_id
                AND batch.quantity_remaining > 0
                AND batch.expiry_date >= current_date
                AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
            ) stock ON true
            WHERE medicine.shop_id = v_shop_id
              AND lower(btrim(medicine.category)) = lower(btrim(category.name))
              AND medicine.is_active
              AND coalesce(stock.quantity, 0) = 0
          ),
          'expiring_count', (
            SELECT count(*)
            FROM public.stock_batches batch
            JOIN public.medicines medicine
              ON medicine.id = batch.medicine_id
             AND medicine.shop_id = v_shop_id
            WHERE batch.shop_id = v_shop_id
              AND lower(btrim(medicine.category)) = lower(btrim(category.name))
              AND medicine.is_active
              AND batch.quantity_remaining > 0
              AND batch.expiry_date BETWEEN current_date AND current_date + 90
              AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
          ),
          'stock_value_paisa', CASE WHEN v_can_view_cost THEN coalesce((
            SELECT sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
            FROM public.stock_batches batch
            JOIN public.medicines medicine
              ON medicine.id = batch.medicine_id
             AND medicine.shop_id = v_shop_id
            WHERE batch.shop_id = v_shop_id
              AND lower(btrim(medicine.category)) = lower(btrim(category.name))
              AND medicine.is_active
              AND batch.quantity_remaining > 0
              AND batch.expiry_date >= current_date
              AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
          ), 0) ELSE NULL END
        ) ORDER BY lower(category.name), category.id
      )
      FROM public.categories category
      WHERE category.shop_id = v_shop_id
    ), '[]'::jsonb),
    'manufacturers', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', brand.id,
          'name', brand.name,
          'is_active', brand.is_active,
          'product_count', (
            SELECT count(*)
            FROM public.medicines medicine
            WHERE medicine.shop_id = v_shop_id
              AND lower(btrim(medicine.company)) = lower(btrim(brand.name))
          ),
          'low_count', (
            SELECT count(*)
            FROM public.medicines medicine
            LEFT JOIN LATERAL (
              SELECT sum(batch.quantity_remaining)::bigint AS quantity
              FROM public.stock_batches batch
              WHERE batch.medicine_id = medicine.id
                AND batch.shop_id = v_shop_id
                AND batch.quantity_remaining > 0
                AND batch.expiry_date >= current_date
                AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
            ) stock ON true
            WHERE medicine.shop_id = v_shop_id
              AND lower(btrim(medicine.company)) = lower(btrim(brand.name))
              AND medicine.is_active
              AND medicine.min_stock_alert > 0
              AND coalesce(stock.quantity, 0) > 0
              AND stock.quantity <= medicine.min_stock_alert
          ),
          'out_count', (
            SELECT count(*)
            FROM public.medicines medicine
            LEFT JOIN LATERAL (
              SELECT sum(batch.quantity_remaining)::bigint AS quantity
              FROM public.stock_batches batch
              WHERE batch.medicine_id = medicine.id
                AND batch.shop_id = v_shop_id
                AND batch.quantity_remaining > 0
                AND batch.expiry_date >= current_date
                AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
            ) stock ON true
            WHERE medicine.shop_id = v_shop_id
              AND lower(btrim(medicine.company)) = lower(btrim(brand.name))
              AND medicine.is_active
              AND coalesce(stock.quantity, 0) = 0
          ),
          'expiring_count', (
            SELECT count(*)
            FROM public.stock_batches batch
            JOIN public.medicines medicine
              ON medicine.id = batch.medicine_id
             AND medicine.shop_id = v_shop_id
            WHERE batch.shop_id = v_shop_id
              AND lower(btrim(medicine.company)) = lower(btrim(brand.name))
              AND medicine.is_active
              AND batch.quantity_remaining > 0
              AND batch.expiry_date BETWEEN current_date AND current_date + 90
              AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
          ),
          'stock_value_paisa', CASE WHEN v_can_view_cost THEN coalesce((
            SELECT sum(batch.quantity_remaining::numeric * batch.cost_paisa_per_base_unit)
            FROM public.stock_batches batch
            JOIN public.medicines medicine
              ON medicine.id = batch.medicine_id
             AND medicine.shop_id = v_shop_id
            WHERE batch.shop_id = v_shop_id
              AND lower(btrim(medicine.company)) = lower(btrim(brand.name))
              AND medicine.is_active
              AND batch.quantity_remaining > 0
              AND batch.expiry_date >= current_date
              AND batch.status IN ('ACTIVE', 'NEAR_EXPIRY')
          ), 0) ELSE NULL END
        ) ORDER BY lower(brand.name), brand.id
      )
      FROM public.brands brand
      WHERE brand.shop_id = v_shop_id
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'category_count', (SELECT count(*) FROM public.categories WHERE shop_id = v_shop_id),
      'active_category_count', (
        SELECT count(*) FROM public.categories
        WHERE shop_id = v_shop_id AND is_active
      ),
      'manufacturer_count', (SELECT count(*) FROM public.brands WHERE shop_id = v_shop_id),
      'active_manufacturer_count', (
        SELECT count(*) FROM public.brands
        WHERE shop_id = v_shop_id AND is_active
      ),
      'product_count', (SELECT count(*) FROM public.medicines WHERE shop_id = v_shop_id),
      'unit_count', (SELECT count(*) FROM public.medicine_units WHERE shop_id = v_shop_id)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_customers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_actor public.profiles%rowtype;
  v_result jsonb;
BEGIN
  SELECT profile.*
  INTO v_actor
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.shop_id = v_shop_id
    AND profile.is_active
    AND profile.deleted_at IS NULL;

  IF auth.uid() IS NULL
     OR v_shop_id IS NULL
     OR v_actor.id IS NULL
     OR NOT public.has_any_permission(ARRAY['pos']::text[]) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'You do not have permission to use POS customers';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', customer.id,
    'name', customer.name,
    'phone', coalesce(customer.phone, ''),
    'address', coalesce(customer.address, ''),
    'creditLimitPaisa', customer.credit_limit_paisa,
    'currentBalancePaisa', customer.current_balance_paisa,
    'storeCreditPaisa', customer.store_credit_paisa
  ) ORDER BY customer.name, customer.id), '[]'::jsonb)
  INTO v_result
  FROM public.customers AS customer
  WHERE customer.shop_id = v_shop_id;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_customer(
  p_name text,
  p_phone text DEFAULT '',
  p_cnic text DEFAULT NULL,
  p_address text DEFAULT '',
  p_credit_limit_paisa integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_actor public.profiles%rowtype;
  v_customer public.customers%rowtype;
BEGIN
  SELECT profile.*
  INTO v_actor
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.shop_id = v_shop_id
    AND profile.is_active
    AND profile.deleted_at IS NULL;

  IF auth.uid() IS NULL
     OR v_shop_id IS NULL
     OR v_actor.id IS NULL
     OR NOT public.has_any_permission(ARRAY['customers']::text[]) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'You do not have permission to manage customers';
  END IF;
  IF nullif(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF coalesce(p_credit_limit_paisa, 0) < 0 THEN
    RAISE EXCEPTION 'Credit limit cannot be negative';
  END IF;

  INSERT INTO public.customers (
    shop_id, name, phone, cnic, address, credit_limit_paisa
  )
  VALUES (
    v_shop_id,
    btrim(p_name),
    coalesce(btrim(p_phone), ''),
    nullif(btrim(p_cnic), ''),
    coalesce(btrim(p_address), ''),
    coalesce(p_credit_limit_paisa, 0)
  )
  RETURNING * INTO v_customer;

  INSERT INTO public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  VALUES (
    v_shop_id, auth.uid(), 'CUSTOMER_CREATED', 'customer', v_customer.id,
    jsonb_build_object('name', v_customer.name)
  );

  RETURN jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'phone', v_customer.phone,
    'address', v_customer.address,
    'creditLimitPaisa', v_customer.credit_limit_paisa,
    'currentBalancePaisa', v_customer.current_balance_paisa,
    'storeCreditPaisa', v_customer.store_credit_paisa
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_customer_payment(
  p_customer_id uuid,
  p_amount_paisa integer,
  p_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_actor public.profiles%rowtype;
  v_customer public.customers%rowtype;
  v_reference text;
  v_balance integer;
BEGIN
  SELECT profile.*
  INTO v_actor
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.shop_id = v_shop_id
    AND profile.is_active
    AND profile.deleted_at IS NULL;

  IF auth.uid() IS NULL
     OR v_shop_id IS NULL
     OR v_actor.id IS NULL
     OR NOT public.has_any_permission(ARRAY['customers']::text[]) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'You do not have permission to record customer payments';
  END IF;
  IF p_amount_paisa IS NULL OR p_amount_paisa <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT customer.*
  INTO v_customer
  FROM public.customers AS customer
  WHERE customer.id = p_customer_id
    AND customer.shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer was not found';
  END IF;
  IF p_amount_paisa > v_customer.current_balance_paisa THEN
    RAISE EXCEPTION 'Payment cannot exceed the customer''s outstanding balance';
  END IF;

  v_balance := v_customer.current_balance_paisa - p_amount_paisa;
  v_reference := 'RCP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  UPDATE public.customers
  SET current_balance_paisa = v_balance
  WHERE id = p_customer_id
    AND shop_id = v_shop_id;

  INSERT INTO public.khata_entries (
    shop_id, customer_id, entry_type, reference_number, description,
    debit_paisa, credit_paisa, created_by
  )
  VALUES (
    v_shop_id,
    p_customer_id,
    'PAYMENT',
    v_reference,
    coalesce(nullif(btrim(p_note), ''), 'Customer payment'),
    0,
    p_amount_paisa,
    auth.uid()
  );

  INSERT INTO public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  VALUES (
    v_shop_id, auth.uid(), 'CUSTOMER_PAYMENT_RECORDED', 'customer', p_customer_id,
    jsonb_build_object('amount_paisa', p_amount_paisa, 'reference', v_reference)
  );

  RETURN jsonb_build_object(
    'referenceNo', v_reference,
    'dateTime', now(),
    'balanceAfterPaisa', v_balance,
    'storeCreditPaisa', v_customer.store_credit_paisa
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sales_history(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_actor public.profiles%rowtype;
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
BEGIN
  SELECT profile.*
  INTO v_actor
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.shop_id = v_shop_id
    AND profile.is_active
    AND profile.deleted_at IS NULL;

  IF auth.uid() IS NULL
     OR v_shop_id IS NULL
     OR v_actor.id IS NULL
     OR NOT public.has_any_permission(ARRAY['sales_history']::text[]) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'You do not have permission to view sales history';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', selected.id,
    'invoiceNumber', selected.invoice_number,
    'timestamp', selected."timestamp",
    'cashierName', selected.cashier_name,
    'customerId', selected.customer_id,
    'customerName', selected.customer_name,
    'customerPhone', coalesce(customer.phone, ''),
    'subtotalPaisa', selected.subtotal_paisa,
    'discountPaisa', selected.discount_paisa,
    'totalPaisa', selected.total_paisa,
    'roundingPaisa', selected.rounding_paisa,
    'amountTenderedPaisa', selected.amount_tendered_paisa,
    'changePaisa', selected.change_paisa,
    'paymentMethod', CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.sale_payments payment
        WHERE payment.sale_id = selected.id
          AND payment.shop_id = v_shop_id
          AND payment.payment_method = 'CREDIT'
      ) THEN 'CREDIT'
      WHEN (
        SELECT count(*)
        FROM public.sale_payments payment
        WHERE payment.sale_id = selected.id
          AND payment.shop_id = v_shop_id
      ) > 1 THEN 'SPLIT'
      ELSE (
        SELECT payment.payment_method
        FROM public.sale_payments payment
        WHERE payment.sale_id = selected.id
          AND payment.shop_id = v_shop_id
        ORDER BY payment.created_at
        LIMIT 1
      )
    END,
    'status', selected.status,
    'items', selected.items
  ) ORDER BY selected."timestamp" DESC), '[]'::jsonb)
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
            JOIN public.stock_batches batch
              ON batch.id = allocation.batch_id
             AND batch.shop_id = v_shop_id
             AND batch.medicine_id = medicine.id
            WHERE allocation.sale_item_id = item.id
              AND allocation.shop_id = v_shop_id
          )
        ) ORDER BY item.created_at, item.id), '[]'::jsonb)
        FROM public.sale_items item
        JOIN public.medicines medicine
          ON medicine.id = item.medicine_id
         AND medicine.shop_id = v_shop_id
        JOIN public.medicine_units unit
          ON unit.id = item.unit_id
         AND unit.medicine_id = item.medicine_id
         AND unit.shop_id = v_shop_id
        WHERE item.sale_id = sale.id
          AND item.shop_id = v_shop_id
      ) AS items
    FROM public.sales sale
    WHERE sale.shop_id = v_shop_id
      AND (
        sale.cashier_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.profiles same_shop_cashier
          WHERE same_shop_cashier.id = sale.cashier_id
            AND same_shop_cashier.shop_id = v_shop_id
        )
      )
      AND (
        sale.customer_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.customers same_shop_customer
          WHERE same_shop_customer.id = sale.customer_id
            AND same_shop_customer.shop_id = v_shop_id
        )
      )
    ORDER BY sale."timestamp" DESC, sale.id DESC
    LIMIT v_limit
  ) selected
  LEFT JOIN public.customers customer
    ON customer.id = selected.customer_id
   AND customer.shop_id = v_shop_id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.master_data_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pos_customers() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_customer(text, text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_customer_payment(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_history(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_data_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_customers() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_customer(text, text, text, text, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid, integer, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sales_history(integer) TO authenticated, service_role;

DO $postflight$
DECLARE
  v_signature text;
  v_function pg_catalog.pg_proc%rowtype;
  v_definition text;
  v_signatures text[] := ARRAY[
    'public.master_data_overview()',
    'public.pos_customers()',
    'public.save_customer(text,text,text,text,integer)',
    'public.record_customer_payment(uuid,integer,text)',
    'public.sales_history(integer)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    SELECT *
    INTO v_function
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure(v_signature);

    v_definition := lower(pg_catalog.pg_get_functiondef(v_function.oid));

    IF NOT v_function.prosecdef
       OR pg_catalog.pg_get_function_result(v_function.oid) <> 'jsonb'
       OR pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
       OR coalesce(v_function.proconfig, ARRAY[]::text[]) <> ARRAY['search_path=pg_catalog']::text[]
       OR position('tenant_private.current_shop_id()' IN v_definition) = 0
       OR position('v_shop_id' IN v_definition) = 0
       OR NOT has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function.oid, 'EXECUTE')
       OR has_function_privilege('anon', v_function.oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM aclexplode(coalesce(
           v_function.proacl,
           acldefault('f', v_function.proowner)
         )) privilege
         WHERE privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       )
       OR EXISTS (
         SELECT 1
         FROM aclexplode(coalesce(
           v_function.proacl,
           acldefault('f', v_function.proowner)
         )) privilege
         WHERE privilege.privilege_type = 'EXECUTE'
           AND privilege.grantee NOT IN (
             v_function.proowner,
             to_regrole('authenticated')::oid,
             to_regrole('service_role')::oid
           )
       ) THEN
      RAISE EXCEPTION 'Scoped RPC % failed postflight; transaction must be rolled back.', v_signature;
    END IF;
  END LOOP;
END;
$postflight$;

COMMIT;
