-- Rollback for S6 package 067. Run only before settings or notes are edited.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE public.shops, public.profiles, public.shop_settings, public.admin_private_notes
  IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_default_settings jsonb := '{
    "billingTemplate": "pharmacy-memo",
    "receiptFormat": "thermal80",
    "maxDiscountPaisa": 20000,
    "roleDiscountPercentCap": {
      "admin": 30,
      "manager": 15,
      "cashier": 10,
      "accountant": 0
    },
    "expiryWarningDays": 90,
    "memo": {
      "notes": [
        "Items will be return with cash memo within 15 days.",
        "Inhaler / loose tablets / lotion / fridge items/cosmetics items will not be returned.",
        "Without sign and stamp bill will not be valid"
      ],
      "terminalName": "SERVER-PC",
      "showBatchExpiry": true,
      "roundNet": "none",
      "printTax": false,
      "duplicateLabel": true,
      "autoPrint": false,
      "numberDigits": 6,
      "printLogo": true
    }
  }'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run package 067 rollback as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regclass('public.shop_settings') IS NULL
     OR to_regclass('public.admin_private_notes') IS NULL THEN
    RAISE EXCEPTION 'Package 067 tables are not both present; stop for review.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_private_notes)
     OR EXISTS (
       SELECT 1
       FROM public.shop_settings AS settings
       WHERE settings.settings IS DISTINCT FROM v_default_settings
         OR settings.settings_version <> 1
         OR settings.updated_by IS NOT NULL
     )
     OR (SELECT count(*) FROM public.shop_settings)
       <> (SELECT count(*) FROM public.shops) THEN
    RAISE EXCEPTION 'Settings or private notes contain edits; rollback would discard data.';
  END IF;
  IF to_regclass('public.shop_provisioning_operations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.shop_provisioning_operations) THEN
    RAISE EXCEPTION 'Provisioning operations exist; rollback would remove required settings.';
  END IF;
END
$preflight$;

DROP TABLE public.admin_private_notes;
DROP TABLE public.shop_settings;

COMMIT;

SELECT jsonb_build_object(
  'stage', 'S6 package 067 rollback check',
  'status', CASE
    WHEN to_regclass('public.shop_settings') IS NULL
      AND to_regclass('public.admin_private_notes') IS NULL
    THEN 'PASS' ELSE 'FAIL' END,
  'shop_settings_absent', to_regclass('public.shop_settings') IS NULL,
  'admin_private_notes_absent', to_regclass('public.admin_private_notes') IS NULL
) AS s6_settings_private_notes_schema_rollback_check;
