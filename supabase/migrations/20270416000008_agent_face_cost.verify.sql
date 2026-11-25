-- #754: the state read and the waiting list keep their plans between calls (PL/pgSQL, generic from the second call), the state read stays as the
-- reader over their own waiting list, agent_work stays the reader's and inside, and agent_run_facts, read no more, stays closed.
select json_build_object(
 'plans_kept',(select bool_and(l.lanname='plpgsql' and 'plan_cache_mode=force_generic_plan'=any(p.proconfig)) from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid in ('public.agent_face_states(uuid)'::regprocedure,'public.agent_work(uuid)'::regprocedure,'public.waiting_list(uuid)'::regprocedure)),
 'states_as_reader',(select not prosecdef and position('waiting_list' in pg_get_functiondef(oid))>0
  from pg_proc where oid='public.agent_face_states(uuid)'::regprocedure),
 'waiting_as_reader',(select not prosecdef from pg_proc where oid='public.waiting_list(uuid)'::regprocedure),
 'work_for_the_reader',(select prosecdef and position('can_see_agent' in pg_get_functiondef(oid))>0
  and position('auth.uid()' in pg_get_functiondef(oid))>0 from pg_proc where oid='public.agent_work(uuid)'::regprocedure),
 'reads_for_people',has_function_privilege('authenticated','public.agent_face_states(uuid)','execute')
  and has_function_privilege('authenticated','public.waiting_list(uuid)','execute')
  and not has_function_privilege('anon','public.agent_face_states(uuid)','execute')
  and not has_function_privilege('anon','public.agent_work(uuid)','execute')
  and not has_function_privilege('anon','public.waiting_list(uuid)','execute'),
 'run_facts_closed',not has_function_privilege('authenticated','public.agent_run_facts(uuid,uuid)','execute')
  and position('agent_run_facts' in pg_get_functiondef('public.agent_work(uuid)'::regprocedure))=0
);
