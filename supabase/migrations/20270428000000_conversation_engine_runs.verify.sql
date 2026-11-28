-- #876: the row holds its open Run; a signed-in person sends and ends one, and only the server holds one.
select json_build_object(
 -- The Company switch this step added left in #883's cutover (20270430000001).
 'open_runs_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversations' and column_name='open_runs'),
 'signed_in_only',has_function_privilege('authenticated','public.open_engine_conversation(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.open_engine_conversation(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated','public.hold_conversation_run(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.hold_conversation_run(uuid,uuid,text)','execute')
  and has_function_privilege('service_role','public.hold_conversation_run(uuid,uuid,text)','execute')
  and has_function_privilege('authenticated','public.end_conversation_run(uuid,text)','execute')
  and not has_function_privilege('anon','public.end_conversation_run(uuid,text)','execute')
);
