-- A request is read-only to people and written only by the two functions that keep and answer it; its answer cannot be
-- half-written. The worker keeps a request and an Owner answers it; the helpers are no one's to call. Lead's Member runs
-- are offered request_agent; «Make it» goes through the one lead_create_agent; the Owners' list derives each request; a
-- request's private log rows are the asker's and the Owners'.
select json_build_object(
 'requests_read_only',(select relrowsecurity from pg_class where oid='public.lead_agent_requests'::regclass)
  and has_table_privilege('authenticated','public.lead_agent_requests','select')
  and not has_table_privilege('authenticated','public.lead_agent_requests','insert,update,delete')
  and not has_table_privilege('anon','public.lead_agent_requests','select,insert,update,delete')
  and not has_table_privilege('service_role','public.lead_agent_requests','select,insert,update,delete')
  and position('is_company_owner' in (select qual from pg_policies where tablename='lead_agent_requests' and policyname='lead_agent_requests_read'))>0,
 'answer_whole',(select count(*)=2 from pg_constraint where conrelid='public.lead_agent_requests'::regclass and conname in ('lead_agent_requests_fields','lead_agent_requests_answer'))
  and exists(select 1 from pg_constraint where conrelid='public.lead_agent_requests'::regclass and contype='u'),
 'worker_keeps_owner_answers',has_function_privilege('service_role','public.lead_request_agent(uuid,text,text,text,text,text[],text,text)','execute')
  and not has_function_privilege('authenticated','public.lead_request_agent(uuid,text,text,text,text,text[],text,text)','execute')
  and not has_function_privilege('anon','public.lead_request_agent(uuid,text,text,text,text,text[],text,text)','execute')
  and has_function_privilege('authenticated','public.answer_agent_request(uuid,bigint,boolean,text)','execute')
  and not has_function_privilege('anon','public.answer_agent_request(uuid,bigint,boolean,text)','execute')
  and not has_function_privilege('service_role','public.answer_agent_request(uuid,bigint,boolean,text)','execute'),
 'helpers_private',(select bool_and(not has_function_privilege(r,'public.is_company_lead(uuid,uuid)','execute')
   and not has_function_privilege(r,'public.may_ask_lead_for_agents(uuid,uuid,uuid)','execute')
   and not has_function_privilege(r,'public.agent_fields_valid(text,text,text[],text,text)','execute')) from unnest(array['anon','authenticated','service_role']) r),
 'members_offered_request',position('may_ask_lead_for_agents' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0
  and position('may_suggest_agent_rules' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0,
 'made_by_the_one_create',position('lead_agent_requests' in pg_get_functiondef('public.lead_create_agent'::regproc))>0
  and position('lead_create_agent' in pg_get_functiondef('public.answer_agent_request(uuid,bigint,boolean,text)'::regprocedure))>0,
 'waiting_derived',position('lead_agent_requests' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and pg_get_function_result('public.waiting_list(uuid)'::regprocedure)='TABLE(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamp with time zone)',
 'logged_for_asker_and_owners',position('''owners''' in (select qual from pg_policies where tablename='company_log' and policyname='company_log_read'))>0
  and public.log_agent_action('AGENT_REQUEST_SENT')='agent_request_sent' and public.log_agent_action('AGENT_REQUEST_MADE')='agent_request_made'
  and public.log_agent_action('AGENT_REQUEST_DECLINED')='agent_request_declined'
  and position('asked_for' in pg_get_functiondef('public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0
  and position('''reason''' in pg_get_functiondef('public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0
);
