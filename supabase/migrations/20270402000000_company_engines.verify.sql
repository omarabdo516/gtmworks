-- #380: the Engine record is private to server code, a Company is made only onto a waiting record, and the worker's three
-- keepers name the Company each row belongs to.
select json_build_object(
 'record_table',to_regclass('public.company_engines') is not null,
 'record_rls',(select relrowsecurity from pg_class where oid='public.company_engines'::regclass),
 'no_member_reads',not has_table_privilege('anon','public.company_engines','select') and not has_table_privilege('authenticated','public.company_engines','select'),
 'service_reads',has_table_privilege('service_role','public.company_engines','select'),
 'one_record_per_company',exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
  where i.indrelid='public.companies'::regclass and i.indisunique and a.attname='engine_id' and i.indisvalid
  and 1=(select count(*) from pg_attribute x where x.attrelid=i.indrelid and x.attnum=any(i.indkey))),
 'company_needs_engine',exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
  where c.oid='public.companies'::regclass and t.tgname='company_needs_engine' and t.tgdeferrable and t.tginitdeferred),
 'work_names_company',position('company_id' in pg_get_function_result('public.agent_profile_work()'::regprocedure))>0
  and position('company_id' in pg_get_function_result('public.engine_tools_due()'::regprocedure))>0
  and position('company_id' in pg_get_function_result('public.agent_soul_rules_work()'::regprocedure))>0,
 'every_company_has_engine',not exists(select 1 from public.companies c where c.engine_id is null)
);
