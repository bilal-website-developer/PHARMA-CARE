-- Read-only preflight for optional default-privilege hardening.
-- Includes both schema-specific and global defaults; Q6 only reports public-schema defaults.

SELECT jsonb_build_object(
  'current_user', current_user,
  'can_manage_supabase_admin_defaults',
    pg_has_role(current_user, 'supabase_admin', 'MEMBER'),
  'default_privileges', coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'role', defaults.role_name,
        'schema', defaults.schema_name,
        'object_type', defaults.object_type,
        'acl', defaults.acl
      )
      ORDER BY defaults.role_name, defaults.schema_name, defaults.object_type
    )
    FROM (
      SELECT
        r.rolname AS role_name,
        coalesce(ns.nspname, '<global>') AS schema_name,
        default_acl.defaclobjtype::text AS object_type,
        default_acl.defaclacl::text AS acl
      FROM pg_catalog.pg_default_acl AS default_acl
      JOIN pg_catalog.pg_roles AS r ON r.oid = default_acl.defaclrole
      LEFT JOIN pg_catalog.pg_namespace AS ns
        ON ns.oid = default_acl.defaclnamespace
      WHERE r.rolname IN ('postgres', 'supabase_admin')
        AND (
          default_acl.defaclnamespace = 0
          OR ns.nspname = 'public'
        )
    ) AS defaults
  ), '[]'::jsonb)
)::text AS default_privilege_preflight;
