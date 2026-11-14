-- A lost start is kept and marked by the server only, claimed again as a retry, and not abandoned after ten minutes.
select json_build_object(
 'marked_by_server_only',has_function_privilege('service_role','public.keep_unknown_start(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.keep_unknown_start(uuid,uuid)','execute'),
 'claim_says_retry',position('start_unknown_at is not null' in pg_get_functiondef('public.claim_conversation_turn(uuid)'::regprocedure))>0
  and has_function_privilege('service_role','public.claim_conversation_turn(uuid)','execute') and not has_function_privilege('authenticated','public.claim_conversation_turn(uuid)','execute'),
 'marked_outlives_ten_minutes',position('start_unknown_at is null and r.created_at' in pg_get_functiondef('public.abandon_conversation_reservations()'::regprocedure))>0
);
