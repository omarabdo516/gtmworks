select json_build_object(
 'states_for_people',has_function_privilege('authenticated','public.agent_states(uuid)','execute')
  and not has_function_privilege('anon','public.agent_states(uuid)','execute')
  and not has_function_privilege('service_role','public.agent_states(uuid)','execute'),
 'states_shape',pg_get_function_result('public.agent_states(uuid)'::regprocedure)='TABLE(agent uuid, running boolean, waiting_mine boolean)',
 'states_invoker',(select not prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.agent_states(uuid)'::regprocedure),
 'states_shared_rule',position('waiting_list' in pg_get_functiondef('public.agent_states(uuid)'::regprocedure))>0
  and position('agent_open_run' in pg_get_functiondef('public.agent_states(uuid)'::regprocedure))>0
  and position('can_see_agent' in pg_get_functiondef('public.agent_states(uuid)'::regprocedure))>0
);
