select json_build_object(
 'conversations_rls',(select relrowsecurity from pg_class where oid='public.conversations'::regclass),
 'messages_rls',(select relrowsecurity from pg_class where oid='public.conversation_messages'::regclass),
 'append_only',exists(select 1 from pg_trigger where tgname='conversation_messages_append_only'),
 'checked_writes',not has_table_privilege('authenticated','public.conversation_messages','insert') and not has_table_privilege('authenticated','public.conversations','insert') and not has_table_privilege('service_role','public.conversation_messages','insert') and has_function_privilege('authenticated','public.send_conversation_message(uuid,uuid,uuid,text,uuid,text)','execute')
);
