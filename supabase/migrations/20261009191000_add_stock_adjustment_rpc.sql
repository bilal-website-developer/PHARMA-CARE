begin;

-- Positive count corrections may exceed the original receipt quantity.
alter table public.stock_batches
  drop constraint if exists stock_batches_check;

create or replace function public.adjust_stock(
  p_batch_id uuid,
  p_quantity_delta integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_current_quantity integer;
  v_next_quantity bigint;
  v_reason text := lower(btrim(p_reason));
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_active and deleted_at is null
  ) then
    raise exception 'An active authenticated user is required';
  end if;
  if not public.has_any_permission(array['stock_inventory']::text[]) then
    raise exception 'You do not have permission to adjust stock';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Stock adjustment quantity must not be zero';
  end if;
  if v_reason is null
     or v_reason not in ('damage', 'expired', 'counting error', 'theft', 'other') then
    raise exception 'Reason must be damage, expired, counting error, theft, or other';
  end if;

  select quantity_remaining
  into v_current_quantity
  from public.stock_batches
  where id = p_batch_id
  for update;
  if not found then
    raise exception 'Stock batch not found';
  end if;

  v_next_quantity := v_current_quantity::bigint + p_quantity_delta::bigint;
  if v_next_quantity < 0 then
    raise exception 'Stock adjustment cannot make batch quantity negative';
  end if;
  if v_next_quantity > 2147483647 then
    raise exception 'Adjusted quantity exceeds the supported stock limit';
  end if;

  update public.stock_batches
  set quantity_remaining = v_next_quantity::integer
  where id = p_batch_id;

  insert into public.stock_movements (
    batch_id, movement_type, quantity_delta, reason, created_by
  )
  values (
    p_batch_id, 'ADJUSTMENT', p_quantity_delta, v_reason, auth.uid()
  );

  return v_next_quantity::integer;
end;
$function$;

revoke all on function public.adjust_stock(uuid, integer, text) from public, anon;
grant execute on function public.adjust_stock(uuid, integer, text) to authenticated;

commit;