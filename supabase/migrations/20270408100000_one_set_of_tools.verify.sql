-- #391, ADR 0023: the first step of removing Agent levels only adds. Every profile has its confirmation, the worker's
-- writers of it and its health list with the sub-agents switch are there and the worker's alone, and nothing an install
-- reads before the cutover was taken away: past level changes still read from the Company's log.
select json_build_object(
 'profiles_confirm_the_fixed_set',exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_profiles' and column_name='tools_confirmed')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_profiles' and column_name='tools_confirmed'),
 'the_worker_records_the_read_back',to_regprocedure('public.record_company_profile(uuid,text,boolean)') is not null
  and to_regprocedure('public.record_agent_profile(uuid,text,boolean)') is not null
  and to_regprocedure('public.begin_profile_tools(text)') is not null
  and to_regprocedure('public.record_profile_tools(text,boolean)') is not null,
 'health_reads_the_sub_agents_choice',position('subagents' in pg_get_function_result('public.engine_tools_due()'::regprocedure))>0,
 'lead_makes_an_agent',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='lead_create_agent'),
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.record_company_profile(uuid,text,boolean)','public.record_agent_profile(uuid,text,boolean)',
   'public.begin_profile_tools(text)','public.record_profile_tools(text,boolean)','public.engine_tools_due()']) f),
 'past_level_changes_still_read',position('agent_level_changed' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0
);
