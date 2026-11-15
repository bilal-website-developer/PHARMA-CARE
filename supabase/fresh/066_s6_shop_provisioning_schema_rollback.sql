-- Rollback for S6 package 066. Run only before provisioning uses this schema.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE public.shops IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_status_definition text;
  v_operation_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run package 066 rollback as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regclass('public.shop_provisioning_operations') IS NULL THEN
    RAISE EXCEPTION 'Provisioning ledger is absent; nothing to roll back.';
  END IF;

  SELECT count(*) INTO v_operation_count
  FROM public.shop_provisioning_operations;
  IF v_operation_count <> 0 THEN
    RAISE EXCEPTION 'Provisioning ledger contains rows; preserve them and use a reviewed forward repair.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.shops
    WHERE status IN ('provisioning', 'deleted') OR created_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Shop lifecycle data exists; rollback would discard it.';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO v_status_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.shops'::regclass
    AND constraint_row.conname = 'shops_status_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF v_status_definition IS NULL
     OR position('provisioning' IN lower(v_status_definition)) = 0
     OR position('deleted' IN lower(v_status_definition)) = 0 THEN
    RAISE EXCEPTION 'shops_status_check differs from package 066; stop for review.';
  END IF;
END
$preflight$;

DROP TABLE public.shop_provisioning_operations;
ALTER TABLE public.shops DROP COLUMN created_by;
ALTER TABLE public.shops DROP CONSTRAINT shops_status_check;
ALTER TABLE public.shops
  ADD CONSTRAINT shops_status_check
  CHECK (status IN ('active', 'suspended'));

COMMIT;

SELECT jsonb_build_object(
  'stage', 'S6 package 066 rollback check',
  'status', CASE
    WHEN to_regclass('public.shop_provisioning_operations') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shops'
          AND column_name = 'created_by'
      )
      AND pg_catalog.pg_get_constraintdef((
        SELECT constraint_row.oid
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.shops'::regclass
          AND constraint_row.conname = 'shops_status_check'
          AND constraint_row.contype = 'c'
      )) LIKE '%active%'
      AND pg_catalog.pg_get_constraintdef((
        SELECT constraint_row.oid
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.shops'::regclass
          AND constraint_row.conname = 'shops_status_check'
          AND constraint_row.contype = 'c'
      )) LIKE '%suspended%'
    THEN 'PASS' ELSE 'FAIL' END,
  'ledger_absent', to_regclass('public.shop_provisioning_operations') IS NULL,
  'shops_created_by_absent', NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shops'
      AND column_name = 'created_by'
  )
) AS s6_shop_provisioning_schema_rollback_check;
