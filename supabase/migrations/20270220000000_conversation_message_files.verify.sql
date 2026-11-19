-- #155: a Conversation's files are linked to the message they were sent with, written by their sender only, and a
-- message may carry images alone.
select json_build_object(
 'columns',(select count(*)=3 from information_schema.columns where table_schema='public' and table_name='conversation_attachments'
  and column_name in ('send_key','message_id','position')),
 'linked_to_its_message',exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
  where t.tgname='conversation_messages_link_files' and c.relname='conversation_messages' and not t.tgisinternal),
 'sender_writes_their_own',has_function_privilege('authenticated','public.reserve_conversation_files(uuid,uuid,uuid,jsonb)','execute')
  and has_function_privilege('authenticated','public.discard_conversation_files(uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.reserve_conversation_files(uuid,uuid,uuid,jsonb)','execute')
  and not has_function_privilege('service_role','public.reserve_conversation_files(uuid,uuid,uuid,jsonb)','execute')
  and not has_function_privilege('service_role','public.discard_conversation_files(uuid,uuid,uuid)','execute'),
 'body_may_be_empty',(select pg_get_constraintdef(oid) like '%(length(body) >= 0)%' from pg_constraint
  where conname='conversation_messages_body_check' and conrelid='public.conversation_messages'::regclass),
 'turn_text_may_be_empty',(select pg_get_constraintdef(oid) like '%(length(message) >= 0)%' from pg_constraint
  where conname='conversation_queued_turns_message_check' and conrelid='public.conversation_queued_turns'::regclass),
 'reserve_allows_images_alone',position('between 0 and 200000' in pg_get_functiondef('public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)'::regprocedure))>0,
 'claim_says_which_turn_carries_them',(select pg_get_function_result(p.oid) like '%has_files boolean%'
  from pg_proc p where p.oid='public.claim_conversation_turn(uuid)'::regprocedure),
 'paths_stay_in_the_conversation',(select count(*)=1 from pg_constraint where conrelid='public.conversation_attachments'::regclass
  and contype='c' and pg_get_constraintdef(oid) like '%split_part(path%'),
 'one_file_per_path',(select count(*)=1 from pg_constraint where conrelid='public.conversation_attachments'::regclass and contype='u'
  and pg_get_constraintdef(oid)='UNIQUE (company_id, path)')
);
