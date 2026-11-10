-- Track A / A1
-- Run this in Supabase SQL Editor.
-- First dry-run: paste this inside BEGIN; ... ROLLBACK; and look for zero rows in the final checks.
-- After approval: run the same SQL without the ROLLBACK line.

REVOKE ALL PRIVILEGES ON FUNCTION public.deactivate_supplier(uuid) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.has_any_permission(text[]) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_staff() FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.master_data_overview() FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.post_purchase(uuid, text, date, integer, text, jsonb, integer, text) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.purchase_catalog() FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.purchase_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.purchase_history(text, text, date, date, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.save_supplier(uuid, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.stock_adjustments_log(integer, integer, date, date, text, uuid) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.stock_batches_list(text, text, text, integer, integer, uuid, text) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.stock_expiry_buckets() FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.stock_overview_stats() FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.void_purchase(uuid, text) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.write_off_expired_batch(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.deactivate_supplier(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_permission(text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.master_data_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_purchase(uuid, text, date, integer, text, jsonb, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_catalog() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_history(text, text, date, date, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_supplier(uuid, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_adjustments_log(integer, integer, date, date, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_batches_list(text, text, text, integer, integer, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_expiry_buckets() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_overview_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_purchase(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_off_expired_batch(uuid, text) TO authenticated, service_role;

-- Intentionally keep these blocked from authenticated if they are trigger/internal functions:
REVOKE EXECUTE ON FUNCTION public.can_view_cost() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.capture_trash_bin_event() FROM authenticated;

-- Final verification: any remaining anon/PUBLIC execute privileges on public functions is a failure.
SELECT
  p.oid::regprocedure AS function_name,
  has_function_privilege('anon', p.oid::regprocedure, 'EXECUTE') AS anon_execute,
  EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
    WHERE acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute,
  has_function_privilege('authenticated', p.oid::regprocedure, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.prorettype <> 'trigger'::regtype
  AND (
    has_function_privilege('anon', p.oid::regprocedure, 'EXECUTE')
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    )
    OR (
      p.oid NOT IN (
        'public.can_view_cost()'::regprocedure,
        'public.manage_users_team_member_access(uuid,uuid,text)'::regprocedure
      )
      AND NOT has_function_privilege('authenticated', p.oid::regprocedure, 'EXECUTE')
    )
  )
ORDER BY 1;

-- Success looks like: zero rows returned.
