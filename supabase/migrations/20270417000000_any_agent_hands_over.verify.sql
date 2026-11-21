-- #475: any Agent of a Company hands over in a Conversation, to any other Agent of it; a job command stays the main
-- Agent's; the tool's enum comes from the worker's own list; the Conversation's person reads its handovers by the
-- Conversation's own rule, through one function that names both Agents.
select json_build_object(
 'any_agent_hands_over',position('is_company_lead' in pg_get_functiondef('public.may_hand_to_agent(uuid,uuid,uuid)'::regprocedure))=0,
 'command_stays_the_main_agents',position('is_company_lead(c,lead.id)' in pg_get_functiondef('public.command_handover(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure))>0,
 'any_target_of_the_company',position('agent_visible_to' in pg_get_functiondef('public.lead_hand_to_agent(uuid,text,text,text,text,text)'::regprocedure))=0
  and position('r.answers_person and not public.agent_visible_to' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0,
 'targets_listed_for_the_worker',has_function_privilege('service_role','public.conversation_handover_agents(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.conversation_handover_agents(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.conversation_handover_agents(uuid,uuid)','execute'),
 'read_by_the_conversations_person',has_function_privilege('authenticated','public.conversation_handovers(uuid)','execute')
  and not has_function_privilege('anon','public.conversation_handovers(uuid)','execute')
  and position('can_see_agent(company_id, to_agent)' in (select pg_get_expr(polqual,polrelid) from pg_policy
   where polrelid='public.agent_handovers'::regclass and polname='agent_handovers_read'))=0
  and not has_column_privilege('authenticated','public.agent_handovers','summary','select')
);
