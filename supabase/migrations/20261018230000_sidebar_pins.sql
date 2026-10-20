begin;

create table public.user_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_key text not null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  constraint user_favorites_user_page_key unique (user_id, page_key)
);

create index user_favorites_user_id_idx on public.user_favorites (user_id);

alter table public.user_favorites enable row level security;

create policy user_favorites_select_own
  on public.user_favorites for select to authenticated
  using (user_id = auth.uid());

create policy user_favorites_insert_own
  on public.user_favorites for insert to authenticated
  with check (user_id = auth.uid());

create policy user_favorites_update_own
  on public.user_favorites for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_favorites_delete_own
  on public.user_favorites for delete to authenticated
  using (user_id = auth.uid());

create table public.user_sidebar_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tip_dismissed boolean not null default false
);

alter table public.user_sidebar_preferences enable row level security;

create policy user_sidebar_preferences_select_own
  on public.user_sidebar_preferences for select to authenticated
  using (user_id = auth.uid());

create policy user_sidebar_preferences_insert_own
  on public.user_sidebar_preferences for insert to authenticated
  with check (user_id = auth.uid());

create policy user_sidebar_preferences_update_own
  on public.user_sidebar_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_sidebar_preferences_delete_own
  on public.user_sidebar_preferences for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.user_favorites, public.user_sidebar_preferences to authenticated;
revoke all on public.user_favorites, public.user_sidebar_preferences from anon;

create or replace function public.save_sidebar_preferences(
  p_page_keys text[],
  p_tip_dismissed boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_page_keys is null
     or cardinality(p_page_keys) > 8
     or exists (
       select 1
       from unnest(p_page_keys) as requested(page_key)
       group by requested.page_key
       having count(*) > 1
     ) then
    raise exception 'Sidebar favorites must contain no more than 8 unique pages';
  end if;

  delete from public.user_favorites
  where user_id = auth.uid();

  insert into public.user_favorites (user_id, page_key, position)
  select auth.uid(), page_key, ordinality::integer - 1
  from unnest(p_page_keys) with ordinality as requested(page_key, ordinality);

  insert into public.user_sidebar_preferences (user_id, tip_dismissed)
  values (auth.uid(), coalesce(p_tip_dismissed, false))
  on conflict (user_id) do update
    set tip_dismissed = public.user_sidebar_preferences.tip_dismissed or excluded.tip_dismissed;
end;
$function$;

revoke all on function public.save_sidebar_preferences(text[], boolean) from public, anon;
grant execute on function public.save_sidebar_preferences(text[], boolean) to authenticated;

commit;
