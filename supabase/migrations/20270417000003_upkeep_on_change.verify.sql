-- #772: every profile's rules are listed for the worker alone.
select json_build_object(
 'worker_only',has_function_privilege('service_role','public.agent_soul_rules_all()','execute')
  and not has_function_privilege('authenticated','public.agent_soul_rules_all()','execute'),
 'no_limit',position('limit' in pg_get_functiondef('public.agent_soul_rules_all()'::regprocedure))=0
);
