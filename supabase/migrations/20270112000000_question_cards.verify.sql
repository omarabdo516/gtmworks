-- A question is a known kind beside the draft and the review, which hold as before: an open card holds no answer and an
-- answered or sending one holds it; one open question per Conversation; the open question waits in "Waiting on you";
-- its answer is logged from its own source; policy 3; the functions keep their grants.
select json_build_object(
 'question_is_a_kind',public.reply_card_valid('question','open','{"question":"Which audience first?","choices":["Parents","Students"],"multiple":false}')
  and public.reply_card_valid('question','open','{"question":"What should the tone be?","choices":[],"multiple":false}')
  and public.reply_card_valid('question','answered','{"question":"Which audience first?","choices":["Parents","Students"],"multiple":false,"answer":"Students"}')
  and public.reply_card_valid('question','sending','{"question":"Which audience first?","choices":["Parents","Students"],"multiple":false,"answer":"Students"}')
  and public.reply_card_valid('question','closed','{"question":"Which audience first?","choices":["Parents"],"multiple":false}')
  and public.reply_card_valid('question','closed','{"question":"Which audience first?","choices":["Parents"],"multiple":false,"answer":"Parents"}')
  and not public.reply_card_valid('question','open','{"question":"Which audience first?","choices":["Parents"],"multiple":false,"answer":"Parents"}')
  and not public.reply_card_valid('question','answered','{"question":"Which audience first?","choices":["Parents"],"multiple":false}')
  and not public.reply_card_valid('question','shown','{"question":"Which audience first?","choices":["Parents"],"multiple":false}')
  and not public.reply_card_valid('question','open','{"question":"Which?","choices":["A","B","C","D","E"],"multiple":false}')
  and not public.reply_card_valid('question','open','{"question":" Which?","choices":[],"multiple":false}'),
 'others_hold_as_before',public.reply_card_valid('draft','shown','{"line":"Draft · Meta Ads","rows":[{"label":"Goal","value":"Leads"}]}')
  and public.reply_card_valid('review','shown','{"line":"3 texts","items":[{"text":"A","fine":true,"note":"B"}],"decision":"C"}')
  and not public.reply_card_valid('draft','answered','{"line":"Draft","rows":[]}'),
 'answer_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='reply_cards' and column_name in ('answered_by','answered_at','answer_key'))=3
  and exists(select 1 from pg_constraint where conname='reply_cards_answer' and conrelid='public.reply_cards'::regclass),
 'one_open_question',exists(select 1 from pg_indexes where schemaname='public' and indexname='reply_cards_one_question' and indexdef like '%UNIQUE%'),
 'waits_on_the_person',position('''question''' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('agent_request' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0,
 'logged_from_its_source',position('''reply_card_answers''' in pg_get_constraintdef((select oid from pg_constraint where conname='company_log_source_check')))>0
  and position('''member_invitations''' in pg_get_constraintdef((select oid from pg_constraint where conname='company_log_source_check')))>0,
 'no_policy_copy',to_regprocedure('public.engine_tool_policy()') is null,
 'person_answers',has_function_privilege('authenticated','public.answer_question(uuid,uuid,bigint,int,text,uuid,int[])','execute')
  and not has_function_privilege('anon','public.answer_question(uuid,uuid,bigint,int,text,uuid,int[])','execute')
  and not has_function_privilege('service_role','public.answer_question(uuid,uuid,bigint,int,text,uuid,int[])','execute'),
 'closers_track_and_settle',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.track_run_question(uuid,text,jsonb,boolean,timestamptz)','public.settle_question(bigint,text)']) f),
 'helpers_private',not has_function_privilege('authenticated','public.reply_card_valid(text,text,jsonb)','execute')
  and has_function_privilege('authenticated','public.waiting_list(uuid)','execute') and not has_function_privilege('anon','public.waiting_list(uuid)','execute')
);
