-- One shared Skills folder per Company (#122, ADR 0016): the space record is closed to every client, its name is
-- derived from the Company, neither table lets a Connection or an Agent name a space, every Run entry and the move wait
-- for a confirmed shared folder while a worker that confirms them runs, a lost profile is confirmed again, and only the worker lists, records and forgets.
select json_build_object(
 'spaces_closed',(select relrowsecurity from pg_class where oid='public.company_shared_spaces'::regclass)
  and (select bool_and(not has_table_privilege(r,'public.company_shared_spaces','select,insert,update,delete,truncate')) from unnest(array['anon','authenticated','service_role']) r),
 'space_derived',public.shared_space_profile('10000000-0000-0000-0000-000000000001')='cs-10000000000000000000000000000001'
  and (select attgenerated='s' from pg_attribute where attrelid='public.company_shared_spaces'::regclass and attname='profile'),
 'one_space_per_company',exists(select 1 from pg_constraint where conrelid='public.company_shared_spaces'::regclass and contype='p'
  and conkey=array[(select attnum from pg_attribute where attrelid='public.company_shared_spaces'::regclass and attname='company_id')]),
 'unconfirmed_by_default',(select count(*)=2 and bool_and(a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false') from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attname='skills_shared' and not a.attisdropped and a.attrelid in ('public.company_profiles'::regclass,'public.agent_profiles'::regclass)),
 'guarded_both_tables',exists(select 1 from pg_trigger where tgrelid='public.hermes_connections'::regclass and tgname='shared_space_connection' and tgenabled='O')
  and exists(select 1 from pg_trigger where tgrelid='public.hermes_agents'::regclass and tgname='shared_space_agent' and tgenabled='O'),
 'runs_wait_for_shared_folder',position('skills_shared' in pg_get_functiondef('public.company_profile_ready(uuid)'::regprocedure))>0
  and (select bool_and(position(t in pg_get_functiondef('public.agent_profile_refusal(text,uuid,uuid)'::regprocedure))>0) from unnest(array['skills_shared','^cs-[0-9a-f]{32}$']) t),
 'move_waits_for_shared_folder',position('skills_shared' in pg_get_functiondef('public.move_agent_profile(uuid)'::regprocedure))>0,
 'wait_only_with_a_live_worker',(select bool_and(position('shared_skills_active(' in pg_get_functiondef(f))>0) from unnest(array['public.company_profile_ready(uuid)'::regprocedure,
   'public.agent_profile_refusal(text,uuid,uuid)'::regprocedure,'public.move_agent_profile(uuid)'::regprocedure]) f)
  and position('seen_at=now()' in pg_get_functiondef('public.shared_skills_work()'::regprocedure))>0,
 'lost_profile_confirmed_again',position('skills_shared=false' in pg_get_functiondef('public.forget_company_profile(uuid)'::regprocedure))>0,
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.shared_skills_work()','public.record_shared_space(uuid,text)','public.record_shared_skills(uuid,text)','public.forget_shared_space(uuid)']) f),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.shared_space_profile(uuid)','public.shared_skills_active(uuid)','public.guard_shared_space_connection()','public.guard_shared_space_agent()']) f)
);
