select json_build_object(
 'checked_writes',has_function_privilege('authenticated','public.conversation_can_write(uuid)','execute') and not has_function_privilege('anon','public.conversation_can_write(uuid)','execute')
  and has_function_privilege('authenticated','public.send_conversation_message(uuid,uuid,uuid,text,uuid,text)','execute') and not has_function_privilege('anon','public.send_conversation_message(uuid,uuid,uuid,text,uuid,text)','execute'),
 'server_reads_agent',has_column_privilege('service_role','public.hermes_agents','profile','select')
  and has_column_privilege('service_role','public.hermes_agents','company_id','select') and has_column_privilege('service_role','public.hermes_agents','connection_id','select')
  and not has_column_privilege('service_role','public.hermes_agents','name','select') and not has_table_privilege('service_role','public.hermes_agents','update'),
 -- No Member writes a reply since 20270214000000: only the worker's close_conversation_run does.
 'replies_worker_only',to_regprocedure('public.record_conversation_run(uuid,text,text,text,text,bigint,bigint)') is null and to_regprocedure('public.record_conversation_reply(uuid,text,text,text)') is null
  and not has_function_privilege('authenticated','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)','execute'),
 'person_run_index',exists(select 1 from pg_indexes where schemaname='public' and indexname='conversation_messages_person_run'),
 'service_only_runs',has_function_privilege('service_role','public.open_conversation_runs(uuid,uuid,bigint)','execute') and not has_function_privilege('authenticated','public.open_conversation_runs(uuid,uuid,bigint)','execute')
);
