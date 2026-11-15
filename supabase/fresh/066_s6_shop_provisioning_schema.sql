-- S6 package 066. Adds the durable shop-provisioning ledger and lifecycle states.
-- Owner-run only after reviewing package 065's live preflight.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.shops IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_status_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run package 066 as the reviewed database owner role with RLS bypass.';
  END IF;

  IF to_regclass('public.shops') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.audit_logs') IS NULL
     OR to_regprocedure('public.manage_users_profile_update(uuid,uuid,text,text,text,text,text[],boolean,uuid)') IS NULL THEN
    RAISE EXCEPTION 'A required package 065 or package 064 object is missing.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'shop_provisioning_operations'
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shops'
      AND column_name = 'created_by'
  ) THEN
    RAISE EXCEPTION 'Package 066 objects already exist; inspect before applying.';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO v_status_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.shops'::regclass
    AND constraint_row.conname = 'shops_status_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;

  IF v_status_definition IS NULL
     OR position('active' IN lower(v_status_definition)) = 0
     OR position('suspended' IN lower(v_status_definition)) = 0
     OR position('provisioning' IN lower(v_status_definition)) > 0
     OR position('deleted' IN lower(v_status_definition)) > 0 THEN
    RAISE EXCEPTION 'shops_status_check differs from package 065; stop for review.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.shops AS shop
    WHERE shop.status NOT IN ('active', 'suspended')
  ) THEN
    RAISE EXCEPTION 'shops contains an unexpected status; stop for review.';
  END IF;
END
$preflight$;

ALTER TABLE public.shops
  ADD COLUMN created_by uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.shops
  DROP CONSTRAINT shops_status_check;

ALTER TABLE public.shops
  ADD CONSTRAINT shops_status_check
  CHECK (status IN ('active', 'suspended', 'provisioning', 'deleted'));

CREATE TABLE public.shop_provisioning_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL,
  shop_id uuid REFERENCES public.shops(id) ON DELETE SET NULL,
  auth_user_id uuid,
  request_fingerprint text NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending_auth'
    CHECK (status IN (
      'pending_auth',
      'auth_created',
      'finalizing',
      'completed',
      'compensation_pending',
      'compensation_failed',
      'compensated',
      'failed'
    )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) <= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX shop_provisioning_operations_auth_user_key
  ON public.shop_provisioning_operations (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX shop_provisioning_operations_open_idx
  ON public.shop_provisioning_operations (status, created_at)
  WHERE status IN (
    'pending_auth', 'auth_created', 'finalizing',
    'compensation_pending', 'compensation_failed'
  );

ALTER TABLE public.shop_provisioning_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_provisioning_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.shop_provisioning_operations TO service_role;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shops'
      AND column_name = 'created_by'
      AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shop_provisioning_operations'
      AND column_name = 'requested_by'
      AND data_type = 'uuid'
      AND is_nullable = 'NO'
  ) OR to_regclass('public.shop_provisioning_operations') IS NULL
    OR NOT (
      SELECT relation.relrowsecurity
      FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = 'public.shop_provisioning_operations'::regclass
    ) THEN
    RAISE EXCEPTION 'Package 066 postflight verification failed.';
  END IF;
END
$postflight$;

COMMIT;
