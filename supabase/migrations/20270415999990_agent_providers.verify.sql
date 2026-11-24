-- #660: the waiting Agents' work and their release are the worker's alone.
select json_build_object(
 'work_worker_only',has_function_privilege('service_role','public.agent_key_wait_work()','execute')
  and not has_function_privilege('authenticated','public.agent_key_wait_work()','execute')
  and not has_function_privilege('anon','public.agent_key_wait_work()','execute'),
 'release_worker_only',has_function_privilege('service_role','public.release_agent_key_wait(uuid,text,bigint)','execute')
  and not has_function_privilege('authenticated','public.release_agent_key_wait(uuid,text,bigint)','execute')
  and not has_function_privilege('anon','public.release_agent_key_wait(uuid,text,bigint)','execute')
);
