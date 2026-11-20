-- #378 (T3): the Company names its Engine in one place, the record names no Company, one record serves one Company, and
-- no Company ends a transaction without one.
select json_build_object(
 'record_names_no_company',not exists(select 1 from information_schema.columns
  where table_schema='public' and table_name='company_engines' and column_name='company_id'),
 'sync_trigger_gone',not exists(select 1 from pg_trigger t where t.tgrelid='public.companies'::regclass and t.tgname='attach_company_engine'),
 'one_company_per_engine',exists(select 1 from pg_constraint where conname='companies_engine_unique' and conrelid='public.companies'::regclass
  and contype='u'),
 'missing_engine_deferred',exists(select 1 from pg_trigger t where t.tgrelid='public.companies'::regclass
  and t.tgname='company_needs_engine' and t.tgdeferrable and t.tginitdeferred),
 'missing_engine_names_the_record',position('company_enginesewheree.id=new.engine_id' in
  regexp_replace(pg_get_functiondef('public.company_needs_engine()'::regprocedure),'[[:space:]]','','g'))>0,
 'setup_names_a_free_engine',position('notexists(select1frompublic.companiescwherec.engine_id=e.id)' in
  regexp_replace(pg_get_functiondef('public.complete_setup(uuid,text,text,text)'::regprocedure),'[[:space:]]','','g'))>0,
 'maker_names_a_free_engine',position('notexists(select1frompublic.companiescwherec.engine_id=e.id)' in
  regexp_replace(pg_get_functiondef('public.create_company_with_owner(uuid,text,uuid,text,text,text)'::regprocedure),'[[:space:]]','','g'))>0,
 'adopt_names_the_company',position('update public.companies set engine_id=engine' in
  pg_get_functiondef('public.adopt_engine(text,text)'::regprocedure))>0
);
