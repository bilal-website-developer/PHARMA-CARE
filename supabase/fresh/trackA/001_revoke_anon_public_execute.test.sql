-- Track A / A1 read-only validation
-- This must be run after the 001 lock-down and before moving on.

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
