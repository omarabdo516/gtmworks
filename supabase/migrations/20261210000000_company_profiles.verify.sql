-- Every Company has a level from 1 to 3; only an Owner changes it, through the one checked function, and each change
-- reaches the Company's log. The worker alone reads the profile work and writes profiles, moves and tool readings; a
-- person reads only the Owner's warning and the sign-in target of a Company they belong to. No new table is readable
-- or writable by anyone directly.
select json_build_object(
 'every_company_has_a_level',not exists(select 1 from public.companies where agent_level is null or agent_level not between 1 and 3),
 'new_companies_start_at_one',(select column_default from information_schema.columns where table_schema='public' and table_name='companies' and column_name='agent_level')='1',
 'level_owner_only',has_function_privilege('authenticated','public.set_agent_level(uuid,integer)','execute')
  and not has_function_privilege('anon','public.set_agent_level(uuid,integer)','execute')
  and not has_function_privilege('service_role','public.set_agent_level(uuid,integer)','execute')
  and position('is_company_owner' in pg_get_functiondef('public.set_agent_level(uuid,integer)'::regprocedure))>0
  and not exists(select 1 from pg_policies where schemaname='public' and tablename='companies' and cmd in ('UPDATE','ALL')),
 'level_logged',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%agent_level_changed%'
  and position('agent_level_changed' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0,
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.company_profile_work()','public.record_company_profile(uuid,text,integer,integer)','public.attach_company_profile(uuid,text,text,text,text[])',
   'public.move_company_profile(uuid,text,text,text,text[])','public.engine_tools_due()','public.record_engine_tools(uuid,text[])','public.forget_company_profile(uuid)']) f),
 'person_reads',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.agent_tool_warning(uuid)','public.company_engine_target(uuid)']) f),
 'internal_helpers',(select bool_and(not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('service_role',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.company_engine_profile(uuid)','public.is_bundled_connection(uuid)','public.company_profile_ready(uuid)']) f),
 'tables_closed',(select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.company_profiles'::regclass,'public.engine_tool_checks'::regclass))
  and not has_table_privilege('authenticated','public.company_profiles','select') and not has_table_privilege('service_role','public.company_profiles','insert')
  and not has_table_privilege('authenticated','public.engine_tool_checks','select') and not has_table_privilege('service_role','public.engine_tool_checks','insert'),
 'profile_name',public.company_engine_profile('10000000-0000-0000-0000-000000000002')='co-10000000000000000000000000000002',
 'warning_owner_only',position('is_company_owner(c)' in pg_get_functiondef('public.agent_tool_warning(uuid)'::regprocedure))>0,
 'sign_in_members_only',position('is_member(c)' in pg_get_functiondef('public.company_engine_target(uuid)'::regprocedure))>0
);
