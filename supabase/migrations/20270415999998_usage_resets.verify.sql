-- #642: when a Run's usage resets is read by the Conversation's own person, written only through the worker's closer,
-- and never changed.
select json_build_object(
 'rls',(select relrowsecurity from pg_class where oid='public.conversation_run_resets'::regclass),
 'people_read',has_table_privilege('authenticated','public.conversation_run_resets','select')
  and not has_table_privilege('authenticated','public.conversation_run_resets','insert')
  and not has_table_privilege('authenticated','public.conversation_run_resets','update')
  and not has_table_privilege('anon','public.conversation_run_resets','select'),
 'append_only',exists(select 1 from pg_trigger where tgname='conversation_run_resets_append_only' and tgrelid='public.conversation_run_resets'::regclass),
 'worker_only',has_function_privilege('service_role','public.close_conversation_run_out_of_usage(uuid,text,text,boolean,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.close_conversation_run_out_of_usage(uuid,text,text,boolean,timestamptz)','execute')
  and not has_function_privilege('anon','public.close_conversation_run_out_of_usage(uuid,text,text,boolean,timestamptz)','execute')
);
