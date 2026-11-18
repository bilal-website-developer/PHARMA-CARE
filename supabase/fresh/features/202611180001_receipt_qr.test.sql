-- Receipt QR rollback-only smoke test. Run after apply_all as the reviewed owner role.
-- Test data changes are rolled back; missing tenant fixtures are reported as INFO notices.
-- Test actors need Settings plus POS or Sales History access, matching the RPC guards.

DO $smoke$
DECLARE
  v_actor uuid;
  v_shop uuid;
  v_sale uuid;
  v_foreign_actor uuid;
  v_foreign_sale uuid;
  v_super_admin uuid;
  v_settings jsonb := pg_catalog.jsonb_build_object(
    'publicReceiptsEnabled', true,
    'linkLifetimeDays', 90,
    'showMedicineNames', true,
    'qrPlacement', 'footer',
    'qrBaseUrl', 'https://receipt-smoke.example'
  );
  v_first jsonb;
  v_second jsonb;
  v_foreign jsonb;
  v_regenerated jsonb;
  v_token text;
  v_denied boolean;
  v_has_anon_exec boolean;
  v_result text;
  v_results text[] := ARRAY[]::text[];
BEGIN
  SELECT profile.id, profile.shop_id, sale.id
  INTO v_actor, v_shop, v_sale
  FROM public.profiles AS profile
  JOIN public.sales AS sale ON sale.shop_id = profile.shop_id
  WHERE profile.is_active AND profile.deleted_at IS NULL
    AND profile.role IN ('admin', 'manager')
    AND profile.permissions && ARRAY['settings']::text[]
    AND profile.permissions && ARRAY['pos', 'sales_history']::text[]
    AND sale.status IN ('COMPLETED', 'PARTIALLY_RETURNED')
  ORDER BY profile.created_at, sale.created_at
  LIMIT 1;

  SELECT profile.id, sale.id
  INTO v_foreign_actor, v_foreign_sale
  FROM public.profiles AS profile
  JOIN public.sales AS sale ON sale.shop_id = profile.shop_id
  WHERE profile.is_active AND profile.deleted_at IS NULL
    AND profile.role IN ('admin', 'manager')
    AND profile.permissions && ARRAY['settings']::text[]
    AND profile.permissions && ARRAY['pos', 'sales_history']::text[]
    AND sale.status IN ('COMPLETED', 'PARTIALLY_RETURNED')
    AND profile.shop_id <> v_shop
  ORDER BY profile.created_at, sale.created_at
  LIMIT 1;

  SELECT profile.id INTO v_super_admin
  FROM public.profiles AS profile
  WHERE profile.role = 'super_admin'
    AND profile.shop_id IS NULL
    AND profile.is_active AND profile.deleted_at IS NULL
  ORDER BY profile.created_at
  LIMIT 1;

  BEGIN
    IF v_actor IS NOT NULL THEN
      PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
      PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
      PERFORM public.update_receipt_qr_settings(v_settings);
      v_first := public.get_or_create_receipt_link(v_sale);
      v_second := public.get_or_create_receipt_link(v_sale);
      v_results := pg_catalog.array_append(v_results,
        CASE WHEN v_first->>'token' = v_second->>'token'
          THEN 'same-shop create and reprint reuse|PASS|Repeated print reused the same active token.'
          ELSE 'same-shop create and reprint reuse|FAIL|Repeated print returned different tokens.'
        END);

      IF v_foreign_sale IS NOT NULL THEN
        v_denied := false;
        BEGIN
          PERFORM public.get_or_create_receipt_link(v_foreign_sale);
        EXCEPTION WHEN OTHERS THEN
          v_denied := true;
        END;
        v_results := pg_catalog.array_append(v_results,
          CASE WHEN v_denied
            THEN 'foreign-shop link creation denied|PASS|A sale from another shop was rejected.'
            ELSE 'foreign-shop link creation denied|FAIL|A sale from another shop was accepted.'
          END);
      ELSE
        v_results := pg_catalog.array_append(v_results,
          'foreign-shop link creation denied|INFO|No active second-shop sale and eligible actor were found.');
      END IF;

      IF v_foreign_actor IS NOT NULL THEN
        PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_foreign_actor::text, true);
        PERFORM public.update_receipt_qr_settings(v_settings);
        v_foreign := public.get_or_create_receipt_link(v_foreign_sale);
        PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
        v_denied := false;
        BEGIN
          PERFORM public.resolve_receipt_link(v_foreign->>'token');
        EXCEPTION WHEN OTHERS THEN
          v_denied := true;
        END;
        v_results := pg_catalog.array_append(v_results,
          CASE WHEN v_denied
            THEN 'foreign-shop token resolve denied|PASS|A token from another shop was rejected.'
            ELSE 'foreign-shop token resolve denied|FAIL|A token from another shop resolved.'
          END);
      ELSE
        v_results := pg_catalog.array_append(v_results,
          'foreign-shop token resolve denied|INFO|No active second-shop sale and eligible actor were found.');
      END IF;

      PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
      SELECT link.token INTO v_token
      FROM public.sale_receipt_links AS link
      WHERE link.sale_id = v_sale AND link.shop_id = v_shop AND link.revoked_at IS NULL;
      UPDATE public.sale_receipt_links AS link
      SET expires_at = pg_catalog.now() - interval '1 day'
      WHERE link.sale_id = v_sale AND link.shop_id = v_shop
        AND link.token = v_token AND link.revoked_at IS NULL;
      v_denied := false;
      BEGIN
        PERFORM public.resolve_receipt_link(v_token);
      EXCEPTION WHEN OTHERS THEN
        v_denied := true;
      END;
      v_results := pg_catalog.array_append(v_results,
        CASE WHEN NOT v_denied
          THEN 'expired staff lookup remains available|PASS|Staff lookup ignores public expiry as required.'
          ELSE 'expired staff lookup remains available|FAIL|Staff lookup rejected an expired but active link.'
        END);

      v_regenerated := public.revoke_receipt_link(v_sale);
      v_denied := false;
      BEGIN
        PERFORM public.resolve_receipt_link(v_token);
      EXCEPTION WHEN OTHERS THEN
        v_denied := true;
      END;
      v_results := pg_catalog.array_append(v_results,
        CASE WHEN v_denied AND v_regenerated->>'token' <> v_token
          THEN 'revoked token denied and regenerated|PASS|Old token no longer resolves; a new token was returned.'
          ELSE 'revoked token denied and regenerated|FAIL|Old token remained usable or no replacement was issued.'
        END);
    ELSE
      v_results := pg_catalog.array_append(v_results,
        'same-shop create and reprint reuse|INFO|No active Admin/Manager with an eligible sale was found.');
      v_results := pg_catalog.array_append(v_results,
        'foreign-shop link creation denied|INFO|An eligible same-shop actor and sale are required first.');
      v_results := pg_catalog.array_append(v_results,
        'foreign-shop token resolve denied|INFO|Eligible sales and actors in two shops are required.');
      v_results := pg_catalog.array_append(v_results,
        'expired staff lookup remains available|INFO|An eligible same-shop actor and sale are required first.');
      v_results := pg_catalog.array_append(v_results,
        'revoked token denied and regenerated|INFO|An eligible same-shop actor and sale are required first.');
    END IF;

    IF v_super_admin IS NOT NULL THEN
      PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_super_admin::text, true);
      PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
      v_denied := false;
      BEGIN
        PERFORM public.get_receipt_qr_settings();
      EXCEPTION WHEN OTHERS THEN
        v_denied := true;
      END;
      v_results := pg_catalog.array_append(v_results,
        CASE WHEN v_denied
          THEN 'Super Admin denied|PASS|Platform Super Admin could not access a shop-scoped QR RPC.'
          ELSE 'Super Admin denied|FAIL|Platform Super Admin accessed shop QR settings.'
        END);
    ELSE
      v_results := pg_catalog.array_append(v_results,
        'Super Admin denied|INFO|No active platform Super Admin profile was found.');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'public.get_receipt_qr_settings()',
        'public.update_receipt_qr_settings(jsonb)',
        'public.get_or_create_receipt_link(uuid)',
        'public.resolve_receipt_link(text)',
        'public.revoke_receipt_link(uuid)',
        'public.sale_id_for_receipt_invoice(text)',
        'public.consume_receipt_rate_limit(text,integer,integer)',
        'public.record_public_receipt_view(uuid)'
      ]) AS signature
      WHERE pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
    ) INTO v_has_anon_exec;
    v_results := pg_catalog.array_append(v_results,
      CASE WHEN NOT v_has_anon_exec
        THEN 'anon cannot execute receipt RPCs|PASS|No receipt function grants EXECUTE to anon.'
        ELSE 'anon cannot execute receipt RPCs|FAIL|At least one receipt function grants EXECUTE to anon.'
      END);

    v_results := pg_catalog.array_append(v_results,
      'public payload allowlist|INFO|Verified by the Edge Function unit test: npm run test:receipt-qr.');

    RAISE EXCEPTION '__RECEIPT_QR_SMOKE_ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__RECEIPT_QR_SMOKE_ROLLBACK__' THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'Receipt QR smoke test results:';
  RAISE NOTICE 'check_name | status | detail';
  FOREACH v_result IN ARRAY v_results LOOP
    RAISE NOTICE '%', pg_catalog.replace(v_result, '|', ' | ');
  END LOOP;
END
$smoke$;
