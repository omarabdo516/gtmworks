-- #151's channel Card: one Card a channel, tied by the database alone, made once from a Run, with its quiet line and log
-- row; the channel's board read answers the caller only.
select json_build_object(
 'card_link',exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='channel_id'),
 'one_card_a_channel',(select indisunique and pg_get_expr(indpred,indrelid) like '%channel_id IS NOT NULL%'
  from pg_index where indexrelid='public.work_cards_one_per_channel'::regclass),
 'one_place',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.work_cards'::regclass and conname='work_cards_one_place'))
  like '%conversation_id%' and pg_get_constraintdef((select oid from pg_constraint where conrelid='public.work_cards'::regclass and conname='work_cards_one_place')) like '%channel_id%',
 'note_takes_a_card',exists(select 1 from information_schema.columns where table_schema='public' and table_name='channel_notes' and column_name='card_id')
  and position('''card''' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.channel_notes'::regclass and conname='channel_notes_kind_check')))>0,
 'logged_from_its_source',position('''channel_cards''' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_log'::regclass and conname='company_log_source_check')))>0
  and position('''channel_replies''' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_log'::regclass and conname='company_log_source_check')))>0,
 'made_from_a_run',position('work_cards' in pg_get_functiondef('public.channel_run_card()'::regprocedure))>0
  and position('''team''' in pg_get_functiondef('public.channel_run_card()'::regprocedure))>0
  and position('progress' in pg_get_functiondef('public.channel_run_card()'::regprocedure))>0,
 'a_run_makes_it',exists(select 1 from pg_trigger where tgname='channel_runs_card' and tgrelid='public.channel_runs'::regclass and not tgisinternal),
 'a_reply_is_logged',exists(select 1 from pg_trigger where tgname='channel_messages_card' and tgrelid='public.channel_messages'::regclass and not tgisinternal),
 'tied_by_the_database',exists(select 1 from pg_trigger where tgname='work_card_channel_guard' and tgrelid='public.work_cards'::regclass and not tgisinternal),
 'read_by_its_member',has_function_privilege('authenticated','public.channel_board_card(uuid)','execute')
  and not has_function_privilege('anon','public.channel_board_card(uuid)','execute')
  and not has_function_privilege('service_role','public.channel_board_card(uuid)','execute'),
 'written_by_no_one',not has_function_privilege('authenticated','public.channel_run_card()','execute')
  and not has_function_privilege('authenticated','public.channel_reply_card()','execute')
);
