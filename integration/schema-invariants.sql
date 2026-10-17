-- Security invariants every release must keep, regardless of which migrations ran.
do $$
declare offenders text;
begin
  select string_agg(tablename, ', ') into offenders
    from pg_tables where schemaname = 'public' and not rowsecurity;
  if offenders is not null then raise exception 'Tables without row level security: %', offenders; end if;

  select string_agg(tablename || '.' || policyname, ', ') into offenders
    from pg_policies
    where schemaname in ('public', 'storage')
      and (roles && array['anon', 'public']::name[] and not (tablename = 'objects' and schemaname = 'storage'));
  if offenders is not null then raise exception 'Policies open to anonymous or public roles: %', offenders; end if;

  select string_agg(tablename || '.' || policyname, ', ') into offenders
    from pg_policies
    where schemaname = 'public'
      and (lower(coalesce(qual, '')) in ('true', '(true)') or lower(coalesce(with_check, '')) in ('true', '(true)'));
  if offenders is not null then raise exception 'Policies granting unrestricted access: %', offenders; end if;

  select string_agg(p.proname, ', ') into offenders
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if offenders is not null then raise exception 'Security definer functions without a fixed search_path: %', offenders; end if;

  select string_agg(id, ', ') into offenders from storage.buckets where public;
  if offenders is not null then raise exception 'Public storage buckets: %', offenders; end if;

  select string_agg(c.relname, ', ') into offenders
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false);
  if offenders is not null then raise exception 'Views that bypass row level security: %', offenders; end if;
end $$;
