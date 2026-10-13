begin;

create or replace function public.pos_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_catalog jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active = true
      and deleted_at is null
  ) or not public.has_any_permission(array['pos']::text[]) then
    raise exception 'An active user with POS permission is required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', medicine.id,
      'code', medicine.code,
      'barcode', medicine.barcode,
      'brandName', medicine.brand_name,
      'genericName', medicine.generic_name,
      'strength', medicine.strength,
      'category', medicine.category,
      'company', medicine.company,
      'drugClass', medicine.drug_class,
      'units', unit_rows.units,
      'batches', batch_rows.batches
    )
    order by medicine.brand_name, medicine.id
  ), '[]'::jsonb)
  into v_catalog
  from public.medicines medicine
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', unit.id,
        'name', unit.name,
        'conversionFactor', unit.conversion_factor,
        'isDefaultSaleUnit', unit.is_default_sale_unit,
        'pricePerUnitPaisa', unit.price_paisa
      )
      order by unit.is_default_sale_unit desc, unit.name, unit.id
    ), '[]'::jsonb) as units
    from public.medicine_units unit
    where unit.medicine_id = medicine.id
  ) unit_rows
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', batch.id,
        'batchNumber', batch.batch_number,
        'expiryDate', batch.expiry_date,
        'receivedDate', batch.received_date,
        'quantitySmallestUnit', batch.quantity_remaining,
        'status', batch.status
      )
      order by batch.expiry_date, batch.received_date, batch.id
    ), '[]'::jsonb) as batches
    from public.stock_batches batch
    where batch.medicine_id = medicine.id
      and batch.quantity_remaining > 0
      and batch.expiry_date >= current_date
      and batch.status in ('ACTIVE', 'NEAR_EXPIRY')
  ) batch_rows
  where medicine.is_active
    -- Future multi-shop scope belongs here, once shop_id is added to medicines.
    and jsonb_array_length(unit_rows.units) > 0
    and jsonb_array_length(batch_rows.batches) > 0;

  return v_catalog;
end;
$function$;

revoke all on function public.pos_catalog() from public, anon, authenticated;
grant execute on function public.pos_catalog() to authenticated;

commit;
