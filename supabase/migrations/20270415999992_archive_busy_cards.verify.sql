-- #670, #671: a note's Run has a place to be stopped, archiving, restoring and the question of what archiving stops are
-- the signed-in Member's own, the stopping is inside the database alone, a stopped Run keeps no new wait, a start on its
-- way keeps its stop, and a channel's work is told to its Members alone.
select json_build_object(
 'note_place',exists(select 1 from information_schema.columns where table_schema='public' and table_name='stopped_runs' and column_name='note_id')
  and position('num_nonnulls' in (select pg_get_constraintdef(oid) from pg_constraint where conname='stopped_runs_one_place' and conrelid='public.stopped_runs'::regclass))>0,
 'note_runs_stopped',position('public.note_runs' in pg_get_functiondef('public.stopped_runs_open()'::regprocedure))>0,
 'member_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute')) from unnest(array['public.archive_cards(uuid,bigint[])','public.restore_cards(uuid,bigint[],timestamptz)',
  'public.card_archive_stops(uuid,bigint[])']) f),
 'inside_only',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['public.stop_card_work(uuid,bigint)',
  'public.stop_conversation_work(uuid)','public.stop_channel_work(uuid,uuid)','public.conversation_work_stops(uuid)','public.channel_work_stops(uuid)']) f,
  unnest(array['anon','authenticated','service_role']) r),
 'as_definer',(select count(*)=6 and bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.archive_cards(uuid,bigint[])'::regprocedure,'public.restore_cards(uuid,bigint[],timestamptz)'::regprocedure,'public.card_archive_stops(uuid,bigint[])'::regprocedure,
   'public.stop_card_work(uuid,bigint)'::regprocedure,'public.stop_conversation_work(uuid)'::regprocedure,'public.stop_channel_work(uuid,uuid)'::regprocedure)),
 'role_checked',position('public.work_can_edit(c)' in pg_get_functiondef('public.archive_cards(uuid,bigint[])'::regprocedure))>0
  and position('public.work_can_edit(c)' in pg_get_functiondef('public.restore_cards(uuid,bigint[],timestamptz)'::regprocedure))>0,
 'archive_stops',position('public.stop_card_work(' in pg_get_functiondef('public.archive_cards(uuid,bigint[])'::regprocedure))>0,
 'stopped_asks_nothing',(select bool_and(position('public.stopped_runs' in pg_get_functiondef(f))>0) from unnest(array[
  'public.track_run_question(uuid,text,jsonb,boolean,timestamptz)'::regprocedure,
  'public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure,
  'public.agent_show_card(uuid,text,text,text,text,jsonb)'::regprocedure,'public.channel_show_card(bigint,text,text,text,text,jsonb)'::regprocedure,
  'public.track_channel_question(bigint,text,jsonb,boolean,timestamptz)'::regprocedure,
  'public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure]) f),
 'stop_kept_on_starts',(select count(*)=3 from information_schema.columns where table_schema='public' and column_name='stop_at_start'
  and table_name in ('conversation_run_reservations','note_runs','channel_runs')),
 'channel_work_members_only',position('public.in_channel(k.id)' in pg_get_functiondef('public.card_archive_stops(uuid,bigint[])'::regprocedure))>0,
 'hand_closes',public.reply_card_valid('hand','closed','{"app":"WordPress","line":"Press Publish.","rows":[]}'::jsonb)
);
