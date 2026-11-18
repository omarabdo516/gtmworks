-- #200: a channel message that names a Member leaves one waiting item pointing at it, which only they read while they are
-- in the channel, and which opening from their list resolves. Grants stay as they were: the mentioning rule is private,
-- posting stays a Member's, and reading a mention is a reader's (a Viewer included).
select json_build_object(
 'item_names_the_message',exists(select 1 from information_schema.columns where table_schema='public' and table_name='waiting_items'
   and column_name='channel_message_id' and is_nullable='YES')
  and exists(select 1 from pg_constraint where conrelid='public.waiting_items'::regclass
   and pg_get_constraintdef(oid) like '%FOREIGN KEY (channel_message_id) REFERENCES channel_messages(id)%')
  and position('channel_message_id' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.waiting_items'::regclass
   and conname='waiting_items_source')))>0,
 'one_item_per_member',exists(select 1 from pg_indexes where schemaname='public' and indexname='waiting_items_one_per_channel_message'
   and indexdef like 'CREATE UNIQUE INDEX%'),
 'reader_stays_in_the_channel',(select position('in_channel(m.channel_id)' in pg_get_expr(polqual,polrelid))>0
   and position('is_member(company_id)' in pg_get_expr(polqual,polrelid))>0
   from pg_policy where polname='waiting_items_read' and polrelid='public.waiting_items'::regclass),
 'mentioning_rule_private',not has_function_privilege('authenticated','public.channel_message_mentions(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.channel_message_mentions(uuid,uuid,text)','execute'),
 'posting_names_members',position('channel_message_mentions(' in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0
  and position('''channel_mention''' in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0
  and position('channel_mentions_in(' in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0,
 'reader_resolves_it',has_function_privilege('authenticated','public.read_channel_mention(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.read_channel_mention(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.read_channel_mention(uuid,bigint)','execute')
);
