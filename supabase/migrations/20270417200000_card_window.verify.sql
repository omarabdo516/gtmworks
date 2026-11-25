-- #678: the Card window saves each property over the value it read, and files go on the Card itself; both for signed-in
-- Members only.
select json_build_object(
 'save_card',has_function_privilege('authenticated','public.save_card(uuid,bigint,text,text,text)','execute')
  and not has_function_privilege('anon','public.save_card(uuid,bigint,text,text,text)','execute')
  and not has_function_privilege('service_role','public.save_card(uuid,bigint,text,text,text)','execute'),
 'card_files',has_function_privilege('authenticated','public.attach_card_files(uuid,bigint,jsonb)','execute')
  and not has_function_privilege('anon','public.attach_card_files(uuid,bigint,jsonb)','execute'),
 'file_on_card',(select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='work_attachments' and column_name='comment_id'),
 'files_logged',exists(select 1 from pg_trigger where tgrelid='public.work_attachments'::regclass and tgname='work_attachments_card_files' and not tgisinternal)
);
