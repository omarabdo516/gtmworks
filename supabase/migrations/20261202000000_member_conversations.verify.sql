select json_build_object(
 'checked_writes',has_function_privilege('authenticated','public.conversation_can_write(uuid)','execute') and not has_function_privilege('anon','public.conversation_can_write(uuid)','execute')
  and has_function_privilege('authenticated','public.send_conversation_message(uuid,uuid,uuid,text,uuid,text)','execute') and not has_function_privilege('anon','public.send_conversation_message(uuid,uuid,uuid,text,uuid,text)','execute'),
 'server_reads_connection',has_column_privilege('service_role','public.hermes_connections','address','select') and has_column_privilege('service_role','public.hermes_connections','profile','select')
  and has_column_privilege('service_role','public.hermes_connections','state','select') and has_column_privilege('service_role','public.hermes_connections','features','select')
  and not has_table_privilege('service_role','public.hermes_connections','insert') and not has_table_privilege('service_role','public.hermes_connections','update')
  and has_column_privilege('service_role','public.hermes_agents','company_id','select') and has_column_privilege('service_role','public.hermes_agents','connection_id','select')
  and not has_column_privilege('service_role','public.hermes_agents','name','select') and not has_table_privilege('service_role','public.hermes_agents','update'),
 'replies_owner_only',has_function_privilege('authenticated','public.record_conversation_run(uuid,text,text,text,text,bigint,bigint)','execute') and position('is_company_owner' in pg_get_functiondef('public.record_conversation_run(uuid,text,text,text,text,bigint,bigint)'::regprocedure))>0
  and position('is_company_owner' in pg_get_functiondef('public.record_conversation_reply(uuid,text,text,text)'::regprocedure))>0,
 'person_run_index',exists(select 1 from pg_indexes where schemaname='public' and indexname='conversation_messages_person_run'),
 'service_only_runs',has_function_privilege('service_role','public.open_conversation_runs(uuid,uuid,bigint)','execute') and not has_function_privilege('authenticated','public.open_conversation_runs(uuid,uuid,bigint)','execute')
);
