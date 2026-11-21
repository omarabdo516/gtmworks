-- #182: a change of Good morning is logged by a member's own session only, checked as every field of the Agent's page.
select json_build_object(
 'log_for_members',has_function_privilege('authenticated','public.log_agent_morning(uuid,uuid,text,text,uuid)','execute')
  and not has_function_privilege('anon','public.log_agent_morning(uuid,uuid,text,text,uuid)','execute')
  and not has_function_privilege('service_role','public.log_agent_morning(uuid,uuid,text,text,uuid)','execute'),
 'managers_checked',position('check_agent_setting' in pg_get_functiondef('public.log_agent_morning(uuid,uuid,text,text,uuid)'::regprocedure))>0,
 'main_only',position('is_default' in pg_get_functiondef('public.log_agent_morning(uuid,uuid,text,text,uuid)'::regprocedure))>0
);
