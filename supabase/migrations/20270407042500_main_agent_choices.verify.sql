-- #425: the main Agent on its Company's `co-` profile is choosable. Its choices live with that profile's record (three
-- additive columns), every existing install's keeper on its `co-` profile is choosable with no choice yet, and the
-- writers and the worker's list reach it.
select json_build_object(
 'choices_additive',(select count(*)=3 from information_schema.columns where table_schema='public' and table_name='company_profiles'
  and column_name in ('model_choice','subagents','learning_mode_choice')),
 'choices_shaped',(select count(*)=2 from pg_constraint where conrelid='public.company_profiles'::regclass
  and conname in ('company_profiles_model_choice_shape','company_profiles_learning_mode_choice_shape')),
 'keeper_choosable',position('else public.keeps_profile_alone(c,a.id) end' in pg_get_functiondef('public.company_agent_models(uuid)'::regprocedure))>0,
 -- Every existing main Agent that keeps its Company's profile is choosable, by the rule company_agent_models reads.
 'existing_keepers_choosable',not exists(select 1 from public.company_profiles p
  join public.hermes_agents a on a.id=public.company_profile_keeper(p.company_id) and a.profile=p.profile
  left join public.agent_profiles g on g.agent_id=a.id and g.company_id=p.company_id
  where not coalesce(case when g.agent_id is not null then g.profile=a.profile else public.keeps_profile_alone(p.company_id,a.id) end,false)
   and not exists(select 1 from public.hermes_agents o where o.company_id=p.company_id and o.id<>a.id and o.profile=p.profile)),
 'writers_reach_keeper',position('keeps_profile_alone' in pg_get_functiondef('public.set_agent_model(uuid,text)'::regprocedure))>0
  and position('keeps_profile_alone' in pg_get_functiondef('public.set_agent_subagents(uuid,boolean)'::regprocedure))>0
  and position('keeps_profile_alone' in pg_get_functiondef('public.set_agent_learning_mode(uuid,text)'::regprocedure))>0,
 'keeper_private',not has_function_privilege('authenticated','public.is_profile_keeper(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.keeps_profile_alone(uuid,uuid)','execute'),
 'worker_carries_switch',position('subagents boolean' in pg_get_function_result('public.company_profile_work()'::regprocedure))>0,
 'worker_list_private',not has_function_privilege('authenticated','public.company_profile_work()','execute'),
 'record_checks_switch',position('companyProfileChanged' in pg_get_functiondef('public.record_company_profile(uuid,text,boolean)'::regprocedure))>0
);
