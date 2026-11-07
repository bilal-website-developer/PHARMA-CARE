-- Track A / A1 read-only validation
-- This must be run after the 001 lock-down and before moving on.

SELECT
  p.oid::regprocedure AS function_name,
  has_function_privilege('anon', p.oid::regprocedure, 'EXECUTE') AS anon_execute,
  has_function_privilege('public', p.oid::regprocedure, 'EXECUTE') AS public_execute,
  has_function_privilege('authenticated', p.oid::regprocedure, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND (
    has_function_privilege('anon', p.oid::regprocedure, 'EXECUTE')
    OR has_function_privilege('public', p.oid::regprocedure, 'EXECUTE')
    OR (
      p.proname NOT IN ('can_view_cost', 'capture_trash_bin_event')
      AND NOT has_function_privilege('authenticated', p.oid::regprocedure, 'EXECUTE')
    )
  )
ORDER BY 1;

-- Success looks like: zero rows returned.
