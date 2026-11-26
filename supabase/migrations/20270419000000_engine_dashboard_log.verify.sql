-- #873: the Engine dashboard's line in the Company log is written by a signed-in person only, as a source of its own.
select json_build_object(
 'only_people_log',has_function_privilege('authenticated','public.log_engine_dashboard(uuid,text,text,text)','execute')
  and not has_function_privilege('anon','public.log_engine_dashboard(uuid,text,text,text)','execute')
  and not has_function_privilege('service_role','public.log_engine_dashboard(uuid,text,text,text)','execute'),
 'owners_only',position('is_company_owner' in pg_get_functiondef('public.log_engine_dashboard(uuid,text,text,text)'::regprocedure))>0,
 'source_kept',pg_get_constraintdef((select oid from pg_constraint where conname='company_log_source_check'))~'engine_dashboard'
);
