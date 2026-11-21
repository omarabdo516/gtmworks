-- A memory or skill change is held by the signed-in person, logged once or dropped by them, and a record they never came
-- back to is logged by the worker's pass alone; nobody reads the held records directly.
select json_build_object(
 'hold_for_members',has_function_privilege('authenticated','public.hold_agent_change(uuid,uuid,text,text,text,text)','execute'),
 'log_for_members',has_function_privilege('authenticated','public.finish_agent_change(uuid)','execute'),
 'drop_for_members',has_function_privilege('authenticated','public.drop_agent_change(uuid)','execute'),
 'pass_for_worker',has_function_privilege('service_role','public.finish_held_agent_changes()','execute'),
 'pass_not_for_members',not has_function_privilege('authenticated','public.finish_held_agent_changes()','execute'),
 'records_private',not has_table_privilege('authenticated','public.held_agent_changes','select')
);
