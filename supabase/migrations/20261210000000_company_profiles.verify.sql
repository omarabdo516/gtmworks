-- The Company has no level and no function changes one; a past level change still reaches the Company's log. The worker
-- alone reads the profile work and writes profiles, moves and tool readings; a person reads only the sign-in target of a
-- Company they belong to. No new table is readable or writable by anyone directly.
select json_build_object(
 'no_company_level',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='agent_level'),
 'no_level_function',to_regprocedure('public.set_agent_level(uuid,integer)') is null
  and not exists(select 1 from pg_policies where schemaname='public' and tablename='companies' and cmd in ('UPDATE','ALL')),
 'level_logged',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%agent_level_changed%'
  and position('agent_level_changed' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0,
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.company_profile_work()','public.record_company_profile(uuid,text,boolean)','public.attach_company_profile(uuid)',
   'public.move_company_profile(uuid)','public.engine_tools_due()','public.forget_company_profile(text)']) f),
 'person_reads',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.company_engine_target(uuid)']) f),
 'internal_helpers',(select bool_and(not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('service_role',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.company_engine_profile(uuid)','public.company_profile_ready(uuid)']) f),
 'tables_closed',(select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.company_profiles'::regclass))
  and not has_table_privilege('authenticated','public.company_profiles','select') and not has_table_privilege('service_role','public.company_profiles','insert'),
 'profile_name',public.company_engine_profile('10000000-0000-0000-0000-000000000002')='co-10000000000000000000000000000002',
 'sign_in_members_only',position('is_member(c)' in pg_get_functiondef('public.company_engine_target(uuid)'::regprocedure))>0
);
