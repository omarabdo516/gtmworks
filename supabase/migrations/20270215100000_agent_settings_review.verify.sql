-- An Agent settings log row names About or Voice only, carries no text, and the log stays the members' and not the
-- signed-out caller's.
select json_build_object(
 'fields_limited',position('''about''' in pg_get_functiondef('public.log_agent_setting(uuid,uuid,text,text,text)'::regprocedure))>0
  and position('''voice''' in pg_get_functiondef('public.log_agent_setting(uuid,uuid,text,text,text)'::regprocedure))>0,
 'values_refused',position('old_value is not null or new_value is not null' in pg_get_functiondef('public.log_agent_setting(uuid,uuid,text,text,text)'::regprocedure))>0,
 'log_for_members',has_function_privilege('authenticated','public.log_agent_setting(uuid,uuid,text,text,text)','execute'),
 'log_private',not has_function_privilege('anon','public.log_agent_setting(uuid,uuid,text,text,text)','execute')
);
-- An Agent mid-move keeps a model record but is not choosable while its record still runs on the Company profile.
select json_build_object(
 'choosable_needs_its_profile',position('g.profile=a.profile' in pg_get_functiondef('public.company_agent_models(uuid)'::regprocedure))>0,
 'rows_for_members',has_function_privilege('authenticated','public.company_agent_models(uuid)','execute')
);
