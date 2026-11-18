-- A waiting turn refused for its model is settled in one worker-only call, under the reservations' lock and only for
-- the latest attempt; the two-argument form the previous app version calls stays.
select json_build_object(
 'locked_latest',position('start_attempts=attempt' in pg_get_functiondef('public.refuse_run_model(uuid,uuid,integer)'::regprocedure))>0
  and position('pg_advisory_xact_lock' in pg_get_functiondef('public.refuse_run_model(uuid,uuid,integer)'::regprocedure))>0,
 'fails_turn',position('fail_conversation_turn' in pg_get_functiondef('public.refuse_run_model(uuid,uuid,integer)'::regprocedure))>0,
 'worker_only',has_function_privilege('service_role','public.refuse_run_model(uuid,uuid,integer)','execute') and not has_function_privilege('authenticated','public.refuse_run_model(uuid,uuid,integer)','execute'),
 'previous_form',to_regprocedure('public.refuse_run_model(uuid,uuid)') is not null
);
