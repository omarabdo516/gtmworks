-- An Agent's settings save is checked and logged by the database, and no signed-out or service caller reaches either.
select json_build_object(
 'check_for_members',has_function_privilege('authenticated','public.check_agent_setting(uuid,uuid)','execute'),
 'log_for_members',has_function_privilege('authenticated','public.log_agent_setting(uuid,uuid,text,text,text)','execute'),
 'check_private',not has_function_privilege('anon','public.check_agent_setting(uuid,uuid)','execute'),
 'log_private',not has_function_privilege('anon','public.log_agent_setting(uuid,uuid,text,text,text)','execute')
);
