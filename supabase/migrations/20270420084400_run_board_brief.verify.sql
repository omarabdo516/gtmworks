-- #844: every Agent's Run brief, with the board names it gives a job to as a Card, is pinned by the worker alone.
select json_build_object(
 'worker_only',has_function_privilege('service_role','public.pin_run_brief(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.pin_run_brief(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.pin_run_brief(uuid,uuid)','execute'),
 'board_names',position('''board''' in pg_get_functiondef('public.pin_run_brief(uuid,uuid)'::regprocedure))>0
  and position('''self''' in pg_get_functiondef('public.pin_run_brief(uuid,uuid)'::regprocedure))>0
);
