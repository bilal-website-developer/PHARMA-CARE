-- Receipt QR package read-only preflight. Run before apply_all.
-- Does not create, update, or delete database objects or business rows.
WITH expected AS (
  SELECT * FROM (VALUES
    ('tenant_private.current_shop_id()', to_regprocedure('tenant_private.current_shop_id()') IS NOT NULL),
    ('tenant_private.is_current_shop(uuid)', to_regprocedure('tenant_private.is_current_shop(uuid)') IS NOT NULL),
    ('public.has_any_permission(text[])', to_regprocedure('public.has_any_permission(text[])') IS NOT NULL),
    ('public.sales.shop_id', EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = to_regclass('public.sales') AND attname = 'shop_id'
        AND attnum > 0 AND NOT attisdropped
    )),
    ('public.sale_items.shop_id', EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = to_regclass('public.sale_items') AND attname = 'shop_id'
        AND attnum > 0 AND NOT attisdropped
    )),
    ('S4 restrictive sales isolation', EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy
      WHERE polrelid = to_regclass('public.sales') AND NOT polpermissive
        AND polroles @> ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')]
    )),
    ('receipt QR tables absent', to_regclass('public.sale_receipt_links') IS NULL
      AND to_regclass('public.shop_receipt_qr_settings') IS NULL
      AND to_regclass('public.receipt_public_rate_limits') IS NULL),
    ('receipt QR RPC names available', to_regprocedure('public.get_receipt_qr_settings()') IS NULL
      AND to_regprocedure('public.update_receipt_qr_settings(jsonb)') IS NULL
      AND to_regprocedure('public.get_or_create_receipt_link(uuid)') IS NULL
      AND to_regprocedure('public.resolve_receipt_link(text)') IS NULL
      AND to_regprocedure('public.revoke_receipt_link(uuid)') IS NULL)
  ) AS checks(check_name, passed)
)
SELECT check_name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status
FROM expected
UNION ALL
SELECT 'OVERALL', CASE WHEN bool_and(passed) THEN 'PASS' ELSE 'FAIL' END
FROM expected;
