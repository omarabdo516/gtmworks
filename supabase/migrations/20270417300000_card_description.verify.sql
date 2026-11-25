-- #679: a Card's description is Markdown with a version number, and a to-do is ticked by its own operation, for
-- signed-in Members only.
select json_build_object(
 'description',(select data_type='text' and is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='description'),
 'description_version',(select data_type='integer' and is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='description_version'),
 'tick',has_function_privilege('authenticated','public.tick_card_todo(uuid,bigint,integer,text,boolean)','execute')
  and not has_function_privilege('anon','public.tick_card_todo(uuid,bigint,integer,text,boolean)','execute')
  and not has_function_privilege('service_role','public.tick_card_todo(uuid,bigint,integer,text,boolean)','execute'),
 'todos',has_function_privilege('authenticated','public.card_todos(text)','execute')
  and not has_function_privilege('anon','public.card_todos(text)','execute')
);
