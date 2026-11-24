-- #671: a note's Run has a place to be stopped, the question of what archiving stops is the signed-in Member's own, the
-- stopping is archive_cards's alone, and a stopped Run keeps no new wait.
select json_build_object(
 'note_place',exists(select 1 from information_schema.columns where table_schema='public' and table_name='stopped_runs' and column_name='note_id')
  and position('num_nonnulls' in (select pg_get_constraintdef(oid) from pg_constraint where conname='stopped_runs_one_place' and conrelid='public.stopped_runs'::regclass))>0,
 'note_runs_stopped',position('public.note_runs' in pg_get_functiondef('public.stopped_runs_open()'::regprocedure))>0,
 'stops_member_only',has_function_privilege('authenticated','public.card_archive_stops(uuid,bigint[])','execute')
  and not has_function_privilege('anon','public.card_archive_stops(uuid,bigint[])','execute')
  and not has_function_privilege('service_role','public.card_archive_stops(uuid,bigint[])','execute'),
 'stop_inside_only',not has_function_privilege('authenticated','public.stop_card_work(uuid,bigint,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.stop_card_work(uuid,bigint,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.stop_card_work(uuid,bigint,uuid,uuid)','execute'),
 'as_definer',(select count(*)=2 and bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.card_archive_stops(uuid,bigint[])'::regprocedure,'public.stop_card_work(uuid,bigint,uuid,uuid)'::regprocedure)),
 'archive_stops',position('public.stop_card_work(' in pg_get_functiondef('public.archive_cards(uuid,bigint[])'::regprocedure))>0,
 'stopped_asks_nothing',(select bool_and(position('public.stopped_runs' in pg_get_functiondef(f))>0) from unnest(array[
  'public.track_run_question(uuid,text,jsonb,boolean,timestamptz)'::regprocedure,
  'public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure,
  'public.agent_show_card(uuid,text,text,text,text,jsonb)'::regprocedure,'public.channel_show_card(bigint,text,text,text,text,jsonb)'::regprocedure,
  'public.track_channel_question(bigint,text,jsonb,boolean,timestamptz)'::regprocedure,
  'public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure]) f),
 'hand_closes',public.reply_card_valid('hand','closed','{"app":"WordPress","line":"Press Publish.","rows":[]}'::jsonb)
);
