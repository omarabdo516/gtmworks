-- A waiting turn the Engine refused for its model is marked so, by the worker's refusal only, and its sender reads it.
select json_build_object(
 'column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversation_queued_turns' and column_name='model_refused' and is_nullable='NO'),
 'marked_on_refusal',position('model_refused=true' in pg_get_functiondef('public.refuse_run_model(uuid,uuid)'::regprocedure))>0,
 'worker_only',has_function_privilege('service_role','public.refuse_run_model(uuid,uuid)','execute') and not has_function_privilege('authenticated','public.refuse_run_model(uuid,uuid)','execute'),
 'sender_reads',has_column_privilege('authenticated','public.conversation_queued_turns','model_refused','select')
);
