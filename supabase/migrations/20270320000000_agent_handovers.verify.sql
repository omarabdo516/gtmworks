-- One handover per Conversation, run and call, moved by the worker only; the Lead alone is offered the tool, and the
-- Conversation's person reads the rows made with Agents they see.
select json_build_object(
 'table',to_regclass('public.agent_handovers') is not null,
 'offered_to_lead',position('hand_to_agent' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0,
 'worker_only',has_function_privilege('service_role','public.handovers_due(uuid,bigint)','execute')
  and has_function_privilege('service_role','public.begin_handover(bigint)','execute')
  and has_function_privilege('service_role','public.answer_handover(bigint,integer,text)','execute')
  and has_function_privilege('service_role','public.close_handover_target(bigint,text,text,text)','execute')
  and has_function_privilege('service_role','public.close_handover_follow_up(bigint,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.handovers_due(uuid,bigint)','execute')
  and not has_function_privilege('authenticated','public.begin_handover(bigint)','execute')
  and not has_function_privilege('anon','public.handovers_due(uuid,bigint)','execute'),
 'call_kept_once',to_regclass('public.agent_handovers') is not null
  and exists(select 1 from pg_constraint where conrelid='public.agent_handovers'::regclass and contype='u'
   and conkey=array(select attnum from pg_attribute where attrelid='public.agent_handovers'::regclass and attname in ('conversation_id','run_id','call_id') order by attnum)),
 'unread_by_people',not has_function_privilege('authenticated','public.lead_hand_to_agent(uuid,text,text,text,text,text)','execute')
  and has_column_privilege('authenticated','public.agent_handovers','goal','select')
  and not has_column_privilege('authenticated','public.agent_handovers','summary','select')
  and not has_column_privilege('authenticated','public.agent_handovers','target_run','select'),
 'readable',exists(select 1 from pg_policy where polrelid='public.agent_handovers'::regclass and polname='agent_handovers_read')
);
