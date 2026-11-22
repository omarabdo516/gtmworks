-- #514: a queued turn's or a handover leg's start that never reached an Engine is handed back by the worker alone; no
-- person may call either function, and a reservation handed back and given up fails its turn.
select json_build_object(
 'queued_release',to_regprocedure('public.release_queued_start(uuid,uuid,integer)') is not null
  and has_function_privilege('service_role','public.release_queued_start(uuid,uuid,integer)','execute')
  and not has_function_privilege('authenticated','public.release_queued_start(uuid,uuid,integer)','execute')
  and not has_function_privilege('anon','public.release_queued_start(uuid,uuid,integer)','execute'),
 'handover_release',to_regprocedure('public.release_handover_start(bigint,integer,text)') is not null
  and has_function_privilege('service_role','public.release_handover_start(bigint,integer,text)','execute')
  and not has_function_privilege('authenticated','public.release_handover_start(bigint,integer,text)','execute')
  and not has_function_privilege('anon','public.release_handover_start(bigint,integer,text)','execute'),
 'only_the_begun_attempt',position('r.start_attempts=attempt' in pg_get_functiondef('public.release_queued_start(uuid,uuid,integer)'::regprocedure))>0
  and position('r.target_attempts=attempt' in pg_get_functiondef('public.release_handover_start(bigint,integer,text)'::regprocedure))>0,
 'stopped_leg_ends',position('stop_requested_at is not null and attempt=1' in pg_get_functiondef('public.release_handover_start(bigint,integer,text)'::regprocedure))>0,
 'unreached_turn_fails',position('g.unreached' in pg_get_functiondef('public.abandon_conversation_reservations()'::regprocedure))>0
  and position('r.start_unreached_at>now()-interval' in pg_get_functiondef('public.abandon_conversation_reservations()'::regprocedure))>0
)
