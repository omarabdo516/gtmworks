-- #176: the Owner-only check of an Agent's standing instructions is reachable by a signed-in Member and by no other caller.
select json_build_object(
 'check_for_members',has_function_privilege('authenticated','public.check_agent_owner_setting(uuid,uuid)','execute'),
 'log_for_members',has_function_privilege('authenticated','public.log_agent_instructions(uuid,uuid)','execute'),
 'check_private',not has_function_privilege('anon','public.check_agent_owner_setting(uuid,uuid)','execute'),
 'log_private',not has_function_privilege('anon','public.log_agent_instructions(uuid,uuid)','execute')
);
