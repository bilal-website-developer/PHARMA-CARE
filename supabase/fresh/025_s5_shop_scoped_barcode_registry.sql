-- S5 barcode package: shop-scoped assignment and a cross-table barcode registry.
-- Owner-run only. Existing manual barcodes are preserved during registry backfill.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

LOCK TABLE
  public.medicine_units,
  public.medicines,
  public.shops
IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_signature text;
  v_signatures text[] := ARRAY[
    'public.assign_medicine_barcode(uuid,text,boolean)',
    'public.assign_missing_barcodes(uuid[])',
    'public.ean13_check_digit(text)'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run this migration as the reviewed database owner role with RLS bypass.';
  END IF;

  IF to_regprocedure('tenant_private.current_shop_id()') IS NULL
     OR to_regprocedure('public.has_any_permission(text[])') IS NULL
     OR to_regclass('public.medicine_barcode_seq') IS NULL THEN
    RAISE EXCEPTION 'The reviewed S3 helper or legacy barcode sequence is missing.';
  END IF;

  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL
       OR NOT has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS routine
         WHERE routine.oid = to_regprocedure(v_signature)
           AND routine.proconfig @> ARRAY['search_path=public']
           AND (
             (v_signature = 'public.ean13_check_digit(text)' AND NOT routine.prosecdef)
             OR (v_signature <> 'public.ean13_check_digit(text)' AND routine.prosecdef)
           )
       ) THEN
      RAISE EXCEPTION 'Routine % is missing or its reviewed grants/security settings differ.', v_signature;
    END IF;
  END LOOP;

  IF to_regprocedure('public.assign_medicine_unit_barcode(uuid,text,boolean)') IS NOT NULL
     OR to_regprocedure('public.assign_shop_barcode_prefix()') IS NOT NULL
     OR to_regprocedure(
       'public.sync_medicine_barcode_registry(uuid,text,uuid,uuid,uuid,text,uuid,uuid)'
     ) IS NOT NULL
     OR to_regprocedure('public.sync_medicine_barcode_registry_trigger()') IS NOT NULL
     OR to_regprocedure('public.sync_medicine_unit_barcode_registry_trigger()') IS NOT NULL
     OR to_regprocedure('public.next_shop_medicine_barcode(uuid)') IS NOT NULL
     OR to_regclass('public.medicine_barcode_registry') IS NOT NULL
     OR to_regclass('public.medicine_barcode_counters') IS NOT NULL
     OR to_regclass('public.shop_barcode_prefix_seq') IS NOT NULL
     OR to_regclass('public.shops_barcode_prefix_key') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.shops'::regclass
         AND attname = 'barcode_prefix'
         AND attnum > 0
         AND NOT attisdropped
     ) THEN
    RAISE EXCEPTION 'Barcode registry or shop-prefix objects already exist; inspect before continuing.';
  END IF;

  IF to_regclass('public.medicines_shop_barcode_unique') IS NULL
     OR to_regclass('public.medicines_barcode_unique') IS NOT NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS index_class
       JOIN pg_catalog.pg_index AS index_info
         ON index_info.indexrelid = index_class.oid
       WHERE index_class.oid = to_regclass('public.medicines_shop_barcode_unique')
         AND index_info.indisunique
         AND index_info.indisvalid
         AND index_info.indisready
     )
     OR to_regclass('public.medicines_shop_id_id_key') IS NULL
     OR to_regclass('public.medicine_units_shop_id_id_key') IS NULL THEN
    RAISE EXCEPTION 'Expected S4 barcode and same-shop reference indexes are missing or invalid.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.shops)
     OR EXISTS (
       SELECT 1
       FROM public.medicines
       WHERE nullif(btrim(barcode), '') IS NOT NULL
         AND shop_id IS NULL
     )
     OR EXISTS (
       SELECT 1
       FROM public.medicine_units
       WHERE nullif(btrim(barcode), '') IS NOT NULL
         AND shop_id IS NULL
     ) THEN
    RAISE EXCEPTION 'A shop or an assigned shop barcode is missing; stop and inspect.';
  END IF;

  IF EXISTS (
    SELECT shop_id, lower(btrim(barcode))
    FROM (
      SELECT shop_id, barcode
      FROM public.medicines
      WHERE nullif(btrim(barcode), '') IS NOT NULL
      UNION ALL
      SELECT shop_id, barcode
      FROM public.medicine_units
      WHERE nullif(btrim(barcode), '') IS NOT NULL
    ) AS all_barcodes
    GROUP BY shop_id, lower(btrim(barcode))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Normalized duplicate barcodes exist within a shop; reconcile them before migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.pronamespace = 'public'::regnamespace
      AND routine.prokind = 'f'
      AND routine.oid <> to_regprocedure('public.assign_medicine_barcode(uuid,text,boolean)')
      AND pg_catalog.pg_get_functiondef(routine.oid) ILIKE '%medicine_barcode_seq%'
  ) THEN
    RAISE EXCEPTION 'Another public routine references medicine_barcode_seq; inspect before replacing barcode assignment.';
  END IF;

  IF has_sequence_privilege('anon', 'public.medicine_barcode_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.medicine_barcode_seq', 'USAGE') THEN
    RAISE EXCEPTION 'The legacy barcode sequence is directly executable by an API role; reconcile its grants first.';
  END IF;
END
$preflight$;

CREATE SEQUENCE public.shop_barcode_prefix_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

ALTER TABLE public.shops
  ADD COLUMN barcode_prefix text;

DO $assign_existing_prefixes$
DECLARE
  v_shop_id uuid;
BEGIN
  FOR v_shop_id IN
    SELECT id
    FROM public.shops
    ORDER BY created_at, id
  LOOP
    UPDATE public.shops
    SET barcode_prefix = 'PCS' || lpad(
      nextval('public.shop_barcode_prefix_seq')::text,
      2,
      '0'
    )
    WHERE id = v_shop_id;
  END LOOP;
END
$assign_existing_prefixes$;

ALTER TABLE public.shops
  ALTER COLUMN barcode_prefix SET NOT NULL;
ALTER TABLE public.shops
  ADD CONSTRAINT shops_barcode_prefix_format_check
  CHECK (barcode_prefix ~ '^PCS[0-9]+$');
CREATE UNIQUE INDEX shops_barcode_prefix_key
  ON public.shops (barcode_prefix);

CREATE TABLE public.medicine_barcode_counters (
  shop_id uuid PRIMARY KEY
    REFERENCES public.shops(id) ON DELETE CASCADE,
  next_value bigint NOT NULL
    CHECK (next_value BETWEEN 2 AND 1000000000)
);

CREATE TABLE public.medicine_barcode_registry (
  shop_id uuid NOT NULL,
  normalized_barcode text NOT NULL,
  medicine_id uuid,
  medicine_unit_id uuid,
  CONSTRAINT medicine_barcode_registry_pkey
    PRIMARY KEY (shop_id, normalized_barcode),
  CONSTRAINT medicine_barcode_registry_normalized_check
    CHECK (
      normalized_barcode <> ''
      AND normalized_barcode = lower(btrim(normalized_barcode))
    ),
  CONSTRAINT medicine_barcode_registry_one_target_check
    CHECK (pg_catalog.num_nonnulls(medicine_id, medicine_unit_id) = 1),
  CONSTRAINT medicine_barcode_registry_medicine_fkey
    FOREIGN KEY (shop_id, medicine_id)
    REFERENCES public.medicines (shop_id, id)
    ON DELETE CASCADE,
  CONSTRAINT medicine_barcode_registry_unit_fkey
    FOREIGN KEY (shop_id, medicine_unit_id)
    REFERENCES public.medicine_units (shop_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX medicine_barcode_registry_medicine_key
  ON public.medicine_barcode_registry (shop_id, medicine_id)
  WHERE medicine_id IS NOT NULL;
CREATE UNIQUE INDEX medicine_barcode_registry_unit_key
  ON public.medicine_barcode_registry (shop_id, medicine_unit_id)
  WHERE medicine_unit_id IS NOT NULL;

INSERT INTO public.medicine_barcode_registry (
  shop_id,
  normalized_barcode,
  medicine_id,
  medicine_unit_id
)
SELECT shop_id, lower(btrim(barcode)), id, NULL
FROM public.medicines
WHERE nullif(btrim(barcode), '') IS NOT NULL
UNION ALL
SELECT shop_id, lower(btrim(barcode)), NULL, id
FROM public.medicine_units
WHERE nullif(btrim(barcode), '') IS NOT NULL;

ALTER TABLE public.medicine_barcode_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_barcode_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.medicine_barcode_counters
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.medicine_barcode_registry
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON SEQUENCE public.shop_barcode_prefix_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.assign_shop_barcode_prefix()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.barcode_prefix IS NOT NULL THEN
      RAISE EXCEPTION 'Barcode prefix is assigned by the database';
    END IF;
    NEW.barcode_prefix := 'PCS' || lpad(
      nextval('public.shop_barcode_prefix_seq')::text,
      2,
      '0'
    );
    RETURN NEW;
  END IF;

  IF NEW.barcode_prefix IS DISTINCT FROM OLD.barcode_prefix THEN
    RAISE EXCEPTION 'Barcode prefix cannot be changed';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER shops_assign_barcode_prefix
BEFORE INSERT OR UPDATE
ON public.shops
FOR EACH ROW
EXECUTE FUNCTION public.assign_shop_barcode_prefix();

CREATE FUNCTION public.sync_medicine_barcode_registry(
  p_old_shop_id uuid,
  p_old_barcode text,
  p_old_medicine_id uuid,
  p_old_medicine_unit_id uuid,
  p_new_shop_id uuid,
  p_new_barcode text,
  p_new_medicine_id uuid,
  p_new_medicine_unit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old_barcode text := nullif(lower(btrim(p_old_barcode)), '');
  v_new_barcode text := nullif(lower(btrim(p_new_barcode)), '');
BEGIN
  IF v_old_barcode IS NOT NULL
     AND p_old_shop_id IS NOT DISTINCT FROM p_new_shop_id
     AND v_old_barcode = v_new_barcode
     AND p_old_medicine_id IS NOT DISTINCT FROM p_new_medicine_id
     AND p_old_medicine_unit_id IS NOT DISTINCT FROM p_new_medicine_unit_id THEN
    RETURN;
  END IF;

  IF v_old_barcode IS NOT NULL THEN
    DELETE FROM public.medicine_barcode_registry
    WHERE shop_id = p_old_shop_id
      AND normalized_barcode = v_old_barcode
      AND medicine_id IS NOT DISTINCT FROM p_old_medicine_id
      AND medicine_unit_id IS NOT DISTINCT FROM p_old_medicine_unit_id;
  END IF;

  IF v_new_barcode IS NULL THEN
    RETURN;
  END IF;
  IF p_new_shop_id IS NULL
     OR pg_catalog.num_nonnulls(p_new_medicine_id, p_new_medicine_unit_id) <> 1 THEN
    RAISE EXCEPTION 'A barcode must belong to one medicine or unit in a shop';
  END IF;

  INSERT INTO public.medicine_barcode_registry (
    shop_id,
    normalized_barcode,
    medicine_id,
    medicine_unit_id
  )
  VALUES (
    p_new_shop_id,
    v_new_barcode,
    p_new_medicine_id,
    p_new_medicine_unit_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Barcode is already assigned in this shop'
      USING ERRCODE = '23505';
END;
$function$;

CREATE FUNCTION public.sync_medicine_barcode_registry_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sync_medicine_barcode_registry(
      NULL, NULL, NULL, NULL,
      NEW.shop_id, NEW.barcode, NEW.id, NULL
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.sync_medicine_barcode_registry(
      OLD.shop_id, OLD.barcode, OLD.id, NULL,
      NULL, NULL, NULL, NULL
    );
    RETURN OLD;
  END IF;

  PERFORM public.sync_medicine_barcode_registry(
    OLD.shop_id, OLD.barcode, OLD.id, NULL,
    NEW.shop_id, NEW.barcode, NEW.id, NULL
  );
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.sync_medicine_unit_barcode_registry_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sync_medicine_barcode_registry(
      NULL, NULL, NULL, NULL,
      NEW.shop_id, NEW.barcode, NULL, NEW.id
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.sync_medicine_barcode_registry(
      OLD.shop_id, OLD.barcode, NULL, OLD.id,
      NULL, NULL, NULL, NULL
    );
    RETURN OLD;
  END IF;

  PERFORM public.sync_medicine_barcode_registry(
    OLD.shop_id, OLD.barcode, NULL, OLD.id,
    NEW.shop_id, NEW.barcode, NULL, NEW.id
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER medicines_sync_barcode_registry
AFTER INSERT OR UPDATE OR DELETE
ON public.medicines
FOR EACH ROW
EXECUTE FUNCTION public.sync_medicine_barcode_registry_trigger();

CREATE TRIGGER medicine_units_sync_barcode_registry
AFTER INSERT OR UPDATE OR DELETE
ON public.medicine_units
FOR EACH ROW
EXECUTE FUNCTION public.sync_medicine_unit_barcode_registry_trigger();

CREATE FUNCTION public.next_shop_medicine_barcode(p_shop_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prefix text;
  v_number bigint;
BEGIN
  IF p_shop_id IS NULL THEN
    RAISE EXCEPTION 'A shop is required to generate a barcode';
  END IF;

  SELECT shop.barcode_prefix
  INTO v_prefix
  FROM public.shops AS shop
  WHERE shop.id = p_shop_id;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Shop barcode prefix is unavailable';
  END IF;

  INSERT INTO public.medicine_barcode_counters (shop_id, next_value)
  VALUES (p_shop_id, 2)
  ON CONFLICT (shop_id) DO UPDATE
    SET next_value = medicine_barcode_counters.next_value + 1
    WHERE medicine_barcode_counters.next_value < 1000000000
  RETURNING next_value - 1 INTO v_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This shop has exhausted its barcode range';
  END IF;

  RETURN v_prefix || '-' || lpad(v_number::text, 9, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_medicine_barcode(
  p_medicine_id uuid,
  p_barcode text DEFAULT NULL,
  p_replace boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_medicine record;
  v_trimmed text;
  v_candidate text;
  v_collision boolean;
  v_replace boolean := coalesce(p_replace, false);
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['products']::text[]) THEN
    RAISE EXCEPTION 'An active user with products permission is required';
  END IF;
  IF p_medicine_id IS NULL THEN
    RAISE EXCEPTION 'A medicine id is required';
  END IF;

  SELECT medicine.id, medicine.barcode
  INTO v_medicine
  FROM public.medicines AS medicine
  WHERE medicine.id = p_medicine_id
    AND medicine.shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicine not found';
  END IF;

  IF p_barcode IS NOT NULL THEN
    v_trimmed := btrim(p_barcode);
    IF v_trimmed = '' THEN
      RAISE EXCEPTION 'Barcode value cannot be blank';
    END IF;
    IF length(v_trimmed) = 13 AND v_trimmed ~ '^\d+$'
       AND public.ean13_check_digit(substr(v_trimmed, 1, 12)) <> substr(v_trimmed, 13, 1) THEN
      RAISE EXCEPTION 'EAN-13 barcode checksum is invalid';
    END IF;
    IF v_medicine.barcode IS NOT NULL
       AND btrim(v_medicine.barcode) <> ''
       AND NOT v_replace THEN
      RAISE EXCEPTION 'This medicine already has a barcode. Use replace=true to overwrite it.';
    END IF;

    BEGIN
      UPDATE public.medicines AS medicine
      SET barcode = v_trimmed
      WHERE medicine.id = p_medicine_id
        AND medicine.shop_id = v_shop_id;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Barcode is already assigned in this shop'
          USING ERRCODE = '23505';
    END;

    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, details)
    VALUES (
      auth.uid(),
      'assign_medicine_barcode',
      'medicines',
      p_medicine_id,
      jsonb_build_object('barcode', v_trimmed, 'replaced', v_replace)
    );
    RETURN v_trimmed;
  END IF;

  IF v_medicine.barcode IS NOT NULL
     AND btrim(v_medicine.barcode) <> ''
     AND NOT v_replace THEN
    RETURN v_medicine.barcode;
  END IF;

  LOOP
    v_candidate := public.next_shop_medicine_barcode(v_shop_id);
    v_collision := false;
    BEGIN
      UPDATE public.medicines AS medicine
      SET barcode = v_candidate
      WHERE medicine.id = p_medicine_id
        AND medicine.shop_id = v_shop_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Medicine not found';
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        v_collision := true;
    END;
    IF v_collision THEN
      CONTINUE;
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, details)
    VALUES (
      auth.uid(),
      'assign_medicine_barcode',
      'medicines',
      p_medicine_id,
      jsonb_build_object('barcode', v_candidate, 'replaced', v_replace)
    );
    RETURN v_candidate;
  END LOOP;
END;
$function$;

CREATE FUNCTION public.assign_medicine_unit_barcode(
  p_medicine_unit_id uuid,
  p_barcode text DEFAULT NULL,
  p_replace boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_unit record;
  v_trimmed text;
  v_candidate text;
  v_collision boolean;
  v_replace boolean := coalesce(p_replace, false);
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['products']::text[]) THEN
    RAISE EXCEPTION 'An active user with products permission is required';
  END IF;
  IF p_medicine_unit_id IS NULL THEN
    RAISE EXCEPTION 'A medicine unit id is required';
  END IF;

  SELECT unit.id, unit.barcode
  INTO v_unit
  FROM public.medicine_units AS unit
  WHERE unit.id = p_medicine_unit_id
    AND unit.shop_id = v_shop_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicine unit not found';
  END IF;

  IF p_barcode IS NOT NULL THEN
    v_trimmed := btrim(p_barcode);
    IF v_trimmed = '' THEN
      RAISE EXCEPTION 'Barcode value cannot be blank';
    END IF;
    IF length(v_trimmed) = 13 AND v_trimmed ~ '^\d+$'
       AND public.ean13_check_digit(substr(v_trimmed, 1, 12)) <> substr(v_trimmed, 13, 1) THEN
      RAISE EXCEPTION 'EAN-13 barcode checksum is invalid';
    END IF;
    IF v_unit.barcode IS NOT NULL
       AND btrim(v_unit.barcode) <> ''
       AND NOT v_replace THEN
      RAISE EXCEPTION 'This medicine unit already has a barcode. Use replace=true to overwrite it.';
    END IF;

    BEGIN
      UPDATE public.medicine_units AS unit
      SET barcode = v_trimmed
      WHERE unit.id = p_medicine_unit_id
        AND unit.shop_id = v_shop_id;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Barcode is already assigned in this shop'
          USING ERRCODE = '23505';
    END;

    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, details)
    VALUES (
      auth.uid(),
      'assign_medicine_unit_barcode',
      'medicine_units',
      p_medicine_unit_id,
      jsonb_build_object('barcode', v_trimmed, 'replaced', v_replace)
    );
    RETURN v_trimmed;
  END IF;

  IF v_unit.barcode IS NOT NULL
     AND btrim(v_unit.barcode) <> ''
     AND NOT v_replace THEN
    RETURN v_unit.barcode;
  END IF;

  LOOP
    v_candidate := public.next_shop_medicine_barcode(v_shop_id);
    v_collision := false;
    BEGIN
      UPDATE public.medicine_units AS unit
      SET barcode = v_candidate
      WHERE unit.id = p_medicine_unit_id
        AND unit.shop_id = v_shop_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Medicine unit not found';
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        v_collision := true;
    END;
    IF v_collision THEN
      CONTINUE;
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, details)
    VALUES (
      auth.uid(),
      'assign_medicine_unit_barcode',
      'medicine_units',
      p_medicine_unit_id,
      jsonb_build_object('barcode', v_candidate, 'replaced', v_replace)
    );
    RETURN v_candidate;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_missing_barcodes(
  p_medicine_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop_id uuid := tenant_private.current_shop_id();
  v_ids uuid[] := coalesce(p_medicine_ids, ARRAY[]::uuid[]);
  v_medicine_id uuid;
  v_existing_barcode text;
  v_assigned integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
BEGIN
  IF auth.uid() IS NULL OR v_shop_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND shop_id = v_shop_id
      AND is_active = true
      AND deleted_at IS NULL
  ) OR NOT public.has_any_permission(ARRAY['products']::text[]) THEN
    RAISE EXCEPTION 'An active user with products permission is required';
  END IF;

  IF array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('assigned', 0, 'skipped', 0, 'failed', 0);
  END IF;

  FOREACH v_medicine_id IN ARRAY v_ids LOOP
    IF v_medicine_id IS NULL THEN
      v_failed := v_failed + 1;
      CONTINUE;
    END IF;

    SELECT medicine.barcode
    INTO v_existing_barcode
    FROM public.medicines AS medicine
    WHERE medicine.id = v_medicine_id
      AND medicine.shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_failed := v_failed + 1;
    ELSIF v_existing_barcode IS NOT NULL
       AND btrim(v_existing_barcode) <> '' THEN
      v_skipped := v_skipped + 1;
    ELSE
      PERFORM public.assign_medicine_barcode(v_medicine_id, NULL, false);
      v_assigned := v_assigned + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'assigned', v_assigned,
    'skipped', v_skipped,
    'failed', v_failed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_shop_barcode_prefix() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_medicine_barcode_registry(
  uuid, text, uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_medicine_barcode_registry_trigger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_medicine_unit_barcode_registry_trigger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.next_shop_medicine_barcode(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_medicine_barcode(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_medicine_unit_barcode(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_missing_barcodes(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_medicine_barcode(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_medicine_unit_barcode(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_missing_barcodes(uuid[]) TO authenticated;

DO $postflight$
DECLARE
  v_signature text;
  v_definition text;
  v_signatures text[] := ARRAY[
    'public.assign_medicine_barcode(uuid,text,boolean)',
    'public.assign_medicine_unit_barcode(uuid,text,boolean)',
    'public.assign_missing_barcodes(uuid[])'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    SELECT pg_catalog.pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_definition;
    IF position('tenant_private.current_shop_id()' IN v_definition) = 0
       OR position('shop_id = v_shop_id' IN v_definition) = 0
       OR NOT has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS routine
         WHERE routine.oid = to_regprocedure(v_signature)
           AND routine.prosecdef
           AND routine.proconfig @> ARRAY['search_path=public']
       ) THEN
      RAISE EXCEPTION 'Routine % is missing explicit tenant scope or reviewed security settings.', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.medicines'::regclass
      AND tgname = 'medicines_sync_barcode_registry'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.medicine_units'::regclass
      AND tgname = 'medicine_units_sync_barcode_registry'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.shops'::regclass
      AND tgname = 'shops_assign_barcode_prefix'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'One or more barcode registry synchronization triggers are missing or disabled.';
  END IF;

  IF (
    SELECT count(*)
    FROM public.medicines
    WHERE nullif(btrim(barcode), '') IS NOT NULL
  ) + (
    SELECT count(*)
    FROM public.medicine_units
    WHERE nullif(btrim(barcode), '') IS NOT NULL
  ) <> (SELECT count(*) FROM public.medicine_barcode_registry) THEN
    RAISE EXCEPTION 'Barcode registry count does not match the non-empty medicine and unit barcodes.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.medicines AS medicine
    WHERE nullif(btrim(medicine.barcode), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.medicine_barcode_registry AS registry
        WHERE registry.shop_id = medicine.shop_id
          AND registry.normalized_barcode = lower(btrim(medicine.barcode))
          AND registry.medicine_id = medicine.id
          AND registry.medicine_unit_id IS NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.medicine_units AS unit
    WHERE nullif(btrim(unit.barcode), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.medicine_barcode_registry AS registry
        WHERE registry.shop_id = unit.shop_id
          AND registry.normalized_barcode = lower(btrim(unit.barcode))
          AND registry.medicine_unit_id = unit.id
          AND registry.medicine_id IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'One or more non-empty barcode values are missing from the shop registry.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.pronamespace = 'public'::regnamespace
      AND routine.prokind = 'f'
      AND pg_catalog.pg_get_functiondef(routine.oid) ILIKE '%medicine_barcode_seq%'
  ) THEN
    RAISE EXCEPTION 'A public routine still references the legacy global barcode sequence.';
  END IF;
END
$postflight$;

COMMIT;

NOTIFY pgrst, 'reload schema';
