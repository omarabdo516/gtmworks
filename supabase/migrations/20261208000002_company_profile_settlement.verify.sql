-- Runs wait for the current tool policy and a confirmed read-back; reservations hold their Connection until settled,
-- only the worker settles them, and the move waits for reservations of any age and for five quiet minutes.
select json_build_object(
 'policy_matches_the_level_table',public.engine_tool_policy()=2,
 'ready_needs_policy_and_confirmation',position('engine_tool_policy' in pg_get_functiondef('public.company_profile_ready(uuid)'::regprocedure))>0
  and position('tools_pending' in pg_get_functiondef('public.company_profile_ready(uuid)'::regprocedure))>0,
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.record_company_profile(uuid,text,integer,integer)','public.begin_company_tools(uuid)','public.unsettled_conversation_runs()','public.settle_conversation_run(uuid,uuid,text)','public.company_profile_work()']) f),
 'reserve_by_sender',has_function_privilege('authenticated','public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','execute') and not has_function_privilege('service_role','public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','execute'),
 'old_signatures_gone',to_regprocedure('public.record_company_profile(uuid,text,integer)') is null and to_regprocedure('public.reserve_conversation_run(uuid,uuid,uuid,uuid)') is null,
 'reservation_keeps_its_connection',(select confdeltype='a' from pg_constraint where conname='conversation_run_reservations_connection_id_fkey'),
 'move_waits_without_age',position('interval ''10 minutes''' in pg_get_functiondef('public.move_company_profile(uuid,text,text,text,text[])'::regprocedure))=0
  and position('interval ''5 minutes''' in pg_get_functiondef('public.move_company_profile(uuid,text,text,text,text[])'::regprocedure))>0
);
