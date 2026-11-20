-- Runs wait for a confirmed read-back of the fixed tools; an active reservation holds its Connection and the move, only
-- the worker abandons reservations (never through the engine), and the move waits for five quiet minutes. #391 removed
-- the policy, so the copy of it is gone too.
select json_build_object(
 'no_policy_copy',to_regprocedure('public.engine_tool_policy()') is null,
 'ready_needs_confirmation',position('tools_confirmed' in pg_get_functiondef('public.company_profile_ready(uuid)'::regprocedure))>0
  and position('tools_pending' in pg_get_functiondef('public.company_profile_ready(uuid)'::regprocedure))>0,
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.record_company_profile(uuid,text)','public.begin_company_tools(uuid)','public.abandon_conversation_reservations()','public.company_profile_work()']) f),
 'reserve_by_sender',has_function_privilege('authenticated','public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','execute') and not has_function_privilege('service_role','public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','execute'),
 'old_signatures_gone',to_regprocedure('public.record_company_profile(uuid,text,integer)') is null
  and to_regprocedure('public.record_company_profile(uuid,text,integer,integer)') is null
  and to_regprocedure('public.reserve_conversation_run(uuid,uuid,uuid,uuid)') is null,
 'replay_removed',to_regprocedure('public.settle_conversation_run(uuid,uuid,text)') is null and to_regprocedure('public.unsettled_conversation_runs()') is null,
 'active_reservation_keeps_its_connection',not exists(select 1 from pg_constraint where conname='conversation_run_reservations_connection_id_fkey')
  -- #342 (20270213000000): a reservation keeps its profile; there is no Connection left to remove.
  and position('held.profile' in pg_get_functiondef('public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)'::regprocedure))>0,
 'retry_checked',position('company_profile_ready' in pg_get_functiondef('public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)'::regprocedure))>0,
 'late_record_refused',position('conversationSendAgain' in pg_get_functiondef('public.send_conversation_message(uuid,uuid,uuid,text,uuid,text,uuid)'::regprocedure))>0
  and position('started_on' in pg_get_functiondef('public.send_conversation_message(uuid,uuid,uuid,text,uuid,text,uuid)'::regprocedure))>0,
 'record_and_abandon_take_the_move_lock',(select bool_and(position('hashtextextended(''hermes_agents'',0)' in pg_get_functiondef(f::regprocedure))>0)
  from unnest(array['public.send_conversation_message(uuid,uuid,uuid,text,uuid,text,uuid)','public.abandon_conversation_reservations()','public.move_company_profile(uuid)']) f),
 'record_by_sender',has_function_privilege('authenticated','public.send_conversation_message(uuid,uuid,uuid,text,uuid,text,uuid)','execute') and not has_function_privilege('anon','public.send_conversation_message(uuid,uuid,uuid,text,uuid,text,uuid)','execute'),
 'abandoned_hold_nothing',position('abandoned_at is null' in pg_get_functiondef('public.move_company_profile(uuid)'::regprocedure))>0,
 'move_waits_quietly',position('interval ''5 minutes''' in pg_get_functiondef('public.move_company_profile(uuid)'::regprocedure))>0
);
