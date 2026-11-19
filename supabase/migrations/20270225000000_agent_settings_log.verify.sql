-- An Agent setting change is checked and logged by the database, and the log writer stays private.
select json_build_object(
 'log_for_members',has_function_privilege('authenticated','public.log_engine_setting(uuid,uuid,text,jsonb,jsonb)','execute'),
 'log_writer_private',not has_function_privilege('authenticated','public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)','execute'),
 'owner_checked',position('is_company_owner' in pg_get_functiondef('public.log_engine_setting(uuid,uuid,text,jsonb,jsonb)'::regprocedure))>0,
 'setting_values_kept',position('''setting''' in pg_get_functiondef('public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0
  and position('''old''' in pg_get_functiondef('public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0
  and position('''new''' in pg_get_functiondef('public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0
);
