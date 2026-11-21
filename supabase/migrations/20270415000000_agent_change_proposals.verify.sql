-- #19: a proposal is read-only to people and written only by the two functions that keep and answer it; a refused one
-- waits on nobody and only a listed change ever waits. The worker keeps a proposal and an Owner answers it; the helpers
-- are no one's to call. Every Agent's Member runs are offered propose_change, and the Owners' list derives each waiting
-- proposal.
select json_build_object(
 'proposals_read_only',(select relrowsecurity from pg_class where oid='public.agent_change_proposals'::regclass)
  and has_table_privilege('authenticated','public.agent_change_proposals','select')
  and not has_table_privilege('authenticated','public.agent_change_proposals','insert,update,delete')
  and not has_table_privilege('anon','public.agent_change_proposals','select,insert,update,delete')
  and not has_table_privilege('service_role','public.agent_change_proposals','select,insert,update,delete')
  and position('is_company_owner' in (select qual from pg_policies where tablename='agent_change_proposals' and policyname='agent_change_proposals_read'))>0,
 'only_listed_waits',exists(select 1 from pg_constraint where conrelid='public.agent_change_proposals'::regclass and conname='agent_change_proposals_listed')
  and exists(select 1 from pg_constraint where conrelid='public.agent_change_proposals'::regclass and conname='agent_change_proposals_answered')
  and public.agent_change_listed('model',null) and public.agent_change_listed('toolset','delegation') and not public.agent_change_listed('toolset','terminal')
  and not public.agent_change_listed('setting','terminal.backend') and not public.agent_change_listed('app',null),
 'worker_keeps_owner_answers',has_function_privilege('service_role','public.agent_propose_change(uuid,text,text,text,text,text,jsonb,text)','execute')
  and not has_function_privilege('authenticated','public.agent_propose_change(uuid,text,text,text,text,text,jsonb,text)','execute')
  and not has_function_privilege('anon','public.agent_propose_change(uuid,text,text,text,text,text,jsonb,text)','execute')
  and has_function_privilege('authenticated','public.answer_agent_change(uuid,bigint,boolean,text,uuid)','execute')
  and not has_function_privilege('anon','public.answer_agent_change(uuid,bigint,boolean,text,uuid)','execute')
  and not has_function_privilege('service_role','public.answer_agent_change(uuid,bigint,boolean,text,uuid)','execute')
  and has_function_privilege('authenticated','public.claim_agent_change(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.claim_agent_change(uuid,bigint)','execute')
  and has_function_privilege('authenticated','public.release_agent_change(uuid,bigint,uuid,boolean)','execute')
  and not has_function_privilege('anon','public.release_agent_change(uuid,bigint,uuid,boolean)','execute')
  and has_function_privilege('authenticated','public.renew_agent_change(uuid,bigint,uuid)','execute')
  and not has_function_privilege('anon','public.renew_agent_change(uuid,bigint,uuid)','execute'),
 'claimed_before_approved',exists(select 1 from pg_constraint where conrelid='public.agent_change_proposals'::regclass and conname='agent_change_proposals_claimed')
  and position('claim_token=claim' in pg_get_functiondef('public.answer_agent_change(uuid,bigint,boolean,text,uuid)'::regprocedure))>0,
 'helpers_private',(select bool_and(not has_function_privilege(r,'public.agent_change_listed(text,text)','execute')
   and not has_function_privilege(r,'public.agent_change_value_valid(text,jsonb)','execute')
   and not has_function_privilege(r,'public.may_propose_agent_change(uuid,uuid,uuid)','execute')) from unnest(array['anon','authenticated','service_role']) r),
 'members_offered_propose',position('propose_change' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0
  and position('hand_to_agent' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0,
 'waiting_derived',position('agent_change_proposals' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('agent_key_waits' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and pg_get_function_result('public.waiting_list(uuid)'::regprocedure)='TABLE(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamp with time zone)',
 'logged_for_teller_and_owners',public.log_agent_action('AGENT_CHANGE_APPROVED')='agent_change_approved' and public.log_agent_action('AGENT_CHANGE_DECLINED')='agent_change_declined'
);
