-- S4 read-only preflight: count duplicate business keys before replacing
-- single-shop unique constraints/indexes with shop-scoped equivalents.
-- Returns counts and labels only; it does not expose business-key values.
WITH keys AS (
    SELECT 'brands.name'::text AS check_name, shop_id,
           lower(btrim(name)) AS business_key
    FROM public.brands
    WHERE shop_id IS NOT NULL AND name IS NOT NULL

    UNION ALL
    SELECT 'categories.name', shop_id, lower(btrim(name))
    FROM public.categories
    WHERE shop_id IS NOT NULL AND name IS NOT NULL

    UNION ALL
    SELECT 'medicines.code', shop_id, lower(btrim(code))
    FROM public.medicines
    WHERE shop_id IS NOT NULL AND code IS NOT NULL

    UNION ALL
    SELECT 'all_barcode_sources', shop_id, lower(btrim(barcode))
    FROM public.medicines
    WHERE shop_id IS NOT NULL AND nullif(btrim(barcode), '') IS NOT NULL

    UNION ALL
    SELECT 'all_barcode_sources', shop_id, lower(btrim(barcode))
    FROM public.medicine_units
    WHERE shop_id IS NOT NULL AND nullif(btrim(barcode), '') IS NOT NULL

    UNION ALL
    SELECT 'sales.invoice_number', shop_id, lower(btrim(invoice_number))
    FROM public.sales
    WHERE shop_id IS NOT NULL AND invoice_number IS NOT NULL

    UNION ALL
    SELECT 'purchases.pr_no', shop_id, lower(btrim(pr_no))
    FROM public.purchases
    WHERE shop_id IS NOT NULL AND pr_no IS NOT NULL

    UNION ALL
    SELECT 'medicine_units.name_within_medicine', shop_id,
           medicine_id::text || ':' || lower(btrim(name))
    FROM public.medicine_units
    WHERE shop_id IS NOT NULL AND name IS NOT NULL
),
duplicate_groups AS (
    SELECT check_name, shop_id, business_key, count(*) AS row_count
    FROM keys
    GROUP BY check_name, shop_id, business_key
    HAVING count(*) > 1
),
checks AS (
    SELECT check_name,
           count(*)::bigint AS duplicate_group_count,
           coalesce(sum(row_count), 0)::bigint AS affected_row_count
    FROM duplicate_groups
    GROUP BY check_name
),
unassigned AS (
    SELECT 'brands'::text AS table_name, count(*)::bigint AS row_count
    FROM public.brands WHERE shop_id IS NULL
    UNION ALL
    SELECT 'categories', count(*)::bigint FROM public.categories WHERE shop_id IS NULL
    UNION ALL
    SELECT 'medicines', count(*)::bigint FROM public.medicines WHERE shop_id IS NULL
    UNION ALL
    SELECT 'medicine_units', count(*)::bigint FROM public.medicine_units WHERE shop_id IS NULL
    UNION ALL
    SELECT 'sales', count(*)::bigint FROM public.sales WHERE shop_id IS NULL
    UNION ALL
    SELECT 'purchases', count(*)::bigint FROM public.purchases WHERE shop_id IS NULL
    UNION ALL
    SELECT 'suppliers', count(*)::bigint FROM public.suppliers WHERE shop_id IS NULL
)
SELECT jsonb_build_object(
    'duplicate_checks', coalesce(
        (SELECT jsonb_object_agg(
            check_name,
            jsonb_build_object(
                'duplicate_groups', duplicate_group_count,
                'affected_rows', affected_row_count
            )
        ) FROM checks),
        '{}'::jsonb
    ),
    'unassigned_rows', coalesce(
        (SELECT jsonb_object_agg(table_name, row_count)
         FROM unassigned WHERE row_count > 0),
        '{}'::jsonb
    ),
    'stop_if_any_count_is_nonzero', true
) AS s4_uniqueness_preflight;
