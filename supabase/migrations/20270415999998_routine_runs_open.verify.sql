-- #699: the worker alone keeps which Routines run now; no Member reads them; the state read counts them as working.
select json_build_object(
 'worker_only',has_function_privilege('service_role','public.keep_running_routines(uuid,text,uuid,jsonb)','execute')
  and not has_function_privilege('authenticated','public.keep_running_routines(uuid,text,uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.keep_running_routines(uuid,text,uuid,jsonb)','execute'),
 'no_member_reads',not has_table_privilege('authenticated','public.routine_runs_open','select')
  and not has_table_privilege('anon','public.routine_runs_open','select'),
 'rls',(select relrowsecurity from pg_class where oid='public.routine_runs_open'::regclass),
 'facts_read_it',(select prosecdef and position('routine_runs_open' in pg_get_functiondef(oid))>0
  from pg_proc where oid='public.agent_run_facts(uuid,uuid)'::regprocedure),
 'facts_inside',not has_function_privilege('authenticated','public.agent_run_facts(uuid,uuid)','execute')
);
