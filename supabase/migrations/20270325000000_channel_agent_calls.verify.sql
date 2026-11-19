-- #152: a channel message keeps one Run and one reply per Agent it calls, in the order named, and every function #148 and
-- #165 added reads one Run. Grants are kept: only the worker drives or pins a Run or shows its cards, only a channel
-- member reads a reply's session, and the calling rule stays private.
select json_build_object(
 'run_place',exists(select 1 from information_schema.columns where table_schema='public' and table_name='channel_runs'
   and column_name='ordinal' and is_nullable='NO' and column_default='1')
  and exists(select 1 from pg_constraint where conrelid='public.channel_runs'::regclass and conname='channel_runs_pkey'
   and pg_get_constraintdef(oid)='PRIMARY KEY (message_id, ordinal)'),
 'one_run_per_agent',exists(select 1 from pg_indexes where schemaname='public' and indexname='channel_runs_one_agent'
   and indexdef like 'CREATE UNIQUE INDEX%'),
 'reply_place',exists(select 1 from information_schema.columns where table_schema='public' and table_name='channel_messages'
   and column_name='reply_ordinal' and is_nullable='YES' and column_default='1')
  and exists(select 1 from pg_constraint where conrelid='public.channel_messages'::regclass and conname='channel_messages_reply_place'
   and pg_get_constraintdef(oid) like '%reply_to IS NULL%' and pg_get_constraintdef(oid) like '%reply_ordinal IS NOT NULL%')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='channel_messages_one_reply'
   and indexdef like 'CREATE UNIQUE INDEX%')
  and not exists(select 1 from pg_constraint where conrelid='public.channel_messages'::regclass and conname='channel_messages_reply_to_key'),
 'request_per_run',exists(select 1 from information_schema.columns where table_schema='public' and table_name='channel_permissions'
   and column_name='ordinal')
  and exists(select 1 from pg_constraint where conrelid='public.channel_permissions'::regclass and conname='channel_permissions_run_fkey'
   and confrelid='public.channel_runs'::regclass)
  and exists(select 1 from pg_constraint where conrelid='public.channel_permissions'::regclass and conname='channel_permissions_run_request'
   and pg_get_constraintdef(oid)='UNIQUE (run_id, request_id)')
  and not exists(select 1 from pg_constraint where conrelid='public.channel_permissions'::regclass and conname='channel_permissions_message_id_fkey'),
 'place_visible',has_column_privilege('authenticated','public.channel_runs','ordinal','select')
  and not has_column_privilege('authenticated','public.channel_runs','run_id','select')
  and not has_column_privilege('authenticated','public.channel_runs','input','select'),
 'calling_rule_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
   unnest(array['public.channel_mentions(uuid,uuid,text)','public.channel_mentions_in(uuid,uuid,text)','public.channel_mention(uuid,uuid,text)',
    'public.channel_mention_in(uuid,uuid,text)']) f),
 'poster_calls_every_agent',position('channel_mentions_in(' in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0
  and position('channel_runs' in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0,
 'lifecycle_service_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute')
   and not has_function_privilege('anon',f,'execute'))
   from unnest(array['public.channel_runs_due(uuid,bigint,bigint)','public.begin_channel_start(bigint)',
    'public.answer_channel_start(bigint,integer,text)','public.close_channel_run(bigint,text,text,text,bigint,bigint)',
    'public.pin_channel_run(bigint,jsonb)','public.channel_show_card(bigint,text,text,text,text,jsonb)',
    'public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text)',
    'public.settle_channel_permission(bigint,text)']) f),
 'sessions_members_only',has_function_privilege('authenticated','public.channel_run_sessions(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.channel_run_sessions(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.channel_run_sessions(uuid,bigint)','execute'),
 'sessions_name_the_reply',position('reply' in pg_get_function_result('public.channel_run_sessions(uuid,bigint)'::regprocedure))>0,
 'runs_one_after_another',position('e.ordinal<r.ordinal' in pg_get_functiondef('public.channel_runs_due(uuid,bigint,bigint)'::regprocedure))>0,
 'due_names_the_place',position('ordinal' in pg_get_function_result('public.channel_runs_due(uuid,bigint,bigint)'::regprocedure))>0,
 'request_keeps_its_run',position('p.run_id=run' in pg_get_functiondef('public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure))>0,
 'waits_link_the_run',position('r.run_id=p.run_id' in pg_get_functiondef('public.channel_permission_waits(public.channel_permissions)'::regprocedure))>0
  and position('r.ordinal=p.ordinal' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0,
 'run_end_closes_its_own',position('run_id=new.run_id' in pg_get_functiondef('public.close_ended_channel_permissions()'::regprocedure))>0
);
