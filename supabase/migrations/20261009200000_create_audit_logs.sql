begin;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null,
  entity text not null,
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

create policy audit_logs_admin_select
  on public.audit_logs
  for select
  to authenticated
  using (public.is_admin());

revoke all on table public.audit_logs from anon, authenticated;
grant select on table public.audit_logs to authenticated;
grant all on table public.audit_logs to service_role;

commit;
