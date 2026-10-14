begin;

do $$
declare
  v_function record;
  v_authenticated_had_execute boolean;
begin
  for v_function in
    select p.oid::regprocedure as identity,
           p.prorettype = 'trigger'::regtype as is_trigger_function,
           p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    v_authenticated_had_execute :=
      has_function_privilege('authenticated', v_function.identity, 'EXECUTE');

    execute format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon',
      v_function.identity
    );

    if v_function.is_trigger_function
       or v_function.proname in ('can_view_cost', 'capture_trash_bin_event') then
      execute format(
        'REVOKE EXECUTE ON FUNCTION %s FROM authenticated',
        v_function.identity
      );
    elsif v_authenticated_had_execute then
      execute format(
        'GRANT EXECUTE ON FUNCTION %s TO authenticated',
        v_function.identity
      );
    end if;
  end loop;
end;
$$;

commit;
