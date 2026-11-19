-- #382: a Company names the one Engine record it is made on, a record serves one Company, and no Company ends a
-- transaction without one.
select json_build_object(
 'engine_named',exists(select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='engine_id'),
 'engine_foreign_key',exists(select 1 from pg_constraint where contype='f' and conrelid='public.companies'::regclass
  and confrelid='public.company_engines'::regclass),
 'every_company_named',not exists(select 1 from public.companies c where c.engine_id is null
  and exists(select 1 from public.company_engines e where e.company_id=c.id)),
 'named_record_holds_its_company',not exists(select 1 from public.companies c join public.company_engines e on e.id=c.engine_id
  where e.company_id is distinct from c.id),
 'missing_engine_deferred',exists(select 1 from pg_trigger t where t.tgrelid='public.companies'::regclass
  and t.tgname='company_needs_engine' and t.tgdeferrable and t.tginitdeferred),
 'attach_trigger_names_it',exists(select 1 from pg_trigger t where t.tgrelid='public.companies'::regclass
  and t.tgname='attach_company_engine' and not t.tgisinternal),
 'setup_names_engine',position('engine_id' in pg_get_functiondef('public.complete_setup(uuid,text,text,text)'::regprocedure))>0
);
