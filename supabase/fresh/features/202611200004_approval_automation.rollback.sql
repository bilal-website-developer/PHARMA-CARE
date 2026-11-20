-- Owner-run rollback. Disables both automations and restores the original S5 print/return RPCs.
-- Added columns are retained to preserve automation/idempotency audit metadata.
BEGIN;

UPDATE public.shop_settings
SET auto_approve_print_requests = false,
    auto_process_returns = false;

DO $rollback$
DECLARE
  v_print_definition text;
  v_updated_print_definition text;
  v_request_definition text;
  v_updated_request_definition text;
  v_process_definition text;
  v_updated_process_definition text;
  v_request_declaration text := E'  v_requested_count integer;\n  v_auto_process boolean := false;\n  v_auto_decisions jsonb;\n  v_result jsonb;';
  v_old_request_declaration text := '  v_requested_count integer;';
  v_new_print_return text := '  return (to_jsonb(v_request) - ''shop_id'') || jsonb_build_object(''reused'', v_reused);';
  v_old_print_return text := '  return to_jsonb(v_request) - ''shop_id'';';
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
  v_old_request_return text := '  return jsonb_build_object(''id'', v_return_id, ''status'', ''PENDING'', ''invoiceNumber'', v_invoice);';
  v_process_declaration text := E'  v_processed_count integer := 0;\n  v_is_auto boolean := false;';
  v_old_process_declaration text := '  v_processed_count integer := 0;';
  v_new_process_authorization text := $new_auth$
  if auth.uid() is null or v_shop_id is null or v_actor.id is null then
    raise exception 'An active shop user is required to process returns';
  end if;
$new_auth$;
  v_old_process_authorization text := $old_auth$
  if auth.uid() is null or v_shop_id is null or v_actor.id is null or v_actor.role not in ('manager', 'admin')
     or not public.has_any_permission(array['sales_history']::text[]) then
    raise exception 'Only a Manager or Admin with Sales History access may process returns';
  end if;
$old_auth$;
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
  v_old_return_lock text := $old_lock$
  select * into v_return from public.sale_returns
  where id = p_return_id and shop_id = v_shop_id for update;
  if not found or v_return.status <> 'PENDING' then
    raise exception 'Return request is missing or has already been processed';
  end if;
$old_lock$;
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
  v_old_disposition text := '    v_restock_unit := nullif(v_decision->>''restockUnitId'', '''')::uuid;';
  v_new_approval text := '      approved_by = CASE WHEN v_is_auto THEN NULL ELSE auth.uid() END,' || E'\n      auto_processed = v_is_auto,';
  v_old_approval text := '      approved_by = auth.uid(),';
  v_new_audit_action text := '    v_shop_id, auth.uid(), CASE WHEN v_is_auto THEN ''SALE_RETURN_AUTO_PROCESSED'' ELSE ''SALE_RETURN_PROCESSED'' END, ''sale_return'', p_return_id,';
  v_old_audit_action text := '    v_shop_id, auth.uid(), ''SALE_RETURN_PROCESSED'', ''sale_return'', p_return_id,';
  v_new_audit_count text := '      ''item_count'', v_processed_count,' || E'\n      ''auto_processed'', v_is_auto';
  v_old_audit_count text := '      ''item_count'', v_processed_count';
BEGIN
  IF to_regprocedure('public.request_sale_return(uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.process_sale_return(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.request_print(text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'A required print or return RPC is missing; inspect before rollback.';
  END IF;

  v_print_definition := pg_catalog.pg_get_functiondef(
    'public.request_print(text,text,jsonb)'::regprocedure
  );
  v_request_definition := pg_catalog.pg_get_functiondef(
    'public.request_sale_return(uuid,text,jsonb)'::regprocedure
  );
  v_process_definition := pg_catalog.pg_get_functiondef(
    'public.process_sale_return(uuid,jsonb)'::regprocedure
  );
  IF position(v_new_print_return IN v_print_definition) = 0
     OR position(v_old_print_return IN v_print_definition) > 0
     OR position(v_request_declaration IN v_request_definition) = 0
     OR position(v_new_request_return IN v_request_definition) = 0
     OR position(v_process_declaration IN v_process_definition) = 0
     OR position(v_new_process_authorization IN v_process_definition) = 0
     OR position(v_new_return_lock IN v_process_definition) = 0
     OR position(v_new_disposition IN v_process_definition) = 0
     OR position(v_new_approval IN v_process_definition) = 0
     OR position(v_new_audit_action IN v_process_definition) = 0
     OR position(v_new_audit_count IN v_process_definition) = 0 THEN
    RAISE EXCEPTION 'Return RPCs do not match the reviewed automation patch; no rollback functions were changed.';
  END IF;

  v_updated_process_definition := replace(v_process_definition, v_process_declaration, v_old_process_declaration);
  v_updated_process_definition := replace(v_updated_process_definition, v_new_process_authorization, v_old_process_authorization);
  v_updated_process_definition := replace(v_updated_process_definition, v_new_return_lock, v_old_return_lock);
  v_updated_process_definition := replace(v_updated_process_definition, v_new_disposition, v_old_disposition);
  v_updated_process_definition := replace(v_updated_process_definition, v_new_approval, v_old_approval);
  v_updated_process_definition := replace(v_updated_process_definition, v_new_audit_action, v_old_audit_action);
  v_updated_process_definition := replace(v_updated_process_definition, v_new_audit_count, v_old_audit_count);

  v_updated_request_definition := replace(v_request_definition, v_request_declaration, v_old_request_declaration);
  v_updated_request_definition := replace(v_updated_request_definition, v_new_request_return, v_old_request_return);
  v_updated_print_definition := replace(v_print_definition, v_new_print_return, v_old_print_return);

  EXECUTE v_updated_process_definition;
  EXECUTE v_updated_request_definition;
  EXECUTE v_updated_print_definition;
END
$rollback$;

DROP FUNCTION public.mark_auto_approved_print_request_opened(uuid);
DROP FUNCTION public.claim_auto_approved_print_request(uuid);
DROP FUNCTION public.request_print_v2(text, text, jsonb, uuid);
DROP FUNCTION public.update_approval_automation_settings(boolean, boolean);
DROP FUNCTION public.get_approval_automation_settings();
DROP INDEX public.print_requests_shop_request_key_key;

COMMIT;
