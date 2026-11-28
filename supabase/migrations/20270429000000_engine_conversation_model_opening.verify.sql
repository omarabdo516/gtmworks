-- #882: the row marks the Conversation the main Agent opened; a send answers the model and the opening; the face counts an Engine Run.
select json_build_object(
 'lead_opening_column',(select column_default from information_schema.columns where table_schema='public' and table_name='conversations' and column_name='lead_opening')='false',
 'send_answers_model',position('''model''' in pg_get_functiondef('public.open_engine_conversation(uuid,uuid,uuid,text)'::regprocedure))>0,
 'work_counts_open_runs',position('open_runs' in pg_get_functiondef('public.agent_work(uuid)'::regprocedure))>0,
 'refuse_model_signed_in_only',has_function_privilege('authenticated','public.refuse_conversation_model(uuid,uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.refuse_conversation_model(uuid,uuid,jsonb)','execute'),
 'grants_kept',has_function_privilege('authenticated','public.open_engine_conversation(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated','public.open_first_conversation(uuid,uuid,uuid,text)','execute')
  and has_function_privilege('service_role','public.open_first_conversation(uuid,uuid,uuid,text)','execute')
);
