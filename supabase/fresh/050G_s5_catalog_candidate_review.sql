-- Read-only review of public SECURITY DEFINER routines that 050D could not
-- recognize as shop-scoped. Returns function metadata/definitions only; no business data.
-- One JSON result cell. Marker matches are triage signals, not proof of safety.
WITH catalog_routines AS (
  SELECT
    routine.oid,
    routine.proname AS routine_name,
    pg_catalog.pg_get_function_identity_arguments(routine.oid) AS identity_arguments,
    pg_catalog.pg_get_function_result(routine.oid) AS result_type,
    routine.proowner AS owner_oid,
    pg_catalog.pg_get_userbyid(routine.proowner) AS function_owner,
    routine.proconfig AS function_settings,
    routine.proacl AS function_acl,
    CASE WHEN to_regrole('anon') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('anon'), routine.oid, 'EXECUTE')
    END AS anon_can_execute,
    CASE WHEN to_regrole('authenticated') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('authenticated'), routine.oid, 'EXECUTE')
    END AS authenticated_can_execute,
    CASE WHEN to_regrole('service_role') IS NULL THEN NULL
      ELSE has_function_privilege(to_regrole('service_role'), routine.oid, 'EXECUTE')
    END AS service_role_can_execute,
    EXISTS (
      SELECT 1
      FROM aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) privilege
      WHERE privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) AS public_can_execute,
    lower(pg_catalog.pg_get_functiondef(routine.oid)) AS definition_lower,
    pg_catalog.pg_get_functiondef(routine.oid) AS function_definition
  FROM pg_catalog.pg_proc routine
  JOIN pg_catalog.pg_namespace routine_schema
    ON routine_schema.oid = routine.pronamespace
  WHERE routine_schema.nspname = 'public'
    AND routine.prokind = 'f'
    AND routine.prosecdef
),
other_routines AS (
  SELECT *
  FROM catalog_routines
  WHERE routine_name NOT IN (
    'post_purchase', 'purchase_catalog', 'purchase_history', 'purchase_detail', 'void_purchase',
    'request_print', 'decide_print_request', 'pending_print_count', 'mark_printed_request',
    'list_print_requests', 'modify_print_request',
    'capture_trash_bin_event', 'trash_bin_events_list', 'restore_trash_supplier',
    'restore_trash_medicine', 'trash_bin_permanently_delete', 'trash_bin_finalize_profile_purge',
    'stock_alerts_summary', 'stock_alerts_list'
  )
),
scope_candidates AS (
  SELECT *
  FROM other_routines
  WHERE position('tenant_private.current_shop_id()' IN definition_lower) = 0
    AND position('tenant_private.is_current_shop(' IN definition_lower) = 0
    AND position('shop_id' IN definition_lower) = 0
)
SELECT jsonb_build_object(
  'candidate_count', (SELECT count(*)::bigint FROM scope_candidates),
  'candidates', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'routine_name', routine_name,
      'identity_arguments', identity_arguments,
      'result_type', result_type,
      'function_owner', function_owner,
      'function_settings', function_settings,
      'function_acl', function_acl,
      'anon_can_execute', anon_can_execute,
      'authenticated_can_execute', authenticated_can_execute,
      'service_role_can_execute', service_role_can_execute,
      'public_can_execute', public_can_execute,
      'function_definition', function_definition
    ) ORDER BY routine_name, identity_arguments)
    FROM scope_candidates
  ), '[]'::jsonb)
) AS s5_catalog_candidate_review;
