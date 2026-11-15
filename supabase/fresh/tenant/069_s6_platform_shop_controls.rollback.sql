-- Roll back package 069 only when no shop is suspended or non-default limits exist.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $preflight$
BEGIN
  IF to_regclass('public.shops') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'shops'
         AND column_name = 'admin_limit'
     ) THEN
    RAISE EXCEPTION 'Package 069 does not appear to be installed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.shops
    WHERE status <> 'active'
       OR admin_limit <> 10
       OR staff_limit <> 100
  ) THEN
    RAISE EXCEPTION 'Rollback would erase active shop lifecycle or limit settings; restore those settings and review first.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.shop_provisioning_operations
    WHERE status NOT IN ('completed','compensated','failed')
  ) THEN
    RAISE EXCEPTION 'Rollback would remove state needed by an incomplete provisioning operation.';
  END IF;
END
$preflight$;

LOCK TABLE public.shops, public.profiles, public.shop_provisioning_operations
  IN SHARE ROW EXCLUSIVE MODE;

DO $drop_write_guards$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT relation.relname
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN information_schema.columns AS column_row
      ON column_row.table_schema = namespace.nspname
      AND column_row.table_name = relation.relname
      AND column_row.column_name = 'shop_id'
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r','p')
      AND relation.relname NOT IN ('shops','shop_provisioning_operations')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
        WHERE inheritance.inhrelid = relation.oid
      )
  LOOP
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS inactive_shop_write_guard ON public.%I',
      v_table.relname
    );
  END LOOP;
END
$drop_write_guards$;

DROP TRIGGER IF EXISTS shop_profile_limit_guard ON public.profiles;
DROP FUNCTION public.finalize_shop_provisioning(uuid,uuid,uuid,text,text,text,text,text,text,text,text[],integer,integer);
DROP FUNCTION public.platform_admin_private_note(uuid,uuid,text);
DROP FUNCTION public.platform_manage_shop(uuid,uuid,text,text,text,text,text,integer,integer);
DROP FUNCTION public.current_shop_profile();
DROP FUNCTION public.current_shop_access();
DROP FUNCTION tenant_private.enforce_shop_profile_limits();
DROP FUNCTION tenant_private.reject_inactive_shop_write();

ALTER TABLE public.shops
  DROP COLUMN staff_limit,
  DROP COLUMN admin_limit;

DROP INDEX public.shop_provisioning_operations_open_idx;
ALTER TABLE public.shop_provisioning_operations
  DROP CONSTRAINT shop_provisioning_operations_status_check,
  ADD CONSTRAINT shop_provisioning_operations_status_check
    CHECK (status IN (
      'pending_auth','auth_created','finalizing','completed',
      'compensation_pending','compensation_failed','compensated','failed'
    ));
CREATE INDEX shop_provisioning_operations_open_idx
  ON public.shop_provisioning_operations (status, created_at)
  WHERE status IN (
    'pending_auth','auth_created','finalizing',
    'compensation_pending','compensation_failed'
  );
ALTER TABLE public.shop_provisioning_operations
  DROP COLUMN auth_email;

COMMIT;
