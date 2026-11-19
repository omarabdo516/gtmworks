-- #355 review: a retry of a stored send is answered -1 by both reserves, a waiting channel key belongs to one sender,
-- and a channel message links only its own sender's files.
select json_build_object(
 'a_stored_send_is_answered',position($q$return -1$q$ in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0
  and position($q$return -1$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0,
 'a_pending_key_has_one_sender',position($q$a.person_id<>auth.uid()$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0,
 'a_channel_message_links_its_sender',position($q$person_id=new.person_id$q$ in pg_get_functiondef('public.link_channel_files()'::regprocedure))>0,
 'the_same_signatures_answer',has_function_privilege('authenticated','public.reserve_conversation_files(uuid,uuid,uuid,jsonb)','execute')
  and has_function_privilege('authenticated','public.reserve_channel_files(uuid,uuid,uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.reserve_conversation_files(uuid,uuid,uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.reserve_channel_files(uuid,uuid,uuid,jsonb)','execute')
);
