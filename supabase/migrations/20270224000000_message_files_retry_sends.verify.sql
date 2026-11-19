-- #355 review: an image-only retry of a stored send reaches the send key's own deduplication, so its message answers.
select json_build_object(
 'an_image_only_retry_is_accepted',position($q$m.send_key=message_key and m.person_id=auth.uid() and m.author='person'$q$ in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0,
 'the_send_key_answers_with_its_message',position($q$on conflict (channel_id, send_key) do nothing$q$ in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0
  and position($q$where channel_id=ch and send_key=message_key and person_id=auth.uid()$q$ in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0,
 'the_same_signature_answers',has_function_privilege('authenticated','public.post_channel_message(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.post_channel_message(uuid,uuid,text)','execute'),
 'a_channel_send_key_is_locked',position($q$pg_advisory_xact_lock(hashtextextended('channel_files:'||ch::text||':'||message_key::text,0))$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0,
 'a_conversation_send_key_is_locked',position($q$pg_advisory_xact_lock(hashtextextended('conversation_files:'||conversation::text||':'||message_key::text,0))$q$ in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0
);
