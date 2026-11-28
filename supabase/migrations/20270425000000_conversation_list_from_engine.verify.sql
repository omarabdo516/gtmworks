-- #881: the lists' channel read and the archive log are a signed-in person's; the drift check is the worker's alone.
select json_build_object(
 'channel_list_signed_in_only',has_function_privilege('authenticated','public.channel_list(uuid,boolean)','execute')
  and not has_function_privilege('anon','public.channel_list(uuid,boolean)','execute'),
 'archive_log_signed_in_only',has_function_privilege('authenticated','public.log_conversations_archived(uuid,uuid[],boolean)','execute')
  and not has_function_privilege('anon','public.log_conversations_archived(uuid,uuid[],boolean)','execute'),
 'drift_worker_only',has_function_privilege('service_role','public.forget_conversations(uuid,text[])','execute')
  and not has_function_privilege('authenticated','public.forget_conversations(uuid,text[])','execute')
  and not has_function_privilege('authenticated','public.conversation_drift()','execute')
);
