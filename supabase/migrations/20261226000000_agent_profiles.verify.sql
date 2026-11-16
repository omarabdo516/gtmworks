-- An Agent's own profile (#120, ADR 0016): its owner record is closed to every client, its name is derived from the
-- Agent, it lives and dies with its Agent, both tables refuse a Connection or an Agent it does not name, every Run entry
-- checks it, the Company's work leaves it alone, and one lead_create_agent still makes every Agent.
select json_build_object(
 'owner_record_closed',(select relrowsecurity from pg_class where oid='public.agent_profiles'::regclass)
  and not has_table_privilege('authenticated','public.agent_profiles','select,insert,update,delete')
  and not has_table_privilege('anon','public.agent_profiles','select,insert,update,delete')
  and not has_table_privilege('service_role','public.agent_profiles','select,insert,update,delete'),
 'profile_derived',public.agent_engine_profile('a0000000-0000-0000-0000-000000000001')='ag-a0000000000000000000000000000001'
  and (select attgenerated='s' from pg_attribute where attrelid='public.agent_profiles'::regclass and attname='profile'),
 'one_name_per_call',public.lead_agent_id('e1000000-0000-0000-0000-000000000001','run:1','2')<>public.lead_agent_id('e1000000-0000-0000-0000-000000000001','run','1:2'),
 'record_tied_to_agent',exists(select 1 from pg_constraint where conrelid='public.agent_profiles'::regclass and conname='agent_profiles_agent'
  and confrelid='public.hermes_agents'::regclass and condeferrable and condeferred and confdeltype='c'),
 'guarded_both_tables',exists(select 1 from pg_trigger where tgrelid='public.hermes_connections'::regclass and tgname='agent_profile_connection' and tgenabled='O')
  and exists(select 1 from pg_trigger where tgrelid='public.hermes_agents'::regclass and tgname='agent_profile_agent' and tgenabled='O'),
 'every_run_entry_checks',(select bool_and(position('agent_profile_refusal' in pg_get_functiondef(f::regprocedure))>0) from unnest(array[
  'public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','public.claim_conversation_turn(uuid)','public.begin_channel_start(bigint)','public.begin_note_start(bigint)']) f),
 'ready_needs_level_policy_confirmation',(select bool_and(position(t in pg_get_functiondef('public.agent_profile_refusal(text,uuid,uuid)'::regprocedure))>0)
  from unnest(array['agent_level','engine_tool_policy','tools_pending']) t),
 'company_work_leaves_agent_profiles',(select bool_and(position('^ag-[0-9a-f]{32}$' in pg_get_functiondef(f::regprocedure))>0) from unnest(array[
  'public.company_profile_work()','public.move_company_profile(uuid,text,text,text,text[])']) f),
 'forget_covers_agent_profiles',position('agent_profiles' in pg_get_functiondef('public.forget_company_profile(uuid)'::regprocedure))>0,
 'one_create',(select pronargs-pronargdefaults=6 from pg_proc where oid='public.lead_create_agent'::regproc)
  and position('agent_profiles' in pg_get_functiondef('public.lead_create_agent'::regproc))>0
  and position('lead_agent_id' in pg_get_functiondef('public.lead_create_agent'::regproc))>0,
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer)','public.lead_agent_profile(uuid,text,text,text)',
   'public.agent_profile_work()','public.begin_agent_tools(uuid)','public.record_agent_profile(uuid,text,integer,integer)']) f),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.lead_agent_id(uuid,text,text)','public.agent_engine_profile(uuid)','public.agent_profile_refusal(text,uuid,uuid)',
   'public.guard_agent_profile_connection()','public.guard_agent_profile_agent()']) f)
);
