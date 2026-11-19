-- An Agent's memory is reset by the Owner alone, and each reset is one row of the Company log.
select json_build_object(
 'check_for_members',has_function_privilege('authenticated','public.check_memory_reset(uuid,uuid)','execute'),
 'log_for_members',has_function_privilege('authenticated','public.log_memory_reset(uuid,uuid)','execute'),
 'log_writer_private',not has_function_privilege('authenticated','public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)','execute')
);
