-- Rollback for S6 package 068. Revert clients using these functions first.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE public.profiles, public.shops, public.shop_settings IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run package 068 rollback as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regprocedure('public.current_shop_settings()') IS NULL
     OR to_regprocedure('public.update_current_shop_settings(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Package 068 functions are not both installed; stop for review.';
  END IF;
END
$preflight$;

DROP FUNCTION public.update_current_shop_settings(jsonb);
DROP FUNCTION public.current_shop_settings();

COMMIT;

SELECT pg_catalog.jsonb_build_object(
  'stage', 'S6 package 068 scoped shop-settings rollback check',
  'status', CASE
    WHEN to_regprocedure('public.current_shop_settings()') IS NULL
      AND to_regprocedure('public.update_current_shop_settings(jsonb)') IS NULL
    THEN 'PASS' ELSE 'FAIL' END,
  'current_shop_settings_absent', to_regprocedure('public.current_shop_settings()') IS NULL,
  'update_current_shop_settings_absent', to_regprocedure('public.update_current_shop_settings(jsonb)') IS NULL
) AS s6_scoped_shop_settings_rollback_check;
