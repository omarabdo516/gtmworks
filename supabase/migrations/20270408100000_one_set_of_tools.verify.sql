-- #391, ADR 0018: Agent levels are removed whole. The Company has no level column, no function changes it, and the
-- database keeps no copy of the tool policy; a profile records only that the worker confirmed exactly the fixed set
-- every Agent gets. Past level changes still read from the Company's log, and no grant was widened by the removal.
select json_build_object(
 'no_company_level',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='agent_level')
  and to_regclass('public.companies') is not null,
 'no_level_function',to_regprocedure('public.set_agent_level(uuid,integer)') is null,
 'no_policy_copy',to_regprocedure('public.engine_tool_policy()') is null
  and not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and prosrc ~ '\mengine_tool_policy\M'),
 'no_profile_levels',not exists(select 1 from information_schema.columns
  where table_schema='public' and table_name in ('company_profiles','agent_profiles') and column_name in ('tools_level','tools_policy')),
 'profiles_confirm_the_fixed_set',not exists(select 1 from information_schema.columns
  where table_schema='public' and table_name in ('company_profiles','agent_profiles') and column_name='tools_confirmed')
  is false
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_profiles' and column_name='tools_confirmed')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_profiles' and column_name='tools_confirmed'),
 'a_run_waits_for_the_fixed_set',position('tools_confirmed' in pg_get_functiondef('public.company_profile_ready(uuid)'::regprocedure))>0
  and position('tools_pending' in pg_get_functiondef('public.company_profile_ready(uuid)'::regprocedure))>0
  and position('agentToolsPending' in pg_get_functiondef('public.agent_profile_refusal(text,uuid,uuid)'::regprocedure))>0
  and position('tools_confirmed' in pg_get_functiondef('public.agent_profile_refusal(text,uuid,uuid)'::regprocedure))>0
  and position('agentToolsPending' in pg_get_functiondef('public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)'::regprocedure))>0
  and position('agentToolsPending' in pg_get_functiondef('public.claim_conversation_turn(uuid)'::regprocedure))>0,
 'health_reads_the_sub_agents_choice',position('subagents' in pg_get_function_result('public.engine_tools_due()'::regprocedure))>0,
 'the_worker_records_the_read_back',position('tools_confirmed' in pg_get_functiondef('public.record_company_profile(uuid,text,boolean)'::regprocedure))>0
  and position('tools_confirmed' in pg_get_functiondef('public.record_agent_profile(uuid,text,boolean)'::regprocedure))>0
  and position('subagents_written' in pg_get_functiondef('public.record_agent_profile(uuid,text,boolean)'::regprocedure))>0
  and position('tools_pending' in pg_get_functiondef('public.begin_profile_tools(text)'::regprocedure))>0,
 'lead_makes_an_own_profile_without_a_level',position('own_level' in pg_get_functiondef('public.lead_create_agent(uuid,text,text,text,text,text[],text,text,boolean,boolean)'::regprocedure))=0
  and position('own_policy' in pg_get_functiondef('public.lead_create_agent(uuid,text,text,text,text,text[],text,text,boolean,boolean)'::regprocedure))=0
  and position('own_profile' in pg_get_functiondef('public.lead_create_agent(uuid,text,text,text,text,text[],text,text,boolean,boolean)'::regprocedure))>0
  and position('''level''' in pg_get_functiondef('public.lead_agent_profile(uuid,text,text,text)'::regprocedure))=0,
 'past_level_changes_still_read',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%agent_level_changed%'
  and position('agent_level_changed' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_audit' and column_name='old_level')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_audit' and column_name='new_level'),
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.company_profile_work()','public.agent_profile_work()','public.record_company_profile(uuid,text,boolean)',
   'public.record_agent_profile(uuid,text,boolean)','public.begin_profile_tools(text)','public.record_profile_tools(text,boolean)',
   'public.attach_company_profile(uuid)','public.move_company_profile(uuid)','public.engine_tools_due()',
   'public.forget_company_profile(text)','public.agent_move_work()','public.move_agent_profile(uuid)',
   'public.agent_soul_rules_work()','public.shared_skills_work()','public.record_shared_skills(uuid,text)',
   'public.lead_create_agent(uuid,text,text,text,text,text[],text,text,boolean,boolean)','public.lead_agent_profile(uuid,text,text,text)']) f),
 'person_entries_unchanged',has_function_privilege('authenticated','public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('service_role','public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','execute')
  and has_function_privilege('service_role','public.claim_conversation_turn(uuid)','execute')
  and not has_function_privilege('authenticated','public.claim_conversation_turn(uuid)','execute'),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.company_profile_ready(uuid)','public.agent_profile_refusal(text,uuid,uuid)']) f)
);
