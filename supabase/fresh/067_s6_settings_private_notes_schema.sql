-- S6 package 067. Adds server-backed shop settings and private Admin notes.
-- Owner-run only after package 066's smoke and final checks pass.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.shops, public.profiles IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run package 067 as the reviewed database owner role with RLS bypass.';
  END IF;
  IF to_regclass('public.shop_provisioning_operations') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.shops'::regclass
         AND constraint_row.conname = 'shops_status_check'
         AND constraint_row.contype = 'c'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%provisioning%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%deleted%'
     ) THEN
    RAISE EXCEPTION 'Package 066 is not installed; run its final check before package 067.';
  END IF;
  IF to_regclass('public.shop_settings') IS NOT NULL
     OR to_regclass('public.admin_private_notes') IS NOT NULL THEN
    RAISE EXCEPTION 'Package 067 tables already exist; inspect before applying.';
  END IF;
END
$preflight$;

CREATE TABLE public.shop_settings (
  shop_id uuid PRIMARY KEY
    REFERENCES public.shops(id) ON DELETE RESTRICT,
  settings_version integer NOT NULL DEFAULT 1
    CHECK (settings_version = 1),
  settings jsonb NOT NULL DEFAULT '{
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
  }'::jsonb
    CHECK (jsonb_typeof(settings) = 'object'),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.admin_private_notes (
  admin_profile_id uuid PRIMARY KEY
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT ''
    CHECK (length(note) <= 2000),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.shop_settings (shop_id)
SELECT shop.id
FROM public.shops AS shop
WHERE NOT EXISTS (
  SELECT 1
  FROM public.shop_settings AS existing
  WHERE existing.shop_id = shop.id
);

ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_private_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shop_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.admin_private_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_private_notes TO service_role;

DO $postflight$
BEGIN
  IF (SELECT count(*) FROM public.shop_settings)
       <> (SELECT count(*) FROM public.shops)
     OR EXISTS (
       SELECT 1
       FROM public.shop_settings AS settings
       JOIN public.shops AS shop ON shop.id = settings.shop_id
       WHERE settings.settings_version <> 1
     )
     OR NOT (
       SELECT relation.relrowsecurity
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = 'public.shop_settings'::regclass
     )
     OR NOT (
       SELECT relation.relrowsecurity
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = 'public.admin_private_notes'::regclass
     ) THEN
    RAISE EXCEPTION 'Package 067 postflight verification failed.';
  END IF;
END
$postflight$;

COMMIT;
