-- DRAFT ONLY: rollback for 202610290001_pack_size_pricing.sql.
-- Review current grants and confirm the draft migration was the only source of
-- these objects before applying. If fallback units exist, preserve/reassign them
-- explicitly before rollback; this script never deletes them automatically.

begin;

drop trigger if exists purchase_items_update_last_pack_cost on public.purchase_items;
drop trigger if exists sale_items_validate_pack_unit on public.sale_items;
drop trigger if exists medicine_units_sync_sale_price on public.medicine_units;
drop trigger if exists medicines_require_default_unit on public.medicines;
drop trigger if exists medicine_units_exactly_one_active_default on public.medicine_units;

drop function if exists public.update_medicine_unit_last_pack_cost();
drop function if exists public.validate_sale_item_pack_unit();
drop function if exists public.sync_medicine_unit_sale_price();
drop function if exists public.assert_medicine_has_one_active_default_unit();

alter table public.medicine_units
  drop constraint if exists medicine_units_default_must_be_active_check,
  drop constraint if exists medicine_units_sort_order_check,
  drop constraint if exists medicine_units_cost_price_paisa_check,
  drop constraint if exists medicine_units_sale_price_paisa_check;

do $rollback_preflight$
begin
  if exists (select 1 from public.medicine_units where pack_pricing_backfilled) then
    raise exception 'Rollback stopped: migration-created base units must be preserved or explicitly reassigned before rollback';
  end if;
end;
$rollback_preflight$;

-- The migration's restricted column grants remain after rollback. Compare the
-- preflight ACL output and restore any prior privileges manually after approval.

alter table public.medicine_units
  drop column if exists pack_pricing_backfilled,
  drop column if exists sort_order,
  drop column if exists is_active,
  drop column if exists cost_price_paisa,
  drop column if exists sale_price_paisa;

alter table public.medicines
  drop column if exists base_unit_label,
  drop column if exists dosage_form;

commit;
