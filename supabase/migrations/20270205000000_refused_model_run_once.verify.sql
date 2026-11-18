-- A Run sent straight away and refused for its model is released and refused in one sender-only call, under the
-- reservations' lock and only for the latest attempt; the calls the previous app version makes stay.
select json_build_object(
 'locked_latest',position('start_attempts=attempt' in pg_get_functiondef('public.refuse_conversation_run_model(uuid,uuid,uuid,integer)'::regprocedure))>0
  and position('pg_advisory_xact_lock' in pg_get_functiondef('public.refuse_conversation_run_model(uuid,uuid,uuid,integer)'::regprocedure))>0,
 'own_reservation',position('r.person_id=auth.uid()' in pg_get_functiondef('public.refuse_conversation_run_model(uuid,uuid,uuid,integer)'::regprocedure))>0,
 'sender_only',has_function_privilege('authenticated','public.refuse_conversation_run_model(uuid,uuid,uuid,integer)','execute')
  and not has_function_privilege('anon','public.refuse_conversation_run_model(uuid,uuid,uuid,integer)','execute')
  and not has_function_privilege('service_role','public.refuse_conversation_run_model(uuid,uuid,uuid,integer)','execute'),
 'previous_form',to_regprocedure('public.refuse_run_model(uuid,uuid)') is not null and to_regprocedure('public.release_conversation_run(uuid,uuid,uuid,integer)') is not null
);
