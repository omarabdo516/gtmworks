-- The team's rules go to each Agent's SOUL.md through the worker's list, and no Run is told them.
select json_build_object(
 'runs_pin_no_rules',position('agent_rules_in_force' in pg_get_functiondef('public.pin_run(uuid,uuid,jsonb)'::regprocedure))=0
  and public.agent_rules_in_force(gen_random_uuid())='{}'::text[],
 'per_person_rules_gone',to_regprocedure('public.agent_rules_in_force(uuid,uuid)') is null,
 'worker_lists_rules',has_function_privilege('service_role','public.agent_soul_rules_work()','execute')
  and (select bool_and(not has_function_privilege(r,'public.agent_soul_rules_work()','execute')) from unnest(array['anon','authenticated']) r)
);
