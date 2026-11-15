-- Self-rolling-back runtime checks for the remaining S5 package.
-- Requires an active Shop Admin with purchases, purchase_history, products,
-- stock_inventory, and pos permissions; a second same-shop Admin; and a non-admin
-- POS profile without direct sale-print permission. The test temporarily assigns
-- both Admin profiles to a synthetic shop. Profile rows remain locked until
-- ROLLBACK; clear JWT claims before reassignment so profiles_assign_shop_id
-- preserves the explicit shop_id.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $test$
DECLARE
  v_actor uuid;
  v_other_admin uuid;
  v_print_actor uuid;
  v_shop uuid;
  v_other_shop uuid;
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_own_supplier uuid;
  v_other_supplier uuid;
  v_restore_supplier uuid;
  v_other_restore_supplier uuid;
  v_own_medicine uuid;
  v_other_medicine uuid;
  v_restore_medicine uuid;
  v_delete_medicine uuid;
  v_other_restore_medicine uuid;
  v_events jsonb;
  v_own_unit uuid;
  v_other_unit uuid;
  v_own_purchase jsonb;
  v_other_purchase jsonb;
  v_result jsonb;
  v_regression jsonb;
  v_history jsonb;
  v_catalog jsonb;
  v_alerts jsonb;
  v_prints jsonb;
  v_request jsonb;
  v_print_id uuid;
  v_modify_id uuid;
  v_other_print_id uuid;
  v_event_id uuid;
  v_error text;
  v_number text;
  v_signature text;
  v_function record;
  v_receipt jsonb;
  v_item jsonb;
  v_signatures text[] := ARRAY[
    'public.post_purchase(uuid,text,date,integer,text,jsonb,integer,text)',
    'public.purchase_catalog()',
    'public.purchase_history(text,text,date,date,integer,integer,boolean)',
    'public.purchase_detail(uuid)',
    'public.void_purchase(uuid,text)',
    'public.request_print(text,text,jsonb)',
    'public.decide_print_request(uuid,text,text)',
    'public.pending_print_count()',
    'public.mark_printed_request(uuid)',
    'public.list_print_requests()',
    'public.modify_print_request(uuid,jsonb,bigint)',
    'public.trash_bin_events_list()',
    'public.restore_trash_supplier(uuid)',
    'public.restore_trash_medicine(uuid)',
    'public.trash_bin_permanently_delete(uuid)',
    'public.stock_alerts_summary(integer)'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this smoke test as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regprocedure('public.trash_bin_finalize_profile_purge(uuid,uuid,uuid)') IS NULL
     OR NOT has_function_privilege('service_role', to_regprocedure('public.trash_bin_finalize_profile_purge(uuid,uuid,uuid)'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.trash_bin_finalize_profile_purge(uuid,uuid,uuid)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'The service-only profile-purge routine/grant changed.';
  END IF;
  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Required S5 routine % is missing.', v_signature;
    END IF;
    SELECT p.* INTO v_function FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(v_signature);
    IF NOT v_function.prosecdef
       OR position('tenant_private.current_shop_id()' IN lower(pg_catalog.pg_get_functiondef(v_function.oid))) = 0
       OR has_function_privilege('anon', v_function.oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM aclexplode(coalesce(v_function.proacl, acldefault('f', v_function.proowner))) a
         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
       )
       OR NOT has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Routine % has unexpected security, scope, or grants.', v_signature;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT p.id, p.shop_id INTO v_actor, v_shop
  FROM public.profiles p
  WHERE p.role = 'admin' AND p.is_active AND p.deleted_at IS NULL AND p.shop_id IS NOT NULL
    AND coalesce(p.permissions,'{}'::text[]) @> ARRAY[
      'purchases','purchase_history','products','stock_inventory','pos'
    ]::text[]
  ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_other_admin
  FROM public.profiles p
  WHERE p.role = 'admin' AND p.is_active AND p.deleted_at IS NULL
    AND p.shop_id = v_shop AND p.id <> v_actor
  ORDER BY p.id LIMIT 1;
  IF v_actor IS NULL OR v_other_admin IS NULL THEN
    RAISE EXCEPTION 'An active Shop Admin with purchases, purchase_history, products, stock_inventory, and pos permissions plus a second active same-shop Admin are required.';
  END IF;
  SELECT p.id INTO v_print_actor
  FROM public.profiles p
  WHERE p.shop_id = v_shop AND p.is_active AND p.deleted_at IS NULL
    AND p.role IN ('cashier','manager')
    AND coalesce(p.permissions,'{}'::text[]) @> ARRAY['pos']::text[]
    AND NOT coalesce(p.permissions,'{}'::text[]) @> ARRAY['pos_print_sale']::text[]
  ORDER BY p.id LIMIT 1;
  IF v_print_actor IS NULL THEN
    RAISE EXCEPTION 'An active non-admin POS profile without direct sale-print permission is required for request_print().';
  END IF;

  INSERT INTO public.shops(name) VALUES ('S5 remaining smoke ' || v_token)
  RETURNING id INTO v_other_shop;
  UPDATE public.profiles SET shop_id = v_other_shop WHERE id = v_other_admin;
  IF (SELECT shop_id FROM public.profiles WHERE id = v_other_admin) IS DISTINCT FROM v_other_shop THEN
    RAISE EXCEPTION 'Temporary Admin reassignment did not preserve the synthetic shop.';
  END IF;

  INSERT INTO public.suppliers(shop_id,name,contact,address,licence_or_tax_number,payment_terms,is_active)
  VALUES (v_shop,'S5 own supplier '||v_token,'','', '', 'cash', true)
  RETURNING id INTO v_own_supplier;
  INSERT INTO public.suppliers(shop_id,name,contact,address,licence_or_tax_number,payment_terms,is_active)
  VALUES (v_other_shop,'S5 foreign supplier '||v_token,'','', '', 'cash', true)
  RETURNING id INTO v_other_supplier;

  INSERT INTO public.medicines(
    shop_id,code,brand_name,generic_name,strength,category,company,drug_class,min_stock_alert,is_active
  ) VALUES (v_shop,'S5R-A-'||v_token,'S5 own medicine '||v_token,'Synthetic','1 mg','S5','S5','OTC',1,true)
  RETURNING id INTO v_own_medicine;
  INSERT INTO public.medicines(
    shop_id,code,brand_name,generic_name,strength,category,company,drug_class,min_stock_alert,is_active
  ) VALUES (v_other_shop,'S5R-X-'||v_token,'S5 foreign medicine '||v_token,'Synthetic','1 mg','S5','S5','OTC',1,true);
  SELECT id INTO v_other_medicine FROM public.medicines WHERE code='S5R-X-'||v_token;
  INSERT INTO public.medicine_units(
    shop_id,medicine_id,name,conversion_factor,is_default_sale_unit,price_paisa,sale_price_paisa
  ) VALUES (v_shop,v_own_medicine,'S5 own unit '||v_token,1,true,200,200)
  RETURNING id INTO v_own_unit;
  INSERT INTO public.medicine_units(
    shop_id,medicine_id,name,conversion_factor,is_default_sale_unit,price_paisa,sale_price_paisa
  ) VALUES (v_other_shop,v_other_medicine,'S5 foreign unit '||v_token,1,true,200,200)
  RETURNING id INTO v_other_unit;

  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor::text,'role','authenticated')::text,true);
  IF tenant_private.current_shop_id() IS DISTINCT FROM v_shop THEN
    RAISE EXCEPTION 'Shop Admin did not resolve to the assigned shop.';
  END IF;
  v_item := jsonb_build_array(jsonb_build_object(
    'medicine_id',v_own_medicine,'unit_id',v_own_unit,'batch_number','S5R-A-'||v_token,
    'expiry_date',(current_date+180)::text,'quantity',1,'bonus_qty',0,
    'unit_cost_paisa',100,'mrp_paisa',200
  ));
  v_own_purchase := public.post_purchase(v_own_supplier,'S5R-A-'||v_token,current_date,0,'S5 smoke',v_item,0,'cash');
  v_number := v_own_purchase->>'pr_no';
  IF v_number IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.purchases WHERE id=(v_own_purchase->>'id')::uuid AND shop_id=v_shop
      AND pr_no=v_number
  ) THEN RAISE EXCEPTION 'Same-shop purchase did not post.'; END IF;

  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  UPDATE public.profiles SET shop_id=v_other_shop WHERE id=v_actor;
  IF (SELECT shop_id FROM public.profiles WHERE id=v_actor) IS DISTINCT FROM v_other_shop THEN
    RAISE EXCEPTION 'Temporary Admin reassignment did not preserve the synthetic shop.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor::text,'role','authenticated')::text,true);
  v_item := jsonb_build_array(jsonb_build_object(
    'medicine_id',v_other_medicine,'unit_id',v_other_unit,'batch_number','S5R-X-'||v_token,
    'expiry_date',(current_date+180)::text,'quantity',1,'bonus_qty',0,
    'unit_cost_paisa',100,'mrp_paisa',200
  ));
  v_other_purchase := public.post_purchase(v_other_supplier,'S5R-X-'||v_token,current_date,0,'S5 smoke',v_item,0,'cash');
  IF v_other_purchase->>'pr_no' IS DISTINCT FROM v_number THEN
    RAISE EXCEPTION 'Purchase numbering is not isolated per shop: got % and %.',v_number,v_other_purchase->>'pr_no';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  UPDATE public.profiles SET shop_id=v_shop WHERE id=v_actor;
  IF (SELECT shop_id FROM public.profiles WHERE id=v_actor) IS DISTINCT FROM v_shop THEN
    RAISE EXCEPTION 'Shop Admin did not return to the original shop after the cross-shop purchase.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor::text,'role','authenticated')::text,true);
  v_result := public.purchase_catalog();
  IF position(v_own_medicine::text IN v_result::text)=0 OR position(v_other_medicine::text IN v_result::text)>0 THEN
    RAISE EXCEPTION 'purchase_catalog did not include same-shop medicine and exclude foreign medicine.';
  END IF;
  v_regression := public.products_list();
  IF position(v_own_medicine::text IN v_regression::text)=0 OR position(v_other_medicine::text IN v_regression::text)>0 THEN
    RAISE EXCEPTION 'Prior S5 regression: products_list shop scope changed.';
  END IF;
  PERFORM public.products_overview_stats();
  PERFORM public.stock_overview_stats();
  IF public.get_return_policy_settings() IS NULL THEN
    RAISE EXCEPTION 'Prior S5 regression: shop return policy is unavailable.';
  END IF;
  v_history := public.purchase_history(NULL,NULL,NULL,NULL,1,25,false);
  IF position((v_own_purchase->>'id') IN v_history::text)=0 OR position((v_other_purchase->>'id') IN v_history::text)>0 THEN
    RAISE EXCEPTION 'purchase_history is not shop-scoped.';
  END IF;
  v_result := public.purchase_detail((v_own_purchase->>'id')::uuid);
  IF v_result->>'id' IS DISTINCT FROM v_own_purchase->>'id' THEN RAISE EXCEPTION 'Same-shop purchase detail failed.'; END IF;
  v_error := NULL;
  BEGIN PERFORM public.purchase_detail((v_other_purchase->>'id')::uuid);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign purchase detail was not denied.'; END IF;
  v_error := NULL;
  BEGIN PERFORM public.post_purchase(v_other_supplier,'S5R-BAD-'||v_token,current_date,0,'S5 smoke',jsonb_build_array(jsonb_build_object(
    'medicine_id',v_own_medicine,'unit_id',v_own_unit,'batch_number','S5R-BAD-'||v_token,
    'expiry_date',(current_date+180)::text,'quantity',1,'bonus_qty',0,'unit_cost_paisa',100,'mrp_paisa',200
  )),0,'cash');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign supplier reference was accepted.'; END IF;
  v_error := NULL;
  BEGIN PERFORM public.post_purchase(v_own_supplier,'S5R-BAD2-'||v_token,current_date,0,'S5 smoke',jsonb_build_array(jsonb_build_object(
    'medicine_id',v_other_medicine,'unit_id',v_other_unit,'batch_number','S5R-BAD2-'||v_token,
    'expiry_date',(current_date+180)::text,'quantity',1,'bonus_qty',0,'unit_cost_paisa',100,'mrp_paisa',200
  )),0,'cash');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign product/unit reference was accepted.'; END IF;
  v_result := public.pos_catalog();
  IF position(v_own_medicine::text IN v_result::text)=0 OR position(v_other_medicine::text IN v_result::text)>0 THEN
    RAISE EXCEPTION 'Prior S5 regression: pos_catalog shop scope changed.';
  END IF;
  v_alerts := public.stock_alerts_summary(200);
  IF coalesce((v_alerts->>'low_count')::integer,0) < 1
     OR position(v_other_medicine::text IN v_alerts::text)>0 THEN
    RAISE EXCEPTION 'Stock-alert low count or foreign-shop exclusion failed.';
  END IF;
  PERFORM public.void_purchase((v_own_purchase->>'id')::uuid,'S5 smoke void');
  v_error := NULL;
  BEGIN PERFORM public.void_purchase((v_other_purchase->>'id')::uuid,'S5 foreign void');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign purchase was voided or exposed.'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_print_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_print_actor::text,'role','authenticated')::text,true);
  v_receipt := jsonb_build_object(
    'data',jsonb_build_object('kind','SALE','memoNo','S5R-PRINT-'||v_token,'dateTime','2026-01-01',
      'lines',jsonb_build_array(jsonb_build_object('qty',1,'name','S5 synthetic','ratePaisa',100)),
      'discountPaisa',0,'cashier','S5','role','cashier','terminal','S5'),
    'settings',jsonb_build_object('storeName','S5','address','','phone','','notes',jsonb_build_array('','',''),
      'terminalName','S5','showBatchExpiry',false,'roundNet','none','printTax',false,
      'duplicateLabel',false,'numberDigits',0),
    'format','thermal58','template','simple'
  );
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  INSERT INTO public.print_requests(shop_id,type,receipt_ref,payload,requested_by,status)
  VALUES(v_other_shop,'sale','S5R-PRINT-'||v_token,'{}'::jsonb,v_other_admin,'pending')
  RETURNING id INTO v_other_print_id;
  PERFORM set_config('request.jwt.claim.sub',v_print_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_print_actor::text,'role','authenticated')::text,true);
  v_request := public.request_print('sale','S5R-PRINT-'||v_token,v_receipt);
  v_print_id := (v_request->>'id')::uuid;
  IF v_request ? 'shop_id' OR v_request->>'status' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'request_print response did not preserve its shop_id redaction/shape.';
  END IF;
  IF (v_request->>'id')::uuid = v_other_print_id THEN
    RAISE EXCEPTION 'request_print reused a foreign-shop request with the same receipt reference.';
  END IF;
  v_request := public.request_print('sale','S5R-PRINT-'||v_token,v_receipt);
  IF (v_request->>'id')::uuid IS DISTINCT FROM v_print_id THEN RAISE EXCEPTION 'Same-shop print request was not reused.'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor::text,'role','authenticated')::text,true);
  INSERT INTO public.print_requests(shop_id,type,receipt_ref,payload,requested_by,status)
    VALUES(v_shop,'sale','S5R-MOD-'||v_token,
      jsonb_build_object('data',jsonb_build_object('kind','SALE','lines',jsonb_build_array(),'discountPaisa',0),
        'settings',jsonb_build_object('roundNet','none')),v_print_actor,'pending')
    RETURNING id INTO v_modify_id;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  INSERT INTO public.print_requests(shop_id,type,receipt_ref,payload,requested_by,status)
    VALUES(v_other_shop,'sale','S5R-FOREIGN-'||v_token,'{}'::jsonb,v_other_admin,'pending')
    RETURNING id INTO v_other_print_id;
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor::text,'role','authenticated')::text,true);
  v_prints := public.list_print_requests();
  IF position(v_print_id::text IN v_prints::text)=0 OR position(v_other_print_id::text IN v_prints::text)>0 THEN
    RAISE EXCEPTION 'Print request listing crossed shop boundaries.';
  END IF;
  IF public.pending_print_count()::bigint IS DISTINCT FROM (
    SELECT count(*) FROM public.print_requests WHERE shop_id=v_shop AND status='pending'
  ) THEN RAISE EXCEPTION 'Pending print count is not shop-scoped.'; END IF;
  v_result := public.modify_print_request(v_modify_id,jsonb_build_array(jsonb_build_object('qty',1,'name','S5 edit','ratePaisa',100)),0);
  IF v_result->>'id' IS DISTINCT FROM v_modify_id::text THEN RAISE EXCEPTION 'Same-shop print modification failed.'; END IF;
  v_error := NULL;
  BEGIN PERFORM public.modify_print_request(v_other_print_id,jsonb_build_array(jsonb_build_object('qty',1,'name','S5 edit','ratePaisa',100)),0);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign print request was modified.'; END IF;
  v_result := public.decide_print_request(v_modify_id,'approved','S5 smoke');
  IF v_result->>'status' IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'Same-shop print decision failed.'; END IF;
  v_error := NULL;
  BEGIN PERFORM public.decide_print_request(v_other_print_id,'approved','S5 foreign');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign print request was decided.'; END IF;
  IF public.mark_printed_request(v_modify_id) IS NULL THEN RAISE EXCEPTION 'Same-shop print tracking failed.'; END IF;
  v_error := NULL;
  BEGIN PERFORM public.mark_printed_request(v_other_print_id);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign print request was marked printed.'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor::text,'role','authenticated')::text,true);
  INSERT INTO public.medicines(shop_id,code,brand_name,generic_name,strength,category,company,drug_class,min_stock_alert,is_active)
  VALUES(v_shop,'S5R-RESTORE-'||v_token,'S5 restore '||v_token,'Synthetic','1 mg','S5','S5','OTC',1,false)
  RETURNING id INTO v_restore_medicine;
  INSERT INTO public.trash_bin_events(actor_id,shop_id,entity_type,entity_id,action,display_name)
  VALUES(v_actor,v_shop,'medicine',v_restore_medicine,'deactivated','S5 restore');
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  INSERT INTO public.medicines(shop_id,code,brand_name,generic_name,strength,category,company,drug_class,min_stock_alert,is_active)
  VALUES(v_other_shop,'S5R-XRESTORE-'||v_token,'S5 foreign restore','Synthetic','1 mg','S5','S5','OTC',1,false)
  RETURNING id INTO v_other_restore_medicine;
  INSERT INTO public.trash_bin_events(actor_id,shop_id,entity_type,entity_id,action,display_name)
  VALUES(v_other_admin,v_other_shop,'medicine',v_other_restore_medicine,'deactivated','S5 foreign restore');
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor::text,'role','authenticated')::text,true);
  v_events := public.trash_bin_events_list();
  IF position(v_restore_medicine::text IN v_events::text)=0 OR position(v_other_restore_medicine::text IN v_events::text)>0 THEN
    RAISE EXCEPTION 'Trash listing crossed shop boundaries.';
  END IF;
  IF public.restore_trash_medicine(v_restore_medicine) IS DISTINCT FROM v_restore_medicine THEN
    RAISE EXCEPTION 'Same-shop medicine restore failed.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.trash_bin_events
    WHERE shop_id=v_shop AND entity_id=v_restore_medicine AND action='restored') THEN
    RAISE EXCEPTION 'Trash trigger did not capture the same-shop restore.';
  END IF;
  v_error := NULL;
  BEGIN PERFORM public.restore_trash_medicine(v_other_restore_medicine);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign medicine reference was restored.'; END IF;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  INSERT INTO public.suppliers(shop_id,name,contact,address,licence_or_tax_number,payment_terms,is_active)
  VALUES(v_shop,'S5 restore supplier '||v_token,'','','','cash',false)
  RETURNING id INTO v_restore_supplier;
  INSERT INTO public.trash_bin_events(actor_id,shop_id,entity_type,entity_id,action,display_name)
  VALUES(v_actor,v_shop,'supplier',v_restore_supplier,'deactivated','S5 supplier restore');
  INSERT INTO public.suppliers(shop_id,name,contact,address,licence_or_tax_number,payment_terms,is_active)
  VALUES(v_other_shop,'S5 foreign restore supplier '||v_token,'','','','cash',false)
  RETURNING id INTO v_other_restore_supplier;
  INSERT INTO public.trash_bin_events(actor_id,shop_id,entity_type,entity_id,action,display_name)
  VALUES(v_other_admin,v_other_shop,'supplier',v_other_restore_supplier,'deactivated','S5 foreign supplier restore');
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor::text,'role','authenticated')::text,true);
  IF public.restore_trash_supplier(v_restore_supplier) IS DISTINCT FROM v_restore_supplier THEN
    RAISE EXCEPTION 'Same-shop supplier restore failed.';
  END IF;
  v_error := NULL;
  BEGIN PERFORM public.restore_trash_supplier(v_other_restore_supplier);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign supplier reference was restored.'; END IF;
  INSERT INTO public.medicines(shop_id,code,brand_name,generic_name,strength,category,company,drug_class,min_stock_alert,is_active)
  VALUES(v_shop,'S5R-DELETE-'||v_token,'S5 delete '||v_token,'Synthetic','1 mg','S5','S5','OTC',0,false)
  RETURNING id INTO v_delete_medicine;
  INSERT INTO public.trash_bin_events(actor_id,shop_id,entity_type,entity_id,action,display_name)
  VALUES(v_actor,v_shop,'medicine',v_delete_medicine,'deactivated','S5 delete');
  SELECT id INTO v_event_id FROM public.trash_bin_events
  WHERE shop_id=v_shop AND entity_id=v_delete_medicine AND action='deactivated'
  ORDER BY created_at DESC LIMIT 1;
  v_result := public.trash_bin_permanently_delete(v_event_id);
  IF EXISTS(SELECT 1 FROM public.medicines WHERE id=v_delete_medicine) THEN RAISE EXCEPTION 'Same-shop permanent deletion failed.'; END IF;
  SELECT id INTO v_event_id FROM public.trash_bin_events
  WHERE shop_id=v_other_shop AND entity_id=v_other_restore_medicine AND action='deactivated'
  ORDER BY created_at DESC LIMIT 1;
  v_error := NULL;
  BEGIN PERFORM public.trash_bin_permanently_delete(v_event_id);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT; END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Foreign Trash event was permanently deleted.'; END IF;
  v_alerts := public.stock_alerts_summary(200);
  IF position(v_other_medicine::text IN v_alerts::text)>0 THEN RAISE EXCEPTION 'Stock alerts included a foreign-shop medicine.'; END IF;
  IF coalesce((v_alerts->>'out_count')::integer,0) < 1
     OR coalesce(jsonb_array_length(v_alerts->'items'),0) < 1 THEN
    RAISE EXCEPTION 'Stock-alert out count or same-shop fixture was not counted.';
  END IF;

END;
$test$;

SELECT check_row.status, check_row.check_name
FROM (VALUES
  ('PASS','Routine signatures, SECURITY DEFINER settings, shop-helper markers, grants, and profile-purge ACL'),
  ('PASS','Same/foreign purchase references, catalog/history/detail/void scope, and per-shop PR numbering'),
  ('PASS','Print request redaction, same-reference per-shop isolation, list/count/modify/decide/mark scope'),
  ('PASS','Trash list/restore/permanent-delete scope and trigger-captured same-shop restore'),
  ('PASS','Stock low/out counts and foreign-medicine exclusion'),
  ('PASS','Prior products, stock, return-policy, and POS catalog quick regressions')
) AS check_row(status,check_name);

ROLLBACK;
