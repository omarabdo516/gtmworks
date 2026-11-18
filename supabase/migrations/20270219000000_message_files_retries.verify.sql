-- #355 review: a retry of a stored send is answered -1 by both reserves, so the send goes on to its message.
select json_build_object(
 'a_stored_send_is_answered',position($q$return -1$q$ in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0
  and position($q$return -1$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0,
 'the_same_signatures_answer',has_function_privilege('authenticated','public.reserve_conversation_files(uuid,uuid,uuid,jsonb)','execute')
  and has_function_privilege('authenticated','public.reserve_channel_files(uuid,uuid,uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.reserve_conversation_files(uuid,uuid,uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.reserve_channel_files(uuid,uuid,uuid,jsonb)','execute')
);
