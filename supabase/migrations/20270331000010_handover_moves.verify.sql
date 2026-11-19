-- #354: an Agent with an open handover leg may not be moved to another profile, so the leg's Run stays readable on the
-- profile it was started on. Both guards are the latest definitions of their functions, with the leg named; their grants
-- are unchanged.
select json_build_object(
 'agent_move_waits_for_its_leg',position('agent_handovers' in pg_get_functiondef('public.agent_move_blocked(uuid)'::regprocedure))>0
  and position('to_agent=agent' in pg_get_functiondef('public.agent_move_blocked(uuid)'::regprocedure))>0
  and position('from_agent=agent' in pg_get_functiondef('public.agent_move_blocked(uuid)'::regprocedure))>0,
 'company_move_waits_for_its_legs',position('agent_handovers' in pg_get_functiondef('public.move_company_profile(uuid)'::regprocedure))>0
  and has_function_privilege('service_role','public.move_company_profile(uuid)','execute')
  and not has_function_privilege('authenticated','public.move_company_profile(uuid)','execute'),
 'moves_stay_private',to_regprocedure('public.agent_move_blocked(uuid)') is not null
  and (select bool_and(not has_function_privilege(r,'public.agent_move_blocked(uuid)','execute'))
   from unnest(array['anon','authenticated','service_role']) r)
);
