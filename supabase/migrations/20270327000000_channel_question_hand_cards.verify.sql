-- #149: a channel's question and handed step are reply cards the whole channel's writers answer once; the main Agent's
-- question names the Member it was addressed to, and "Done it" asks that Agent to pick up as a Run of the channel.
-- Grants are kept: only the worker tracks and settles a Run's question or shows its cards, an answering Member claims
-- them, and a channel member reads the answer's log row.
select json_build_object(
 'question_addressed',exists(select 1 from information_schema.columns where table_schema='public' and table_name='reply_cards'
   and column_name='addressed_to' and is_nullable='YES')
  and exists(select 1 from pg_constraint where conrelid='public.reply_cards'::regclass and conname='reply_cards_addressed'),
 'hand_prompt_hidden',exists(select 1 from information_schema.columns where table_schema='public' and table_name='channel_messages'
   and column_name='hand_card')
  and has_column_privilege('authenticated','public.channel_messages','hand_card','select'),
 'question_tracked',has_function_privilege('service_role','public.track_channel_question(bigint,text,jsonb,boolean,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.track_channel_question(bigint,text,jsonb,boolean,timestamptz)','execute')
  and position('addressed_to' in pg_get_functiondef('public.track_channel_question(bigint,text,jsonb,boolean,timestamptz)'::regprocedure))>0,
 'question_settled',has_function_privilege('service_role','public.settle_channel_question(bigint,text)','execute')
  and not has_function_privilege('authenticated','public.settle_channel_question(bigint,text)','execute')
  and position('agent_question_answered' in pg_get_functiondef('public.settle_channel_question(bigint,text)'::regprocedure))>0,
 'question_closed_by_run_end',exists(select 1 from pg_trigger where tgrelid='public.channel_runs'::regclass
   and tgname='channel_runs_close_questions')
  and position('channel_question:' in pg_get_functiondef('public.close_ended_channel_questions()'::regprocedure))>0,
 'members_answer',has_function_privilege('authenticated','public.answer_channel_question(uuid,uuid,bigint,int,text,uuid)','execute')
  and not has_function_privilege('service_role','public.answer_channel_question(uuid,uuid,bigint,int,text,uuid)','execute')
  and not has_function_privilege('anon','public.answer_channel_question(uuid,uuid,bigint,int,text,uuid)','execute')
  and position('addressed_to' in pg_get_functiondef('public.answer_channel_question(uuid,uuid,bigint,int,text,uuid)'::regprocedure))>0,
 'members_done_it',has_function_privilege('authenticated','public.mark_channel_hand_done(uuid,uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.mark_channel_hand_done(uuid,uuid,bigint)','execute')
  and not has_function_privilege('anon','public.mark_channel_hand_done(uuid,uuid,bigint)','execute')
  and position('agent_hand_done' in pg_get_functiondef('public.mark_channel_hand_done(uuid,uuid,bigint)'::regprocedure))>0
  and position('channel_runs' in pg_get_functiondef('public.mark_channel_hand_done(uuid,uuid,bigint)'::regprocedure))>0,
 'handed_offered',position('''hand_over''' in pg_get_functiondef('public.pin_channel_run(bigint,jsonb)'::regprocedure))>0
  and position('''show_draft''' in pg_get_functiondef('public.pin_channel_run(bigint,jsonb)'::regprocedure))>0
  and position('''show_review''' in pg_get_functiondef('public.pin_channel_run(bigint,jsonb)'::regprocedure))>0,
 'hand_kept_open',position('''hand''' in pg_get_functiondef('public.channel_show_card(bigint,text,text,text,text,jsonb)'::regprocedure))>0
  and position('''open''' in pg_get_functiondef('public.channel_show_card(bigint,text,text,text,text,jsonb)'::regprocedure))>0,
 'waits_for_the_team',position('channel_question' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('channel_hand' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('addressed_to' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('in_channel' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0,
 'answer_log_read_by_channel',position('reply_card_answers' in (select qual from pg_policies where schemaname='public'
   and tablename='company_log' and policyname='company_log_read'))>0
  and position('in_channel' in (select qual from pg_policies where schemaname='public'
   and tablename='company_log' and policyname='company_log_read'))>0
  and position('reply_card_in_channel' in (select qual from pg_policies where schemaname='public'
   and tablename='company_log' and policyname='company_log_read'))>0
  and has_function_privilege('authenticated','public.reply_card_in_channel(bigint)','execute')
  and not has_function_privilege('anon','public.reply_card_in_channel(bigint)','execute')
);
