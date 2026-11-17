select json_build_object('all_public_tables_have_rls',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity));
