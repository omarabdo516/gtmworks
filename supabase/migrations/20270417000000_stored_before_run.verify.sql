-- #764: sending stores the turn and starts nothing; only a person sends or tries again, never the service role or anon.
select json_build_object(
 'queue_for_people',has_function_privilege('authenticated','public.queue_conversation_turn(uuid,uuid,uuid,uuid,text,boolean)','execute')
  and not has_function_privilege('anon','public.queue_conversation_turn(uuid,uuid,uuid,uuid,text,boolean)','execute'),
 'retry_for_people',has_function_privilege('authenticated','public.retry_conversation_turn(uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.retry_conversation_turn(uuid,uuid,uuid)','execute'),
 'queue_never_reserves',position('reserve_conversation_run' in pg_get_functiondef('public.queue_conversation_turn(uuid,uuid,uuid,uuid,text,boolean)'::regprocedure))=0,
 'previous_send_kept',to_regprocedure('public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)') is not null
);
-- #764: one start of a turn at a time, for the service role only.
select json_build_object(
 'one_start_at_a_time',has_function_privilege('service_role','public.begin_turn_start(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.begin_turn_start(uuid,uuid)','execute')
);
