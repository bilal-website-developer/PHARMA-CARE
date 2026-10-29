-- READ-ONLY PREFLIGHT: each numbered SELECT is standalone and returns one cell.
-- Do not run any migration or test SQL until the outputs have been reviewed.

-- 1. Column types, nullability, defaults, and constraints for the target tables.
select jsonb_build_object(
  '1',
  coalesce((
    select json_agg(
      jsonb_build_object(
        'table', expected.table_name,
        'present', relation.oid is not null,
        'rls_enabled', coalesce(relation.relrowsecurity, false),
        'rls_forced', coalesce(relation.relforcerowsecurity, false),
        'columns', coalesce((
          select json_agg(
            jsonb_build_object(
              'column', attribute.attname,
              'type', format_type(attribute.atttypid, attribute.atttypmod),
              'nullable', not attribute.attnotnull,
              'default', pg_get_expr(default_value.adbin, default_value.adrelid)
            ) order by attribute.attnum
          )
          from pg_attribute attribute
          left join pg_attrdef default_value
            on default_value.adrelid = attribute.attrelid
           and default_value.adnum = attribute.attnum
          where attribute.attrelid = to_regclass('public.' || expected.table_name)
            and attribute.attnum > 0
            and not attribute.attisdropped
        ), '[]'::json),
        'constraints', coalesce((
          select json_agg(
            jsonb_build_object(
              'type', constraint_row.contype,
              'definition', pg_get_constraintdef(constraint_row.oid, true)
            ) order by constraint_row.contype, constraint_row.oid
          )
          from pg_constraint constraint_row
          where constraint_row.conrelid =
            to_regclass('public.' || expected.table_name)
        ), '[]'::json)
      ) order by expected.table_name
    )
    from (values
      ('medicines'),
      ('medicine_units'),
      ('sale_items'),
      ('purchase_items'),
      ('stock_batches'),
      ('stock_movements')
    ) expected(table_name)
    left join pg_class relation
      on relation.oid = to_regclass('public.' || expected.table_name)
  ), '[]'::json)
) as preflight_1_schema;

-- 2. RPC signatures/security/execute grants and medicine_units table/column grants.
select jsonb_build_object(
  '2',
  jsonb_build_object(
    'functions', coalesce((
    select json_agg(
      jsonb_build_object(
        'routine', p.proname,
        'arguments', pg_get_function_identity_arguments(p.oid),
        'returns', pg_get_function_result(p.oid),
        'security', case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
        'search_path', coalesce((
          select string_agg(setting, ',')
          from unnest(p.proconfig) setting
          where setting like 'search_path=%'
        ), 'database default'),
        'execute_anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'execute_authenticated', has_function_privilege(
          'authenticated', p.oid, 'EXECUTE'
        ),
        'execute_public', coalesce((
          select bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
          from aclexplode(coalesce(
            p.proacl,
            acldefault('f', p.proowner)
          )) acl
        ), false)
      ) order by p.proname, pg_get_function_identity_arguments(p.oid)
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'pos_catalog',
        'post_sale',
        'post_purchase',
        'process_sale_return',
        'request_sale_return',
        'pending_sale_returns',
        'products_list',
        'save_medicine',
        'adjust_stock',
        'stock_batches_list',
        'stock_overview_stats',
        'products_bulk_import',
        'products_bulk_update',
        'void_purchase',
        'current_shop_id'
      )
    ), '[]'::json),
    'medicine_units_table_grants', coalesce((
      select json_agg(
        jsonb_build_object(
          'grantee', privilege.grantee,
          'privilege', privilege.privilege_type,
          'grantable', privilege.is_grantable
        ) order by privilege.grantee, privilege.privilege_type
      )
      from information_schema.role_table_grants privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'medicine_units'
    ), '[]'::json),
    'medicine_units_column_grants', coalesce((
      select json_agg(
        jsonb_build_object(
          'grantee', privilege.grantee,
          'column', privilege.column_name,
          'privilege', privilege.privilege_type,
          'grantable', privilege.is_grantable
        ) order by privilege.grantee, privilege.column_name, privilege.privilege_type
      )
      from information_schema.column_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'medicine_units'
    ), '[]'::json)
  )
) as preflight_2_functions;

-- 3. Product/unit counts, including missing or multiple default flags.
with per_medicine as (
  select medicine.id,
         count(unit.id) as unit_count,
         count(unit.id) filter (
           where unit.is_default_sale_unit
         ) as default_count,
         count(unit.id) filter (
           where unit.price_paisa = 0
         ) as zero_legacy_price_count
  from public.medicines medicine
  left join public.medicine_units unit on unit.medicine_id = medicine.id
  group by medicine.id
)
select json_agg(summary) as preflight_3_unit_defaults
from (
  select jsonb_build_object(
    '3',
    jsonb_build_object(
      'medicine_count', count(*),
      'unit_count', coalesce(sum(unit_count), 0),
      'unitless_medicine_count', count(*) filter (where unit_count = 0),
      'multiple_unit_medicine_count', count(*) filter (where unit_count > 1),
      'missing_or_multiple_default_count', count(*) filter (where default_count <> 1),
      'zero_legacy_price_unit_count', coalesce(sum(zero_legacy_price_count), 0)
    )
  ) as summary
  from per_medicine
) result;

-- 4. Unitless products and eligible batch-MRP availability, summarized only.
with unitless as (
  select medicine.id, medicine.is_active
  from public.medicines medicine
  where not exists (
    select 1
    from public.medicine_units unit
    where unit.medicine_id = medicine.id
  )
),
candidate_mrp as (
  select batch.candidate_batch_exists,
         product.is_active,
         batch.mrp_paisa_per_base_unit
  from unitless product
  left join lateral (
    select true as candidate_batch_exists,
           eligible.mrp_paisa_per_base_unit
    from public.stock_batches eligible
    where eligible.medicine_id = product.id
      and eligible.quantity_remaining > 0
      and eligible.expiry_date >= current_date
      and eligible.status in ('ACTIVE', 'NEAR_EXPIRY')
    order by eligible.expiry_date, eligible.received_date, eligible.id
    limit 1
  ) batch on true
)
select json_agg(summary) as preflight_4_unitless_products
from (
  select jsonb_build_object(
    '4',
    jsonb_build_object(
      'unitless_medicine_count', count(*),
      'active_unitless_medicine_count', count(*) filter (where is_active),
      'unitless_with_eligible_batch_count',
        count(*) filter (where candidate_batch_exists),
      'unitless_without_eligible_batch_count',
        count(*) filter (where candidate_batch_exists is null),
      'eligible_batch_with_null_mrp_count',
        count(*) filter (
          where candidate_batch_exists and mrp_paisa_per_base_unit is null
        ),
      'candidate_mrp_zero_count',
        count(*) filter (where mrp_paisa_per_base_unit = 0),
      'candidate_mrp_positive_count',
        count(*) filter (where mrp_paisa_per_base_unit > 0)
    )
  ) as summary
  from candidate_mrp
) result;

-- 5. Barcode collision counts only; no barcode values are returned.
with barcode_assignments as (
  select lower(btrim(medicine.barcode)) as normalized_barcode,
         'medicine'::text as barcode_kind
  from public.medicines medicine
  where medicine.barcode is not null
    and nullif(btrim(medicine.barcode), '') is not null
  union all
  select lower(btrim(unit.barcode)) as normalized_barcode,
         'unit'::text as barcode_kind
  from public.medicine_units unit
  where unit.barcode is not null
    and nullif(btrim(unit.barcode), '') is not null
),
duplicate_groups as (
  select normalized_barcode,
         count(*) as assignment_count,
         count(*) filter (where barcode_kind = 'medicine') as medicine_count,
         count(*) filter (where barcode_kind = 'unit') as unit_count
  from barcode_assignments
  group by normalized_barcode
  having count(*) > 1
)
select json_agg(summary) as preflight_5_barcode_collisions
from (
  select jsonb_build_object(
    '5',
    jsonb_build_object(
      'duplicate_barcode_group_count', count(*),
      'duplicate_assignment_count', coalesce(sum(assignment_count - 1), 0),
      'medicine_unit_collision_group_count',
        count(*) filter (where medicine_count > 0 and unit_count > 0),
      'medicine_barcode_duplicate_group_count',
        count(*) filter (where medicine_count > 1),
      'unit_barcode_duplicate_group_count',
        count(*) filter (where unit_count > 1)
    )
  ) as summary
  from duplicate_groups
) result;

-- 6. Baseline sales and stock totals for exact before/after comparison.
select json_agg(summary) as preflight_6_sales_stock_totals
from (
  select jsonb_build_object(
    '6',
    jsonb_build_object(
    'sales_count', (select count(*) from public.sales),
    'sales_subtotal_paisa', (
      select coalesce(sum(subtotal_paisa), 0) from public.sales
    ),
    'sales_discount_paisa', (
      select coalesce(sum(discount_paisa), 0) from public.sales
    ),
    'sales_total_paisa', (
      select coalesce(sum(total_paisa), 0) from public.sales
    ),
    'sale_items_count', (select count(*) from public.sale_items),
    'sale_items_total_paisa', (
      select coalesce(sum(line_total_paisa), 0) from public.sale_items
    ),
    'sold_base_units', (
      select coalesce(sum(quantity_base_units), 0) from public.sale_items
    ),
    'stock_batches_count', (select count(*) from public.stock_batches),
    'stock_received_base_units', (
      select coalesce(sum(quantity_received), 0) from public.stock_batches
    ),
    'stock_remaining_base_units', (
      select coalesce(sum(quantity_remaining), 0) from public.stock_batches
    ),
    'stock_movements_count', (select count(*) from public.stock_movements),
    'stock_movement_base_units', (
      select coalesce(sum(quantity_delta), 0) from public.stock_movements
    )
    )
  ) as summary
) result;
