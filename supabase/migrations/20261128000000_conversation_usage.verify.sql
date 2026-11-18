select json_build_object(
 'usage_rls',(select relrowsecurity from pg_class where oid='public.conversation_run_ends'::regclass),
 'reply_usage',exists(select 1 from pg_trigger where tgname='conversation_reply_end'),
 'append_only',exists(select 1 from pg_trigger where tgname='conversation_run_ends_append_only'),
 'checked_writes',not has_table_privilege('authenticated','public.conversation_run_ends','insert') and not has_table_privilege('service_role','public.conversation_run_ends','insert') and has_function_privilege('authenticated','public.record_conversation_run(uuid,text,text,text,text,bigint,bigint)','execute')
);
