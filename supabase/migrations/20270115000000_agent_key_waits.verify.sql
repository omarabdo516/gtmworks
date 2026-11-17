-- A later Agent waits for the key on its own profile (#299): the waits are the Owner's to read and the database's to
-- write, a removed Agent's profile is kept by name for no client, the one lead_create_agent still answers the previous
-- app version's call and records the wait, every Run entry holds a waiting Agent, the Owner's list shows it, only an
-- active Owner ends a wait, and a removed Agent's profile is listed for the next key removal.
select json_build_object(
 'waits_owner_read_only',(select relrowsecurity from pg_class where oid='public.agent_key_waits'::regclass)
  and has_table_privilege('authenticated','public.agent_key_waits','select')
  and not has_table_privilege('authenticated','public.agent_key_waits','insert,update,delete')
  and not has_table_privilege('anon','public.agent_key_waits','select,insert,update,delete')
  and not has_table_privilege('service_role','public.agent_key_waits','select,insert,update,delete')
  and exists(select 1 from pg_policy where polrelid='public.agent_key_waits'::regclass and polcmd='r' and position('is_company_owner' in pg_get_expr(polqual,polrelid))>0),
 'waits_go_with_agent',exists(select 1 from pg_constraint where conrelid='public.agent_key_waits'::regclass and conname='agent_key_waits_agent'
  and confrelid='public.hermes_agents'::regclass and confdeltype='c'),
 'leftovers_closed',(select relrowsecurity from pg_class where oid='public.agent_profile_leftovers'::regclass)
  and (select bool_and(not has_table_privilege(r,'public.agent_profile_leftovers','select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r)
  and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_profile_leftovers' and column_name ~ '(key|secret|value)'),
 'one_create',(select pronargs=11 and pronargs-pronargdefaults=6 from pg_proc where oid='public.lead_create_agent'::regproc)
  and position('agent_key_waits' in pg_get_functiondef('public.lead_create_agent'::regproc))>0
  and position('company_holds_provider_key' in pg_get_functiondef('public.lead_create_agent'::regproc))>0
  and has_function_privilege('service_role','public.lead_create_agent'::regproc,'execute')
  and not has_function_privilege('authenticated','public.lead_create_agent'::regproc,'execute')
  and not has_function_privilege('anon','public.lead_create_agent'::regproc,'execute'),
 'runs_held',position('agent_key_waits' in pg_get_functiondef('public.agent_profile_refusal(text,uuid,uuid)'::regprocedure))>0,
 'owner_sees_it',position('''agent_key''' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('''question''' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and pg_get_function_result('public.waiting_list(uuid)'::regprocedure)='TABLE(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamp with time zone)',
 'owner_ends_waits',has_function_privilege('authenticated','public.end_agent_key_waits(uuid,text[])','execute')
  and not has_function_privilege('anon','public.end_agent_key_waits(uuid,text[])','execute')
  and not has_function_privilege('service_role','public.end_agent_key_waits(uuid,text[])','execute')
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.end_agent_key_waits(uuid,text[])'::regprocedure)
  and position('is_company_owner(c)' in pg_get_functiondef('public.end_agent_key_waits(uuid,text[])'::regprocedure))>0,
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.company_holds_provider_key(uuid)','public.keep_agent_profile_leftover()']) f),
 'removal_keeps_profile',exists(select 1 from pg_trigger where tgrelid='public.hermes_agents'::regclass and tgname='agent_profile_leftover' and tgenabled='O'
  and tgtype & 2=2 and tgtype & 8=8),
 'removed_listed',position('agent_profile_leftovers' in pg_get_functiondef('public.company_key_profiles(uuid)'::regprocedure))>0
  and position('is_member(c)' in pg_get_functiondef('public.company_key_profiles(uuid)'::regprocedure))>0
);
