-- #355 review: the database builds each file's path, keeps only the image kinds the Engine reads, refuses to replace a
-- stored message's files, and lets a channel keep its files before the message is stored.
select json_build_object(
 'channel_files_may_wait_for_a_message',(select is_nullable='YES' from information_schema.columns
  where table_schema='public' and table_name='channel_attachments' and column_name='message_id'),
 'channel_file_knows_its_sender',(select coalesce(column_default,'') like '%auth.uid()%' from information_schema.columns
  where table_schema='public' and table_name='channel_attachments' and column_name='person_id'),
 'channel_message_links_its_files',exists(select 1 from pg_trigger where tgrelid='public.channel_messages'::regclass
  and tgname='channel_messages_link_files' and not tgisinternal),
 'conversation_paths_are_built',position($q$||'/conversations/'||$q$ in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0
  and position($q$->>'path'$q$ in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure))=0,
 'channel_paths_are_built',position($q$||'/channels/'||$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0
  and position($q$->>'path'$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))=0,
 'only_images_are_kept',position($q$'image/png'$q$ in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0
  and position($q$'image/webp'$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0,
 'a_stored_message_keeps_its_files',position($q$message_id is not null$q$ in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0
  and position($q$message_id is not null$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0,
 'channel_files_need_no_message_to_exist',position($q$channel_messages$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))=0,
 'a_failed_send_discards_only_waiting_files',position($q$a.message_id is null and a.person_id=auth.uid()$q$ in pg_get_functiondef('public.discard_channel_files(uuid,uuid,uuid)'::regprocedure))>0,
 'empty_text_needs_reserved_files',position($q$btrim(message)='' and not exists(select 1 from public.channel_attachments$q$ in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0,
 'a_send_key_may_still_be_written',has_function_privilege('authenticated','public.reserve_conversation_files(uuid,uuid,uuid,jsonb)','execute')
  and has_function_privilege('authenticated','public.reserve_channel_files(uuid,uuid,uuid,jsonb)','execute')
  and has_function_privilege('authenticated','public.discard_channel_files(uuid,uuid,uuid)','execute')
);
