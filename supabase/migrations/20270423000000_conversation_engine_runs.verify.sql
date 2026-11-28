-- #876: the row holds its open Run, and only a signed-in person sends, holds and ends one.
select json_build_object(
 'engine_conversations_off',(select column_default from information_schema.columns where table_schema='public' and table_name='companies' and column_name='engine_conversations')='false',
 'open_run_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversations' and column_name='open_run'),
 'signed_in_only',has_function_privilege('authenticated','public.open_engine_conversation(uuid,uuid,uuid,text,text)','execute')
  and not has_function_privilege('anon','public.open_engine_conversation(uuid,uuid,uuid,text,text)','execute')
  and has_function_privilege('authenticated','public.hold_conversation_run(uuid,text)','execute')
  and not has_function_privilege('anon','public.hold_conversation_run(uuid,text)','execute')
  and has_function_privilege('authenticated','public.end_conversation_run(uuid,text)','execute')
  and not has_function_privilege('anon','public.end_conversation_run(uuid,text)','execute')
);
