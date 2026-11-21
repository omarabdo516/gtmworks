-- #167: a request to open a hidden Agent is read-only to people and read only by those who may open it; the worker keeps
-- the card, its person presses it, an Owner or a Manager answers it; the helpers are no one's to call. The main Agent's
-- Member runs are offered ask_to_open_agent, and the Owners' and Managers' list derives each asked request.
select json_build_object(
 'requests_read_only',(select relrowsecurity from pg_class where oid='public.agent_access_requests'::regclass)
  and has_table_privilege('authenticated','public.agent_access_requests','select')
  and not has_table_privilege('authenticated','public.agent_access_requests','insert,update,delete')
  and not has_table_privilege('anon','public.agent_access_requests','select,insert,update,delete')
  and not has_table_privilege('service_role','public.agent_access_requests','select,insert,update,delete')
  and position('can_open_agent_for' in (select qual from pg_policies where tablename='agent_access_requests' and policyname='agent_access_requests_read'))>0,
 'worker_keeps_member_presses_team_answers',has_function_privilege('service_role','public.agent_ask_to_open(uuid,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.agent_ask_to_open(uuid,text,text,text)','execute')
  and not has_function_privilege('anon','public.agent_ask_to_open(uuid,text,text,text)','execute')
  and has_function_privilege('authenticated','public.press_agent_access(uuid,uuid,bigint,boolean)','execute')
  and not has_function_privilege('anon','public.press_agent_access(uuid,uuid,bigint,boolean)','execute')
  and not has_function_privilege('service_role','public.press_agent_access(uuid,uuid,bigint,boolean)','execute')
  and has_function_privilege('authenticated','public.answer_agent_access(uuid,bigint,boolean)','execute')
  and not has_function_privilege('anon','public.answer_agent_access(uuid,bigint,boolean)','execute')
  and not has_function_privilege('service_role','public.answer_agent_access(uuid,bigint,boolean)','execute')
  and has_function_privilege('authenticated','public.conversation_agent_access(uuid)','execute')
  and not has_function_privilege('anon','public.conversation_agent_access(uuid)','execute'),
 'helpers_private',(select bool_and(not has_function_privilege(r,'public.may_open_agent_for(uuid,uuid,uuid,uuid)','execute')
   and not has_function_privilege(r,'public.agent_access_named(uuid,uuid,uuid)','execute')
   and not has_function_privilege(r,'public.agents_hidden_from(uuid,uuid)','execute')
   and not has_function_privilege(r,'public.may_ask_to_open_agents(uuid,uuid,uuid)','execute')) from unnest(array['anon','authenticated','service_role']) r),
 'members_offered_ask',position('ask_to_open_agent' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0
  and position('propose_change' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0
  and position('''hidden''' in pg_get_functiondef('public.pin_lead_brief(uuid,uuid)'::regprocedure))>0,
 'waiting_derived',position('agent_access_requests' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('agent_change_proposals' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0,
 'logged',public.log_agent_action('AGENT_OPENED_FOR')='agent_opened_for' and public.log_agent_action('AGENT_KEPT_HIDDEN')='agent_kept_hidden'
);
