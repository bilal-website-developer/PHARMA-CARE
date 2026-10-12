begin;

create or replace function public.write_off_expired_batch(
  p_batch_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_batch record;
  v_reason text := lower(btrim(p_reason));
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  ) then
    raise exception 'An active authenticated user is required';
  end if;
  if not public.has_any_permission(array['stock_inventory']::text[]) then
    raise exception 'You do not have permission to write off stock';
  end if;
  if p_batch_id is null then
    raise exception 'A stock batch is required';
  end if;
  if v_reason is distinct from 'expired' then
    raise exception 'Write-off reason must be expired';
  end if;

  select id, batch_number, expiry_date, quantity_remaining
  into v_batch
  from public.stock_batches
  where id = p_batch_id
  for update;
  if not found then
    raise exception 'Stock batch not found';
  end if;
  if v_batch.expiry_date >= current_date then
    raise exception 'Only an expired batch can be written off';
  end if;
  if v_batch.quantity_remaining <= 0 then
    raise exception 'Expired batch has no remaining stock to write off';
  end if;

  update public.stock_batches
  set quantity_remaining = 0
  where id = v_batch.id;

  insert into public.stock_movements (
    batch_id, movement_type, quantity_delta, reason, created_by
  )
  values (
    v_batch.id, 'WRITE_OFF', -v_batch.quantity_remaining, v_reason, auth.uid()
  );

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, details
  )
  values (
    auth.uid(),
    'stock_batch_write_off',
    'stock_batches',
    v_batch.id,
    jsonb_build_object(
      'batch_number', v_batch.batch_number,
      'expiry_date', v_batch.expiry_date,
      'quantity_before', v_batch.quantity_remaining,
      'quantity_after', 0,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'quantity_before', v_batch.quantity_remaining,
    'quantity_after', 0,
    'movement_type', 'WRITE_OFF',
    'reason', v_reason
  );
end;
$function$;

commit;
