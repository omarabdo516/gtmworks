select json_build_object(
 'items_table_rls',(select relrowsecurity from pg_class where oid='public.waiting_items'::regclass),
 'items_read_own',exists(select 1 from pg_policies where schemaname='public' and tablename='waiting_items' and policyname='waiting_items_read' and cmd='SELECT' and qual like '%auth.uid()%'),
 'items_not_written_by_people',not has_table_privilege('authenticated','public.waiting_items','insert')
  and not has_table_privilege('authenticated','public.waiting_items','update') and not has_table_privilege('authenticated','public.waiting_items','delete'),
 'list_for_members',has_function_privilege('authenticated','public.waiting_list(uuid)','execute') and not has_function_privilege('anon','public.waiting_list(uuid)','execute'),
 'items_added_by_server_only',has_function_privilege('service_role','public.add_waiting_item(uuid,uuid,text,text,text,bigint,uuid,text)','execute')
  and not has_function_privilege('authenticated','public.add_waiting_item(uuid,uuid,text,text,text,bigint,uuid,text)','execute')
  and not has_function_privilege('anon','public.add_waiting_item(uuid,uuid,text,text,text,bigint,uuid,text)','execute'),
 'reply_clears',exists(select 1 from pg_trigger where tgrelid='public.conversation_messages'::regclass and tgname='resolve_waiting_on_reply' and tgenabled='O'),
 'card_change_clears',exists(select 1 from pg_trigger where tgrelid='public.work_activity'::regclass and tgname='resolve_waiting_on_card' and tgenabled='O'),
 'nothing_sent_out',not exists(select 1 from pg_trigger where tgrelid='public.waiting_items'::regclass and not tgisinternal)
);
