-- #478: Stop ends the whole Handover chain. A Conversation's Stop and a channel message's end every open Handover started
-- there as stopped and name its Runs, for the person on Stop's own rule; only the worker keeps stopping a Run until its
-- Engine says it ended;
-- the chat keeps its Stop square while a chain moves; and both places' rows say which were stopped.
select json_build_object(
 'stop_ends_the_chain',position('stopped' in pg_get_functiondef('public.stop_open_handovers(uuid,bigint)'::regprocedure))>0
  and not has_function_privilege('authenticated','public.stop_open_handovers(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.stop_open_handovers(uuid,bigint)','execute'),
 'the_person_stops',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.stop_conversation_handovers(uuid,uuid)','public.stop_channel_message(uuid,uuid,bigint)','public.channel_stoppable(uuid)']) f)
  and position('can_manage_company' in pg_get_functiondef('public.stop_conversation_handovers(uuid,uuid)'::regprocedure))>0
  and position('can_manage_company' in pg_get_functiondef('public.stop_channel_message(uuid,uuid,bigint)'::regprocedure))>0,
 'the_worker_keeps_stopping',exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_handovers' and column_name='stopping_run' and is_nullable='YES')
  and (select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
   from unnest(array['public.stop_late_handover_run(bigint,text)','public.handover_runs_stopping(bigint)','public.handover_run_stopped(bigint,text)']) f)
  and not has_column_privilege('authenticated','public.agent_handovers','stopping_run','select'),
 'a_lost_start_ends_once_known',position('stop_requested_at' in pg_get_functiondef('public.answer_handover(bigint,integer,text,text)'::regprocedure))>0,
 'a_moving_chain_keeps_stop',position('agent_handovers' in pg_get_functiondef('public.conversation_working_for(uuid)'::regprocedure))>0,
 'a_stopped_run_hands_nothing_on',(select relrowsecurity from pg_class where oid='public.stopped_runs'::regclass)
  and not has_table_privilege('authenticated','public.stopped_runs','select')
  and position('stopped_runs' in pg_get_functiondef('public.lead_hand_to_agent(uuid,text,text,text,text,text)'::regprocedure))>0
  and position('stopped_runs' in pg_get_functiondef('public.channel_hand_to_agent(bigint,text,text,text,text,text)'::regprocedure))>0
  and position('for no key update' in pg_get_functiondef('public.handover_hand_to_agent(bigint,text,text,text,text,text)'::regprocedure))>0,
 'rows_say_stopped',exists(select 1 from pg_proc p where p.oid='public.conversation_handovers(uuid)'::regprocedure and 'stopped'=any(p.proargnames))
  and exists(select 1 from pg_proc p where p.oid='public.channel_handovers(uuid)'::regprocedure and 'stopped'=any(p.proargnames))
);
