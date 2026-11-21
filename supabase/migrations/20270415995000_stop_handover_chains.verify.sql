-- #478: Stop ends the whole Handover chain. A Conversation's Stop and a channel message's end every open Handover started
-- there as stopped and name its Runs, for the person on Stop's own rule; only the worker asks whether a leg was stopped;
-- the chat keeps its Stop square while a chain moves; and both places' rows say which were stopped.
select json_build_object(
 'stop_ends_the_chain',position('stopped' in pg_get_functiondef('public.stop_open_handovers(uuid,bigint)'::regprocedure))>0
  and not has_function_privilege('authenticated','public.stop_open_handovers(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.stop_open_handovers(uuid,bigint)','execute'),
 'the_person_stops',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.stop_conversation_handovers(uuid,uuid)','public.stop_channel_message(uuid,uuid,bigint)','public.channel_stoppable(uuid)']) f)
  and position('can_manage_company' in pg_get_functiondef('public.stop_conversation_handovers(uuid,uuid)'::regprocedure))>0
  and position('can_manage_company' in pg_get_functiondef('public.stop_channel_message(uuid,uuid,bigint)'::regprocedure))>0,
 'the_worker_asks',has_function_privilege('service_role','public.handover_stopped(bigint)','execute')
  and not has_function_privilege('authenticated','public.handover_stopped(bigint)','execute'),
 'a_moving_chain_keeps_stop',position('agent_handovers' in pg_get_functiondef('public.conversation_working_for(uuid)'::regprocedure))>0,
 'rows_say_stopped',exists(select 1 from pg_proc p where p.oid='public.conversation_handovers(uuid)'::regprocedure and 'stopped'=any(p.proargnames))
  and exists(select 1 from pg_proc p where p.oid='public.channel_handovers(uuid)'::regprocedure and 'stopped'=any(p.proargnames))
);
