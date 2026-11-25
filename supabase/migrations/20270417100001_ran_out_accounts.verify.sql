-- #731: which accounts ran out on a Run is read by the Conversation's own person, written only through the worker's
-- closer, and never changed.
select json_build_object(
 'rls',(select relrowsecurity from pg_class where oid='public.conversation_run_ran_out'::regclass),
 'people_read',has_table_privilege('authenticated','public.conversation_run_ran_out','select')
  and not has_table_privilege('authenticated','public.conversation_run_ran_out','insert')
  and not has_table_privilege('authenticated','public.conversation_run_ran_out','update')
  and not has_table_privilege('anon','public.conversation_run_ran_out','select'),
 'append_only',exists(select 1 from pg_trigger where tgname='conversation_run_ran_out_append_only' and tgrelid='public.conversation_run_ran_out'::regclass),
 'worker_only',has_function_privilege('service_role','public.close_conversation_run_ran_out(uuid,text,text,boolean,timestamptz,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.close_conversation_run_ran_out(uuid,text,text,boolean,timestamptz,text,jsonb)','execute')
  and not has_function_privilege('anon','public.close_conversation_run_ran_out(uuid,text,text,boolean,timestamptz,text,jsonb)','execute')
);
