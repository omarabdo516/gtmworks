-- The one state read (#699): signed-in people call it and the two marks, as the reader; the marks table is read and
-- written by those functions only; the Runs' facts stay inside; the previous release's agent_states is still there.
-- The worker alone keeps which Routines run now; no Member reads them, and the state read counts them as working.
select json_build_object(
 'states_for_people',has_function_privilege('authenticated','public.agent_face_states(uuid)','execute')
  and not has_function_privilege('anon','public.agent_face_states(uuid)','execute')
  and not has_function_privilege('service_role','public.agent_face_states(uuid)','execute'),
 'states_as_reader',(select not prosecdef and 'search_path=""'=any(proconfig) and position('waiting_list' in pg_get_functiondef(oid))>0
  from pg_proc where oid='public.agent_face_states(uuid)'::regprocedure),
 'work_for_the_reader',(select prosecdef and position('can_see_agent' in pg_get_functiondef(oid))>0 and position('auth.uid()' in pg_get_functiondef(oid))>0
  from pg_proc where oid='public.agent_work(uuid)'::regprocedure),
 'run_facts_inside',not has_function_privilege('authenticated','public.agent_run_facts(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.agent_run_facts(uuid,uuid)','execute'),
 'marks_for_people',has_function_privilege('authenticated','public.see_agent_failure(uuid,uuid,uuid,bigint)','execute')
  and has_function_privilege('authenticated','public.wake_agent(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.wake_agent(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.see_agent_failure(uuid,uuid,uuid,bigint)','execute'),
 'marks_closed',(select relrowsecurity from pg_class where oid='public.agent_reader_marks'::regclass)
  and not has_table_privilege('authenticated','public.agent_reader_marks','select')
  and not has_table_privilege('authenticated','public.agent_reader_marks','insert')
  and not has_table_privilege('service_role','public.agent_reader_marks','select'),
 'previous_read_kept',pg_get_function_result('public.agent_states(uuid)'::regprocedure)='TABLE(agent uuid, running boolean, waiting_mine boolean)',
 'routines_worker_only',has_function_privilege('service_role','public.keep_running_routines(uuid,text,uuid,jsonb)','execute')
  and not has_function_privilege('authenticated','public.keep_running_routines(uuid,text,uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.keep_running_routines(uuid,text,uuid,jsonb)','execute'),
 'routines_no_member_reads',not has_table_privilege('authenticated','public.routine_runs_open','select')
  and not has_table_privilege('anon','public.routine_runs_open','select'),
 'routines_rls',(select relrowsecurity from pg_class where oid='public.routine_runs_open'::regclass),
 'facts_read_routines',(select prosecdef and position('routine_runs_open' in pg_get_functiondef(oid))>0
  from pg_proc where oid='public.agent_run_facts(uuid,uuid)'::regprocedure),
 'facts_inside',not has_function_privilege('authenticated','public.agent_run_facts(uuid,uuid)','execute')
);
