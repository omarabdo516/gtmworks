-- Runs wait for the current tool policy and a confirmed read-back; an active reservation holds its Connection and the
-- move, only the worker abandons reservations (never through the engine), and the move waits for five quiet minutes.
select json_build_object(
 'policy_matches_the_level_table',public.engine_tool_policy()=2,
 'ready_needs_policy_and_confirmation',position('engine_tool_policy' in pg_get_functiondef('public.company_profile_ready(uuid)'::regprocedure))>0
  and position('tools_pending' in pg_get_functiondef('public.company_profile_ready(uuid)'::regprocedure))>0,
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.record_company_profile(uuid,text,integer,integer)','public.begin_company_tools(uuid)','public.abandon_conversation_reservations()','public.company_profile_work()']) f),
 'reserve_by_sender',has_function_privilege('authenticated','public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','execute') and not has_function_privilege('service_role','public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','execute'),
 'old_signatures_gone',to_regprocedure('public.record_company_profile(uuid,text,integer)') is null and to_regprocedure('public.reserve_conversation_run(uuid,uuid,uuid,uuid)') is null,
 'replay_removed',to_regprocedure('public.settle_conversation_run(uuid,uuid,text)') is null and to_regprocedure('public.unsettled_conversation_runs()') is null,
 'active_reservation_keeps_its_connection',not exists(select 1 from pg_constraint where conname='conversation_run_reservations_connection_id_fkey')
  and exists(select 1 from pg_trigger where tgrelid='public.hermes_connections'::regclass and tgname='reserved_connection_kept' and tgenabled='O'),
 'retry_checked',position('company_profile_ready' in pg_get_functiondef('public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)'::regprocedure))>0,
 'late_record_refused',position('conversationSendAgain' in pg_get_functiondef('public.send_conversation_message(uuid,uuid,uuid,text,uuid,text)'::regprocedure))>0,
 'abandoned_hold_nothing',position('abandoned_at is null' in pg_get_functiondef('public.move_company_profile(uuid,text,text,text,text[])'::regprocedure))>0,
 'move_waits_quietly',position('interval ''5 minutes''' in pg_get_functiondef('public.move_company_profile(uuid,text,text,text,text[])'::regprocedure))>0
);
