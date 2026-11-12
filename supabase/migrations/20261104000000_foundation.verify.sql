-- Read back the schema and its security settings after migration (one statement: `supabase db query` runs a prepared statement).
select json_build_object(
  'rls', (select json_agg(json_build_object('table', c.relname, 'rls', c.relrowsecurity) order by c.relname)
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname in ('companies','people','members','role_permissions')),
  'columns', (select json_agg(json_build_object('table', table_name, 'column', column_name) order by table_name, ordinal_position)
              from information_schema.columns
              where table_schema = 'public' and table_name in ('companies','people','members','role_permissions')),
  'policies', (select json_agg(json_build_object('table', tablename, 'policy', policyname, 'cmd', cmd) order by tablename, policyname)
               from pg_policies where schemaname = 'public')
) as read_back;
