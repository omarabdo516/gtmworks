select json_build_object(
 'service_only',has_function_privilege('service_role','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)','execute') and not has_function_privilege('authenticated','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)','execute') and has_function_privilege('service_role','public.open_conversation_runs(uuid,uuid,bigint)','execute') and not has_function_privilege('authenticated','public.open_conversation_runs(uuid,uuid,bigint)','execute')
);
