-- Run in the Supabase SQL Editor after replacing the email below with the
-- existing account that should become the initial Super Admin.
-- Passwords remain managed by Supabase Auth and are never readable in SQL.

do $$
declare
  role_data_type text;
  role_check_name text;
  role_check_definition text;
  role_check_count integer;
  target_email text := lower('replace-with-super-admin-email@example.com');
  updated_count integer;
begin
  if target_email = 'replace-with-super-admin-email@example.com' then
    raise exception 'Replace the example email in this script before running it.';
  end if;

  select format_type(attribute.atttypid, attribute.atttypmod)
    into role_data_type
  from pg_attribute as attribute
  where attribute.attrelid = 'public.profiles'::regclass
    and attribute.attname = 'role'
    and not attribute.attisdropped;

  if role_data_type is null then
    raise exception 'Column public.profiles.role was not found.';
  end if;

  if role_data_type not in ('text', 'character varying', 'character') then
    raise exception 'Expected public.profiles.role to be a text column; found %.', role_data_type;
  end if;

  select count(*)
    into role_check_count
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.profiles'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) ilike '%role%';

  if role_check_count > 1 then
    raise exception 'Found multiple role check constraints. Update them manually before running this script.';
  end if;

  select constraint_row.conname, pg_get_constraintdef(constraint_row.oid)
    into role_check_name, role_check_definition
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.profiles'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) ilike '%role%';

  if role_check_name is not null then
    if role_check_definition not ilike '%cashier%'
      or role_check_definition not ilike '%manager%'
      or role_check_definition not ilike '%accountant%'
      or role_check_definition not ilike '%admin%' then
      raise exception 'Found an unrecognized role check constraint (%). Update it manually before running this script.', role_check_name;
    end if;
    execute format('alter table public.profiles drop constraint %I', role_check_name);
  end if;

  alter table public.profiles
    add constraint profiles_role_check
    check (role in ('cashier', 'manager', 'accountant', 'admin', 'super_admin'));

  update public.profiles
  set role = 'super_admin'
  where lower(email) = target_email;

  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'Expected exactly one profile matching %, but updated % rows.', target_email, updated_count;
  end if;
end;
$$;
