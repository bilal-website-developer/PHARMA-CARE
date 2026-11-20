-- Owner-run feature patch. Apply after S5 print/return RPCs and S6 shop settings.
-- Adds Admin-controlled per-shop automation; no SQL is run by the application.
BEGIN;

DO $preflight$
DECLARE
  v_print_index text;
BEGIN
  IF to_regclass('public.shop_settings') IS NULL
     OR to_regclass('public.print_requests') IS NULL
     OR to_regclass('public.sale_returns') IS NULL
     OR to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.request_print(text,text,jsonb)') IS NULL
     OR to_regprocedure('public.request_sale_return(uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.process_sale_return(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.mark_printed_request(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required S5/S6 tables or RPCs are missing; inspect the deployed schema before applying.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'shop_settings' AND column_name IN ('auto_approve_print_requests', 'auto_process_returns'))
        OR (table_name = 'print_requests' AND column_name IN ('request_key', 'auto_approved', 'auto_print_started_at'))
        OR (table_name = 'sale_returns' AND column_name = 'auto_processed')
      )
  ) THEN
    RAISE EXCEPTION 'An approval automation column already exists; inspect partial applies before continuing.';
  END IF;

  SELECT pg_catalog.pg_get_indexdef(index_info.indexrelid)
  INTO v_print_index
  FROM pg_catalog.pg_index AS index_info
  WHERE index_info.indexrelid = to_regclass('public.print_requests_one_pending_per_shop_receipt')
    AND index_info.indrelid = 'public.print_requests'::regclass
    AND index_info.indisunique;
  IF v_print_index IS NULL
     OR position('(shop_id, type, receipt_ref)' IN v_print_index) = 0 THEN
    RAISE EXCEPTION 'Expected shop-scoped pending print uniqueness is missing; inspect print request indexes.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sale_returns'
      AND column_name = 'approved_by'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'sale_returns.approved_by must be nullable so automated processing is not attributed to a staff approver.';
  END IF;
END
$preflight$;

ALTER TABLE public.shop_settings
  ADD COLUMN auto_approve_print_requests boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_process_returns boolean NOT NULL DEFAULT false;

ALTER TABLE public.print_requests
  ADD COLUMN request_key uuid,
  ADD COLUMN auto_approved boolean NOT NULL DEFAULT false
    CHECK (NOT auto_approved OR status = 'approved'),
  ADD COLUMN auto_print_started_at timestamptz;

ALTER TABLE public.sale_returns
  ADD COLUMN auto_processed boolean NOT NULL DEFAULT false
    CHECK (NOT auto_processed OR status = 'COMPLETED');

CREATE UNIQUE INDEX print_requests_shop_request_key_key
  ON public.print_requests (shop_id, request_key)
  WHERE request_key IS NOT NULL;

COMMENT ON COLUMN public.shop_settings.auto_approve_print_requests
  IS 'When enabled, staff print requests are auto-approved and printed from the requester browser dialog.';
COMMENT ON COLUMN public.shop_settings.auto_process_returns
  IS 'When enabled, newly submitted returns are refunded/credited and quarantined, never auto-restocked.';
COMMENT ON COLUMN public.print_requests.request_key
  IS 'Client-generated idempotency key for one staff print request action.';
COMMENT ON COLUMN public.print_requests.auto_approved
  IS 'True when the shop approval setting, rather than a human Admin, approved this request.';
COMMENT ON COLUMN public.print_requests.auto_print_started_at
  IS 'Claim that prevents the same auto-approved request from opening multiple print dialogs.';
COMMENT ON COLUMN public.sale_returns.auto_processed
  IS 'True when the shop setting automatically processed the request to quarantine.';

CREATE FUNCTION public.get_approval_automation_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_permissions text[];
  v_settings public.shop_settings%rowtype;
BEGIN
  SELECT profile.permissions
  INTO v_permissions
  FROM public.profiles AS profile
  WHERE profile.id = v_actor
    AND profile.shop_id = v_shop_id
    AND profile.role = 'admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL;
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT FOUND
     OR NOT (coalesce(v_permissions, ARRAY[]::text[]) @> ARRAY['settings', 'settings_operations']::text[]) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Shop Admin Operational Settings access is required.';
  END IF;

  SELECT * INTO v_settings
  FROM public.shop_settings AS settings
  WHERE settings.shop_id = v_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop settings are not initialized.';
  END IF;

  RETURN jsonb_build_object(
    'autoApprovePrintRequests', v_settings.auto_approve_print_requests,
    'autoProcessReturns', v_settings.auto_process_returns
  );
END
$function$;

CREATE FUNCTION public.update_approval_automation_settings(
  p_auto_approve_print_requests boolean,
  p_auto_process_returns boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_permissions text[];
  v_before public.shop_settings%rowtype;
  v_after public.shop_settings%rowtype;
BEGIN
  SELECT profile.permissions
  INTO v_permissions
  FROM public.profiles AS profile
  WHERE profile.id = v_actor
    AND profile.shop_id = v_shop_id
    AND profile.role = 'admin'
    AND profile.is_active
    AND profile.deleted_at IS NULL
  FOR UPDATE;
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT FOUND
     OR NOT (coalesce(v_permissions, ARRAY[]::text[]) @> ARRAY['settings', 'settings_operations']::text[]) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Shop Admin Operational Settings access is required.';
  END IF;
  IF p_auto_approve_print_requests IS NULL OR p_auto_process_returns IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Both automation settings must be explicit true/false values.';
  END IF;

  SELECT * INTO v_before
  FROM public.shop_settings AS settings
  WHERE settings.shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop settings are not initialized.';
  END IF;

  UPDATE public.shop_settings AS settings
  SET auto_approve_print_requests = p_auto_approve_print_requests,
      auto_process_returns = p_auto_process_returns
  WHERE settings.shop_id = v_shop_id
  RETURNING * INTO v_after;

  INSERT INTO public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  VALUES (
    v_shop_id,
    v_actor,
    'approval_automation_settings_updated',
    'shop_settings',
    v_shop_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'autoApprovePrintRequests', v_before.auto_approve_print_requests,
        'autoProcessReturns', v_before.auto_process_returns
      ),
      'after', jsonb_build_object(
        'autoApprovePrintRequests', v_after.auto_approve_print_requests,
        'autoProcessReturns', v_after.auto_process_returns
      )
    )
  );

  RETURN jsonb_build_object(
    'autoApprovePrintRequests', v_after.auto_approve_print_requests,
    'autoProcessReturns', v_after.auto_process_returns
  );
END
$function$;

CREATE FUNCTION public.request_print_v2(
  p_type text,
  p_receipt_ref text,
  p_payload jsonb,
  p_request_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_request public.print_requests%rowtype;
  v_request_json jsonb;
  v_auto_approve boolean := false;
  v_claimed boolean := false;
  v_created boolean := false;
BEGIN
  IF v_actor IS NULL OR v_shop_id IS NULL OR p_request_key IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'An authenticated shop user and request key are required.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_shop_id::text || ':' || p_request_key::text, 0)
  );

  SELECT * INTO v_request
  FROM public.print_requests AS request
  WHERE request.shop_id = v_shop_id
    AND request.request_key = p_request_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_request.requested_by <> v_actor
       OR v_request.type <> p_type
       OR v_request.receipt_ref <> btrim(p_receipt_ref)
       OR v_request.payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'Print request key was already used for a different request.';
    END IF;
    v_claimed := true;
  ELSE
    v_request_json := public.request_print(p_type, p_receipt_ref, p_payload);
    IF coalesce((v_request_json->>'reused_by_other')::boolean, false) THEN
      RAISE EXCEPTION 'A request for this receipt is already pending under another requester.';
    END IF;
    v_created := NOT coalesce((v_request_json->>'reused')::boolean, false);
    SELECT * INTO v_request
    FROM public.print_requests AS request
    WHERE request.id = nullif(v_request_json->>'id', '')::uuid
      AND request.shop_id = v_shop_id
    FOR UPDATE;
    IF NOT FOUND OR v_request.requested_by <> v_actor THEN
      RAISE EXCEPTION 'The print request could not be safely associated with this requester.';
    END IF;

    IF v_created THEN
      UPDATE public.print_requests AS request
      SET request_key = p_request_key
      WHERE request.id = v_request.id
        AND request.shop_id = v_shop_id
        AND request.request_key IS NULL
      RETURNING * INTO v_request;
      v_claimed := FOUND;
      IF NOT v_claimed THEN
        SELECT * INTO v_request
        FROM public.print_requests AS request
        WHERE request.id = nullif(v_request_json->>'id', '')::uuid
          AND request.shop_id = v_shop_id
        FOR UPDATE;
      END IF;
    ELSE
      v_claimed := false;
    END IF;
  END IF;

  v_auto_approve := coalesce((
    SELECT settings.auto_approve_print_requests
    FROM public.shop_settings AS settings
    WHERE settings.shop_id = v_shop_id
  ), false);
  IF v_created AND v_auto_approve AND v_request.status = 'pending' THEN
    UPDATE public.print_requests AS request
    SET status = 'approved',
        decided_by = NULL,
        decided_at = now(),
        auto_approved = true
    WHERE request.id = v_request.id
      AND request.shop_id = v_shop_id
      AND request.status = 'pending'
    RETURNING * INTO v_request;
    IF FOUND THEN
      INSERT INTO public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
      VALUES (
        v_shop_id,
        v_actor,
        'print_request_auto_approved',
        'print_request',
        v_request.id,
        jsonb_build_object('type', v_request.type, 'receipt_ref', v_request.receipt_ref)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'requestId', v_request.id,
    'type', v_request.type,
    'receiptRef', v_request.receipt_ref,
    'status', v_request.status,
    'payload', v_request.payload,
    'autoApproved', v_request.auto_approved,
    'shouldPrint', v_claimed
      AND v_request.auto_approved
      AND v_request.status = 'approved'
      AND v_request.auto_print_started_at IS NULL
      AND v_request.printed_at IS NULL,
    'alreadyPrinted', v_request.printed_at IS NOT NULL
  );
END
$function$;

DO $patch_request_print_response$
DECLARE
  v_definition text;
  v_updated_definition text;
  v_old_return text := '  return to_jsonb(v_request) - ''shop_id'';';
  v_new_return text := '  return (to_jsonb(v_request) - ''shop_id'') || jsonb_build_object(''reused'', v_reused);';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.request_print(text,text,jsonb)'::regprocedure
  );
  IF position(v_old_return IN v_definition) = 0
     OR position(v_new_return IN v_definition) > 0 THEN
    RAISE EXCEPTION 'request_print response differs from the reviewed S5 implementation; no function was patched.';
  END IF;
  v_updated_definition := replace(v_definition, v_old_return, v_new_return);
  EXECUTE v_updated_definition;
END
$patch_request_print_response$;

CREATE FUNCTION public.claim_auto_approved_print_request(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
BEGIN
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = v_actor
      AND profile.shop_id = v_shop_id
      AND profile.is_active
      AND profile.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active shop user is required.';
  END IF;

  UPDATE public.print_requests AS request
  SET auto_print_started_at = now()
  WHERE request.id = p_request_id
    AND request.shop_id = v_shop_id
    AND request.requested_by = v_actor
    AND request.status = 'approved'
    AND request.auto_approved
    AND request.auto_print_started_at IS NULL
    AND request.printed_at IS NULL;
  RETURN FOUND;
END
$function$;

CREATE FUNCTION public.mark_auto_approved_print_request_opened(p_request_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_shop_id uuid := tenant_private.current_shop_id();
  v_request public.print_requests%rowtype;
BEGIN
  IF v_actor IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = v_actor
      AND profile.shop_id = v_shop_id
      AND profile.is_active
      AND profile.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'An active shop user is required.';
  END IF;

  SELECT * INTO v_request
  FROM public.print_requests AS request
  WHERE request.id = p_request_id
    AND request.shop_id = v_shop_id
    AND request.requested_by = v_actor
    AND request.status = 'approved'
    AND request.auto_approved
    AND request.auto_print_started_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the requester can record an opened auto-approved print dialog.';
  END IF;
  IF v_request.printed_at IS NOT NULL THEN
    RETURN v_request.printed_at;
  END IF;

  UPDATE public.print_requests AS request
  SET printed_at = now()
  WHERE request.id = p_request_id
    AND request.shop_id = v_shop_id
  RETURNING * INTO v_request;

  INSERT INTO public.audit_logs (shop_id, actor_id, action, entity, entity_id, details)
  VALUES (
    v_shop_id,
    v_actor,
    'auto_approved_print_dialog_opened',
    'print_request',
    v_request.id,
    jsonb_build_object('type', v_request.type, 'receipt_ref', v_request.receipt_ref)
  );
  RETURN v_request.printed_at;
END
$function$;

DO $patch_return_rpcs$
DECLARE
  v_request_definition text;
  v_updated_request_definition text;
  v_process_definition text;
  v_updated_process_definition text;
  v_request_declaration text := '  v_requested_count integer;';
  v_new_request_declaration text := E'  v_requested_count integer;\n  v_auto_process boolean := false;\n  v_auto_decisions jsonb;\n  v_result jsonb;';
  v_old_request_return text := '  return jsonb_build_object(''id'', v_return_id, ''status'', ''PENDING'', ''invoiceNumber'', v_invoice);';
  v_new_request_return text := $request_return$
  v_auto_process := coalesce((
    SELECT settings.auto_process_returns
    FROM public.shop_settings AS settings
    WHERE settings.shop_id = v_shop_id
  ), false);
  IF v_auto_process THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', return_item.id,
      'disposition', 'QUARANTINE',
      'sealedIntact', false,
      'restockUnitId', NULL,
      'reason', btrim(p_reason)
    ) ORDER BY return_item.id), '[]'::jsonb)
    INTO v_auto_decisions
    FROM public.sale_return_items AS return_item
    WHERE return_item.return_id = v_return_id
      AND return_item.shop_id = v_shop_id;
    PERFORM pg_catalog.set_config('app.auto_process_return_id', v_return_id::text, true);
    v_result := public.process_sale_return(v_return_id, v_auto_decisions);
    RETURN v_result || jsonb_build_object('autoProcessed', true);
  END IF;
  RETURN jsonb_build_object('id', v_return_id, 'status', 'PENDING', 'invoiceNumber', v_invoice);
$request_return$;
  v_process_declaration text := '  v_processed_count integer := 0;';
  v_new_process_declaration text := E'  v_processed_count integer := 0;\n  v_is_auto boolean := false;';
  v_old_process_authorization text := $old_auth$
  if auth.uid() is null or v_shop_id is null or v_actor.id is null or v_actor.role not in ('manager', 'admin')
     or not public.has_any_permission(array['sales_history']::text[]) then
    raise exception 'Only a Manager or Admin with Sales History access may process returns';
  end if;
$old_auth$;
  v_new_process_authorization text := $new_auth$
  if auth.uid() is null or v_shop_id is null or v_actor.id is null then
    raise exception 'An active shop user is required to process returns';
  end if;
$new_auth$;
  v_old_return_lock text := $old_lock$
  select * into v_return from public.sale_returns
  where id = p_return_id and shop_id = v_shop_id for update;
  if not found or v_return.status <> 'PENDING' then
    raise exception 'Return request is missing or has already been processed';
  end if;
$old_lock$;
  v_new_return_lock text := $new_lock$
  select * into v_return from public.sale_returns
  where id = p_return_id and shop_id = v_shop_id for update;
  if not found or v_return.status <> 'PENDING' then
    raise exception 'Return request is missing or has already been processed';
  end if;
  v_is_auto := v_return.requested_by = auth.uid()
    and current_setting('app.auto_process_return_id', true) = p_return_id::text
    and public.has_any_permission(array['pos']::text[])
    and exists (
      select 1
      from public.shop_settings as settings
      where settings.shop_id = v_shop_id
        and settings.auto_process_returns
    );
  if not (
    (v_actor.role in ('manager', 'admin')
      and public.has_any_permission(array['sales_history']::text[]))
    or v_is_auto
  ) then
    raise exception 'Only a Manager or Admin with Sales History access may process returns';
  end if;
$new_lock$;
  v_old_disposition text := '    v_restock_unit := nullif(v_decision->>''restockUnitId'', '''')::uuid;';
  v_new_disposition text := $new_disposition$
    v_restock_unit := nullif(v_decision->>'restockUnitId', '')::uuid;
    if v_is_auto and (
      v_disposition is distinct from 'QUARANTINE'
      or v_sealed
      or v_restock_unit is not null
    ) then
      raise exception 'Automatic returns must be quarantined and cannot be marked sealed for restock';
    end if;
$new_disposition$;
  v_old_approval text := '      approved_by = auth.uid(),';
  v_new_approval text := '      approved_by = CASE WHEN v_is_auto THEN NULL ELSE auth.uid() END,' || E'\n      auto_processed = v_is_auto,';
  v_old_audit_action text := '    v_shop_id, auth.uid(), ''SALE_RETURN_PROCESSED'', ''sale_return'', p_return_id,';
  v_new_audit_action text := '    v_shop_id, auth.uid(), CASE WHEN v_is_auto THEN ''SALE_RETURN_AUTO_PROCESSED'' ELSE ''SALE_RETURN_PROCESSED'' END, ''sale_return'', p_return_id,';
  v_old_audit_count text := '      ''item_count'', v_processed_count';
  v_new_audit_count text := '      ''item_count'', v_processed_count,' || E'\n      ''auto_processed'', v_is_auto';
BEGIN
  v_request_definition := pg_catalog.pg_get_functiondef(
    'public.request_sale_return(uuid,text,jsonb)'::regprocedure
  );
  v_process_definition := pg_catalog.pg_get_functiondef(
    'public.process_sale_return(uuid,jsonb)'::regprocedure
  );

  IF position(v_request_declaration IN v_request_definition) = 0
     OR position(v_old_request_return IN v_request_definition) = 0
     OR position(v_process_declaration IN v_process_definition) = 0
     OR position(v_old_process_authorization IN v_process_definition) = 0
     OR position(v_old_return_lock IN v_process_definition) = 0
     OR position(v_old_disposition IN v_process_definition) = 0
     OR position(v_old_approval IN v_process_definition) = 0
     OR position(v_old_audit_action IN v_process_definition) = 0
     OR position(v_old_audit_count IN v_process_definition) = 0 THEN
    RAISE EXCEPTION 'A return RPC differs from the reviewed S5 implementation; no functions were patched.';
  END IF;

  v_updated_process_definition := replace(v_process_definition, v_process_declaration, v_new_process_declaration);
  v_updated_process_definition := replace(v_updated_process_definition, v_old_process_authorization, v_new_process_authorization);
  v_updated_process_definition := replace(v_updated_process_definition, v_old_return_lock, v_new_return_lock);
  v_updated_process_definition := replace(v_updated_process_definition, v_old_disposition, v_new_disposition);
  v_updated_process_definition := replace(v_updated_process_definition, v_old_approval, v_new_approval);
  v_updated_process_definition := replace(v_updated_process_definition, v_old_audit_action, v_new_audit_action);
  v_updated_process_definition := replace(v_updated_process_definition, v_old_audit_count, v_new_audit_count);

  v_updated_request_definition := replace(v_request_definition, v_request_declaration, v_new_request_declaration);
  v_updated_request_definition := replace(v_updated_request_definition, v_old_request_return, v_new_request_return);

  EXECUTE v_updated_process_definition;
  EXECUTE v_updated_request_definition;
END
$patch_return_rpcs$;

REVOKE ALL ON FUNCTION public.get_approval_automation_settings() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_approval_automation_settings(boolean, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.request_print_v2(text, text, jsonb, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.claim_auto_approved_print_request(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.mark_auto_approved_print_request_opened(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_approval_automation_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_approval_automation_settings(boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_print_v2(text, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auto_approved_print_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_auto_approved_print_request_opened(uuid) TO authenticated;

COMMIT;
