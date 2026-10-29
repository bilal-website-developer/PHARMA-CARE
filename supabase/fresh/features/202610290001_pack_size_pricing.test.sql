-- DRAFT ONLY: Part B transactional regression tests.
-- Do not run until the owner approves this test stage and verifies the live schema.
-- The test transaction ends with ROLLBACK so fixture rows and RPC writes are discarded.
begin;

do $pack_pricing_tests$
declare
  v_actor uuid;
  v_category text;
  v_company text;
  v_supplier uuid;
  v_medicine uuid;
  v_code text := 'PACKTEST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_import_code text := 'PACKIMPORT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_unit_tablet uuid;
  v_unit_strip uuid;
  v_unit_box uuid;
  v_batch uuid;
  v_sale jsonb;
  v_purchase jsonb;
  v_return jsonb;
  v_pending jsonb;
  v_products jsonb;
  v_stock jsonb;
  v_stats jsonb;
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_allocation_id uuid;
  v_return_item_id uuid;
  v_purchase_id uuid;
  v_purchase_batch uuid;
  v_quantity integer;
  v_imported integer;
begin
  select id into v_actor
  from public.profiles
  where role = 'admin' and is_active and deleted_at is null
  order by id
  limit 1;
  if v_actor is null then
    raise exception 'Test prerequisite missing: an active Admin profile is required';
  end if;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  select name into v_category from public.categories where is_active order by name limit 1;
  select name into v_company from public.brands where is_active order by name limit 1;
  if v_category is null or v_company is null then
    raise exception 'Test prerequisite missing: one active category and manufacturer are required';
  end if;

  insert into public.suppliers (
    name, contact, address, licence_or_tax_number, payment_terms, is_active
  )
  values (
    v_code || ' supplier', '', '', '', 'CASH', true
  )
  returning id into v_supplier;

  -- save_medicine: create three explicitly priced sale units without inferring
  -- dosage form or base-unit label.
  v_medicine := public.save_medicine(
    null,
    jsonb_build_object(
      'code', v_code,
      'brand_name', v_code || ' medicine',
      'generic_name', 'Pack pricing test formula',
      'strength', '10 mg',
      'dosage_form', null,
      'base_unit_label', null,
      'category', v_category,
      'company', v_company,
      'drug_class', 'OTC',
      'storage_condition', 'ROOM_TEMPERATURE',
      'rack_location', '',
      'min_stock_alert', 10,
      'requires_prescription', false,
      'is_active', true
    ),
    jsonb_build_array(
      jsonb_build_object(
        'name', 'Tablet', 'conversion_factor', 1,
        'is_default_sale_unit', true, 'price_paisa', 1000, 'barcode', null
      ),
      jsonb_build_object(
        'name', 'Strip', 'conversion_factor', 10,
        'is_default_sale_unit', false, 'price_paisa', 9000, 'barcode', null
      ),
      jsonb_build_object(
        'name', 'Box', 'conversion_factor', 100,
        'is_default_sale_unit', false, 'price_paisa', 80000, 'barcode', null
      )
    )
  );

  select id into v_unit_tablet
  from public.medicine_units where medicine_id = v_medicine and name = 'Tablet';
  select id into v_unit_strip
  from public.medicine_units where medicine_id = v_medicine and name = 'Strip';
  select id into v_unit_box
  from public.medicine_units where medicine_id = v_medicine and name = 'Box';
  if v_unit_tablet is null or v_unit_strip is null or v_unit_box is null then
    raise exception 'save_medicine failed to persist all three test units';
  end if;
  if exists (
    select 1
    from public.medicine_units
    where medicine_id = v_medicine
      and sale_price_paisa is distinct from price_paisa
  ) then
    raise exception 'save_medicine did not keep legacy and nullable sale prices synchronized';
  end if;
  if (select count(*) from public.medicine_units
      where medicine_id = v_medicine and is_default_sale_unit) <> 1 then
    raise exception 'save_medicine did not preserve exactly one default unit';
  end if;

  insert into public.stock_batches (
    medicine_id, supplier_id, batch_number, expiry_date, received_date,
    cost_paisa_per_base_unit, mrp_paisa_per_base_unit,
    quantity_received, quantity_remaining
  )
  values (
    v_medicine, v_supplier, v_code || '-SALE',
    current_date + 365, current_date, 100, 1000, 500, 500
  )
  returning id into v_batch;

  -- pos_catalog: every unit factor and configured legacy sale price is present.
  if not exists (
    select 1
    from jsonb_array_elements(public.pos_catalog()) product
    cross join lateral jsonb_array_elements(product->'units') unit
    where product->>'id' = v_medicine::text
      and unit->>'id' = v_unit_strip::text
      and unit->>'conversionFactor' = '10'
      and unit->>'pricePerUnitPaisa' = '9000'
  ) then
    raise exception 'pos_catalog did not return the configured strip factor and price';
  end if;

  -- products_list: the test medicine is visible to an Admin with Products access.
  v_products := public.products_list(
    p_search => v_code,
    p_status => 'all',
    p_page => 1,
    p_page_size => 25
  );
  if not (v_products->'rows' @> jsonb_build_array(jsonb_build_object('id', v_medicine::text))) then
    raise exception 'products_list did not return the test medicine';
  end if;

  -- post_sale: one tablet and two strips are separate lines and deduct 21 base units.
  v_sale := public.post_sale(
    null,
    'Pack pricing test',
    jsonb_build_array(
      jsonb_build_object('medicine_id', v_medicine, 'unit_id', v_unit_tablet, 'quantity_in_unit', 1),
      jsonb_build_object('medicine_id', v_medicine, 'unit_id', v_unit_strip, 'quantity_in_unit', 2)
    ),
    0,
    0,
    19000,
    jsonb_build_array(jsonb_build_object('payment_method', 'CASH', 'amount_paisa', 19000))
  );
  v_sale_id := (v_sale->>'id')::uuid;
  if v_sale_id is null
     or (select count(*) from public.sale_items where sale_id = v_sale_id) <> 2
     or (select sum(quantity_base_units) from public.sale_items where sale_id = v_sale_id) <> 21
     or (select quantity_remaining from public.stock_batches where id = v_batch) <> 479 then
    raise exception 'post_sale did not persist separate units and deduct the exact base quantity';
  end if;

  -- The database rejects direct sale-item writes for a unit without a price.
  update public.medicine_units
  set sale_price_paisa = null
  where id = v_unit_box;
  begin
    insert into public.sale_items (
      sale_id, medicine_id, unit_id, product_name, generic_name, unit_name,
      conversion_factor, quantity_in_unit, quantity_base_units,
      price_paisa_per_unit, cost_paisa_per_base_unit, discount_percent,
      line_discount_paisa, line_adjustment_paisa, line_total_paisa
    )
    values (
      v_sale_id, v_medicine, v_unit_box, 'Test medicine', 'Test formula', 'Box',
      100, 1, 100, 0, 0, 0, 0, 0, 0
    );
    raise exception 'An unpriced sale unit was accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'The selected sale unit has no configured sale price' then
        raise;
      end if;
  end;

  select id into v_sale_item_id
  from public.sale_items
  where sale_id = v_sale_id and unit_id = v_unit_strip;
  select id into v_allocation_id
  from public.sale_item_batch_allocations
  where sale_item_id = v_sale_item_id;

  -- request_sale_return and pending_sale_returns: reserve exactly one sealed strip.
  v_return := public.request_sale_return(
    v_sale_id,
    'Pack pricing test return',
    jsonb_build_array(jsonb_build_object(
      'sale_item_id', v_sale_item_id,
      'allocation_id', v_allocation_id,
      'quantity_base_units', 10
    ))
  );
  v_pending := public.pending_sale_returns();
  if not (v_pending @> jsonb_build_array(jsonb_build_object('id', v_return->>'id'))) then
    raise exception 'pending_sale_returns did not include the new request';
  end if;
  select id into v_return_item_id
  from public.sale_return_items
  where return_id = (v_return->>'id')::uuid;

  -- process_sale_return: refund the original line amount proportionally and
  -- restock the original batch by ten base units.
  v_return := public.process_sale_return(
    (v_return->>'id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', v_return_item_id,
      'disposition', 'RESTOCK',
      'reason', 'Pack pricing test',
      'sealedIntact', true,
      'restockUnitId', v_unit_strip
    ))
  );
  if (v_return->>'refundTotalPaisa')::integer <> 9000
     or (select quantity_remaining from public.stock_batches where id = v_batch) <> 489 then
    raise exception 'process_sale_return did not refund or restock the original base units correctly';
  end if;

  -- Inactive units cannot be used to add sale items, even if their price remains.
  update public.medicine_units
  set is_active = false
  where id = v_unit_strip;
  begin
    insert into public.sale_items (
      sale_id, medicine_id, unit_id, product_name, generic_name, unit_name,
      conversion_factor, quantity_in_unit, quantity_base_units,
      price_paisa_per_unit, cost_paisa_per_base_unit, discount_percent,
      line_discount_paisa, line_adjustment_paisa, line_total_paisa
    )
    values (
      v_sale_id, v_medicine, v_unit_strip, 'Test medicine', 'Test formula', 'Strip',
      10, 1, 10, 9000, 0, 0, 0, 0, 9000
    );
    raise exception 'An inactive sale unit was accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'The selected sale unit is inactive or does not belong to this medicine' then
        raise;
      end if;
  end;

  -- adjust_stock: quantity deltas remain base-unit deltas.
  perform public.adjust_stock(v_batch, 5, 'counting error');
  perform public.adjust_stock(v_batch, -5, 'counting error');
  if (select quantity_remaining from public.stock_batches where id = v_batch) <> 489 then
    raise exception 'adjust_stock changed more or fewer than the requested base units';
  end if;

  -- stock_batches_list and stock_overview_stats: both expose valid JSON and the
  -- stock list includes the test batch without changing its base-unit quantity.
  v_stock := public.stock_batches_list(
    p_tab => 'all',
    p_search => v_code,
    p_sort => 'expiry_asc',
    p_page => 1,
    p_page_size => 100,
    p_medicine_id => v_medicine
  );
  if not (v_stock->'rows' @> jsonb_build_array(jsonb_build_object('id', v_batch::text))) then
    raise exception 'stock_batches_list did not return the test batch';
  end if;
  v_stats := public.stock_overview_stats();
  if jsonb_typeof(v_stats) <> 'object'
     or not (v_stats ? 'stock_value_mrp_paisa')
     or (select quantity_remaining from public.stock_batches where id = v_batch) <> 489 then
    raise exception 'stock_overview_stats returned an invalid shape or changed stock';
  end if;

  -- post_purchase: two boxes at factor 100 add 200 base units.
  v_purchase := public.post_purchase(
    v_supplier,
    v_code || '-INV',
    current_date,
    0,
    'Pack pricing test',
    jsonb_build_array(jsonb_build_object(
      'medicine_id', v_medicine,
      'unit_id', v_unit_box,
      'batch_number', v_code || '-PURCHASE',
      'expiry_date', (current_date + 365)::text,
      'quantity', 2,
      'bonus_qty', 0,
      'unit_cost_paisa', 50000,
      'mrp_paisa', 80000
    )),
    0,
    'cash'
  );
  v_purchase_id := (v_purchase->>'id')::uuid;
  select id, quantity_received into v_purchase_batch, v_quantity
  from public.stock_batches
  where medicine_id = v_medicine and batch_number = v_code || '-PURCHASE';
  if v_purchase_id is null or v_quantity <> 200 then
    raise exception 'post_purchase did not convert two boxes to 200 base units';
  end if;
  if (select cost_price_paisa from public.medicine_units where id = v_unit_box) <> 50000 then
    raise exception 'post_purchase did not save the most recent unit purchase cost';
  end if;

  -- void_purchase: voiding a fresh purchase with no subsequent movements zeroes
  -- only its receipt batch and leaves the original sale batch unchanged.
  perform public.void_purchase(v_purchase_id, 'Pack pricing test');
  if (select quantity_remaining from public.stock_batches where id = v_purchase_batch) <> 0
     or (select quantity_remaining from public.stock_batches where id = v_batch) <> 489 then
    raise exception 'void_purchase changed the wrong batch or failed to reverse its base quantity';
  end if;

  -- products_bulk_import delegates to save_medicine; products_bulk_update keeps
  -- its existing activation contract without touching pack prices.
  perform public.products_bulk_import(jsonb_build_array(jsonb_build_object(
    'code', v_import_code,
    'brand_name', v_import_code || ' medicine',
    'generic_name', 'Pack pricing import test',
    'category', v_category,
    'company', v_company,
    'drug_class', 'OTC',
    'unit_name', 'Tablet',
    'conversion_factor', 1,
    'price_paisa', 1000
  )));
  select id into v_medicine from public.medicines where code = v_import_code;
  if v_medicine is null then
    raise exception 'products_bulk_import did not create its one-unit product';
  end if;
  if (select sale_price_paisa from public.medicine_units where medicine_id = v_medicine)
       is distinct from 1000 then
    raise exception 'products_bulk_import did not preserve the new unit sale price';
  end if;
  v_imported := public.products_bulk_update(array[v_medicine], 'deactivate', null);
  if v_imported <> 1 or (select is_active from public.medicines where id = v_medicine) then
    raise exception 'products_bulk_update did not deactivate the selected product';
  end if;
  v_imported := public.products_bulk_update(array[v_medicine], 'activate', null);
  if v_imported <> 1 or not (select is_active from public.medicines where id = v_medicine) then
    raise exception 'products_bulk_update did not reactivate the selected product';
  end if;

  -- Part B follow-up required before signoff: import/export round-trip for
  -- multiple pack rows, plus UI coverage for inactive and unpriced sale units.
  -- The current application fallback and import/export paths are unchanged and
  -- require coordinated client/RPC work before they can be claimed as covered.
end;
$pack_pricing_tests$;

rollback;
