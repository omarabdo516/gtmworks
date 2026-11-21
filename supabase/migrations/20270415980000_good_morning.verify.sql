-- #183: the worker alone records a morning and opens its Conversations; a Member reads the results of the Agents they see.
select json_build_object(
 'worker_only',has_function_privilege('service_role','public.record_good_morning(uuid,uuid,text,date,timestamptz,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.record_good_morning(uuid,uuid,text,date,timestamptz,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.good_morning_work()','execute')
  and not has_function_privilege('authenticated','public.good_morning_agents(uuid)','execute'),
 'waits_under_member_policies',(select r.rolname='authenticated' and not r.rolbypassrls from pg_proc f join pg_roles r on r.oid=f.proowner where f.oid='public.good_morning_waits(uuid)'::regprocedure)
  and not has_function_privilege('authenticated','public.good_morning_waits(uuid)','execute')
  and not has_schema_privilege('authenticated','public','create'),
 'results_by_agent',exists(select 1 from pg_policies where schemaname='public' and tablename='good_morning_results' and qual like '%can_see_agent%'),
 'one_morning_a_member',exists(select 1 from pg_indexes where schemaname='public' and indexname='conversations_one_good_morning'),
 'rls',(select bool_and(relrowsecurity) from pg_class where relnamespace='public'::regnamespace and relname in ('good_mornings','good_morning_results'))
);
