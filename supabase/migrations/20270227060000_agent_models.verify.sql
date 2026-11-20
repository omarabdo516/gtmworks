-- Each Agent's model choice and sub-agents switch are additive, the policy is gone, members read the rows, and both
-- Owner writes check the Owner in the database while the worker's list stays private.
select json_build_object(
 'columns_additive',(select count(*)=2 from information_schema.columns
  where table_schema='public' and table_name='agent_profiles' and column_name in ('model_choice','subagents')),
 'no_policy_copy',to_regprocedure('public.engine_tool_policy()') is null,
 'models_for_members',has_function_privilege('authenticated','public.company_agent_models(uuid)','execute'),
 'model_owner_checked',position('is_company_owner' in pg_get_functiondef('public.set_agent_model(uuid,text)'::regprocedure))>0,
 'subagents_owner_checked',position('is_company_owner' in pg_get_functiondef('public.set_agent_subagents(uuid,boolean)'::regprocedure))>0,
 'work_recorded_with_subagents',position('subagents_written' in pg_get_functiondef('public.record_agent_profile(uuid,text,boolean)'::regprocedure))>0,
 'work_list_private',not has_function_privilege('authenticated','public.agent_profile_work()','execute')
);
