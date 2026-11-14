-- Scope customer_accounts_summary() to the authenticated user's active shop.
-- Run only after reviewing 050E_s5_customer_accounts_scope_review.sql.
-- The RPC response shape and authenticated/service_role grants are preserved.
BEGIN;

DO $preflight$
DECLARE
  v_function pg_catalog.pg_proc%rowtype;
  v_function_definition text;
  v_function_owner text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this migration as the reviewed database owner role with RLS bypass.';
  END IF;

  IF to_regprocedure('public.customer_accounts_summary()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL THEN
    RAISE EXCEPTION 'Customer account scope prerequisites are missing; inspect before applying.';
  END IF;

  SELECT *
  INTO v_function
  FROM pg_catalog.pg_proc
  WHERE oid = to_regprocedure('public.customer_accounts_summary()');

  v_function_definition := lower(pg_catalog.pg_get_functiondef(v_function.oid));
  v_function_owner := pg_catalog.pg_get_userbyid(v_function.proowner);

  IF v_function.prorettype <> 'jsonb'::regtype
     OR NOT v_function.prosecdef
     OR coalesce(v_function.proconfig, ARRAY[]::text[]) <> ARRAY['search_path=public']::text[]
     OR v_function_owner <> 'postgres'
     OR position('tenant_private.current_shop_id()' IN v_function_definition) > 0
     OR position('shop_id' IN v_function_definition) > 0 THEN
    RAISE EXCEPTION 'Live customer_accounts_summary() differs from the reviewed unscoped definition; stop and inspect.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
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
     ) THEN
    RAISE EXCEPTION 'Customer account RPC grants differ from the reviewed ACL; stop and inspect.';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class relation
       JOIN pg_catalog.pg_roles table_owner ON table_owner.oid = relation.relowner
       WHERE relation.oid = 'public.customers'::regclass
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
         AND relation.relowner = v_function.proowner
         AND table_owner.rolbypassrls
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class relation
       JOIN pg_catalog.pg_roles table_owner ON table_owner.oid = relation.relowner
       WHERE relation.oid = 'public.khata_entries'::regclass
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
         AND relation.relowner = v_function.proowner
         AND table_owner.rolbypassrls
     ) THEN
    RAISE EXCEPTION 'Customer/ledger RLS ownership differs from the reviewed state; stop and inspect.';
  END IF;

  IF EXISTS (
    SELECT expected.table_name
    FROM (VALUES ('customers'), ('khata_entries')) AS expected(table_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public'
        AND column_info.table_name = expected.table_name
        AND column_info.column_name = 'shop_id'
    )
  ) THEN
    RAISE EXCEPTION 'A customer/ledger shop_id column is missing; stop and inspect.';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_index index_info
       JOIN pg_catalog.pg_class index_class ON index_class.oid = index_info.indexrelid
       WHERE index_info.indrelid = 'public.customers'::regclass
         AND index_class.relname = 'customers_shop_id_id_key'
         AND index_info.indisunique
         AND index_info.indisvalid
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint constraint_row
       WHERE constraint_row.conrelid = 'public.khata_entries'::regclass
         AND constraint_row.conname = 'khata_entries_customer_shop_id_fkey'
         AND constraint_row.contype = 'f'
         AND constraint_row.convalidated
     ) THEN
    RAISE EXCEPTION 'Reviewed same-shop customer/ledger keys are missing or invalid; stop and inspect.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.customer_accounts_summary()
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
     OR NOT public.has_any_permission(ARRAY['customers']::text[]) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'You do not have permission to view customer accounts';
  END IF;

  SELECT jsonb_build_object(
    'customers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', customer.id,
        'name', customer.name,
        'phone', coalesce(customer.phone, ''),
        'cnic', customer.cnic,
        'address', coalesce(customer.address, ''),
        'creditLimitPaisa', customer.credit_limit_paisa,
        'currentBalancePaisa', customer.current_balance_paisa,
        'storeCreditPaisa', customer.store_credit_paisa
      ) ORDER BY customer.name, customer.id)
      FROM public.customers AS customer
      WHERE customer.shop_id = v_shop_id
    ), '[]'::jsonb),
    'ledgerEntries', coalesce((
      SELECT jsonb_object_agg(grouped.customer_id::text, grouped.entries)
      FROM (
        SELECT ledger.customer_id,
          jsonb_agg(jsonb_build_object(
            'id', ledger.id,
            'customerId', ledger.customer_id,
            'date', ledger.created_at::date,
            'type', ledger.entry_type,
            'referenceNo', ledger.reference_number,
            'description', ledger.description,
            'debitPaisa', ledger.debit_paisa,
            'creditPaisa', ledger.credit_paisa,
            'runningBalancePaisa', ledger.running_balance_paisa
          ) ORDER BY ledger.created_at DESC, ledger.id DESC) AS entries
        FROM (
          SELECT entry.*,
            sum(entry.debit_paisa - entry.credit_paisa) OVER (
              PARTITION BY entry.customer_id
              ORDER BY entry.created_at, entry.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            )::integer AS running_balance_paisa
          FROM public.khata_entries AS entry
          JOIN public.customers AS customer
            ON customer.id = entry.customer_id
           AND customer.shop_id = v_shop_id
          WHERE entry.shop_id = v_shop_id
        ) AS ledger
        GROUP BY ledger.customer_id
      ) AS grouped
    ), '{}'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_accounts_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_accounts_summary() TO authenticated, service_role;

DO $postflight$
DECLARE
  v_function pg_catalog.pg_proc%rowtype;
  v_function_definition text;
BEGIN
  SELECT *
  INTO v_function
  FROM pg_catalog.pg_proc
  WHERE oid = to_regprocedure('public.customer_accounts_summary()');

  v_function_definition := lower(pg_catalog.pg_get_functiondef(v_function.oid));

  IF NOT v_function.prosecdef
     OR v_function.prorettype <> 'jsonb'::regtype
     OR coalesce(v_function.proconfig, ARRAY[]::text[]) <> ARRAY['search_path=pg_catalog']::text[]
     OR position('tenant_private.current_shop_id()' IN v_function_definition) = 0
     OR position('customer.shop_id = v_shop_id' IN v_function_definition) = 0
     OR position('entry.shop_id = v_shop_id' IN v_function_definition) = 0
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
     ) THEN
    RAISE EXCEPTION 'Scoped customer_accounts_summary() postflight failed; transaction must be rolled back.';
  END IF;
END;
$postflight$;

COMMIT;
