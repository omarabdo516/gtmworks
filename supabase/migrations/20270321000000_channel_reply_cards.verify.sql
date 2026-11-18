-- #148: a channel reply's card is a reply_cards row linked to a channel message, its tools are pinned on channel_runs,
-- and its steps are read live through channel_run_sessions. Grants are kept: only the worker shows a card or pins a Run,
-- only a channel member reads a reply's session, and the helpers stay private.
-- (#149 offers hand_over on a channel Run too, so the pinner's list grew by that tool.)
select json_build_object(
 'card_link',exists(select 1 from information_schema.columns where table_schema='public' and table_name='reply_cards' and column_name='channel_message_id' and is_nullable='YES')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='reply_cards' and column_name='conversation_id' and is_nullable='YES'),
 'one_place',exists(select 1 from pg_constraint where conrelid='public.reply_cards'::regclass and conname='reply_cards_one_place'),
 'one_card_per_call',exists(select 1 from pg_indexes where schemaname='public' and indexname='reply_cards_channel_call' and indexdef like 'CREATE UNIQUE INDEX%'),
 'channel_reads_card',exists(select 1 from pg_policies where schemaname='public' and tablename='reply_cards' and policyname='reply_cards_channel_read' and cmd='SELECT'),
 'tools_pinned',exists(select 1 from information_schema.columns where table_schema='public' and table_name='channel_runs' and column_name='tools')
  and not has_column_privilege('authenticated','public.channel_runs','tools','select'),
 'pinner_worker_only',has_function_privilege('service_role','public.pin_channel_run(bigint,jsonb)','execute')
  and not has_function_privilege('authenticated','public.pin_channel_run(bigint,jsonb)','execute')
  and not has_function_privilege('anon','public.pin_channel_run(bigint,jsonb)','execute'),
 'card_worker_only',has_function_privilege('service_role','public.channel_show_card(bigint,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.channel_show_card(bigint,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.channel_show_card(bigint,text,text,text,text,jsonb)','execute'),
 'sessions_members_only',has_function_privilege('authenticated','public.channel_run_sessions(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.channel_run_sessions(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.channel_run_sessions(uuid,bigint)','execute'),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.channel_can_show_cards(uuid,uuid,uuid)']) f),
 'log_read_by_channel',position('in_channel' in (select qual from pg_policies where schemaname='public' and tablename='company_log' and policyname='company_log_read'))>0
  and position('reply_cards' in (select qual from pg_policies where schemaname='public' and tablename='company_log' and policyname='company_log_read'))>0,
 'card_offers_two',position('''show_draft''' in pg_get_functiondef('public.pin_channel_run(bigint,jsonb)'::regprocedure))>0
  and position('''show_review''' in pg_get_functiondef('public.pin_channel_run(bigint,jsonb)'::regprocedure))>0
  and position('''hand_over''' in pg_get_functiondef('public.pin_channel_run(bigint,jsonb)'::regprocedure))>0
);
