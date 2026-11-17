-- A hand card is a known kind beside the draft, the review and the question, which hold as before: open or done, its
-- address only https; who marked it done and when are kept exactly on a done hand card; any Agent's runs are offered
-- hand_over after show_review; a hand card is kept open; only the Conversation's person marks it, and it is logged from
-- the answers' source; the functions keep their grants.
select json_build_object(
 'hand_is_a_kind',public.reply_card_valid('hand','open','{"app":"WordPress","line":"The draft is ready","rows":[{"label":"Title","value":"Accounting in 3 months"}]}')
  and public.reply_card_valid('hand','done','{"app":"WordPress","line":"The draft is ready","rows":[],"url":"https://example.com/wp-admin/post.php?post=7","note":"I will watch it."}')
  and not public.reply_card_valid('hand','shown','{"app":"WordPress","line":"The draft is ready","rows":[]}')
  and not public.reply_card_valid('hand','open','{"app":"WordPress","line":"The draft is ready","rows":[],"url":"http://example.com"}')
  and not public.reply_card_valid('hand','open','{"app":"WordPress","line":"The draft is ready","rows":[],"url":"https://example.com/a b"}')
  and public.reply_card_valid('hand','open','{"app":"WordPress","line":"The draft is ready","rows":[],"url":"HTTPS://example.com/a"}')
  and not public.reply_card_valid('hand','open','{"app":"WordPress","line":"The draft is ready","rows":[],"url":null}')
  and not public.reply_card_valid('hand','open','{"line":"The draft is ready","rows":[]}')
  and not public.reply_card_valid('hand','open','{"app":"WordPress","line":"The draft is ready","rows":[],"decision":"C"}'),
 'others_hold_as_before',public.reply_card_valid('draft','shown','{"line":"Draft · Meta Ads","rows":[{"label":"Goal","value":"Leads"}]}')
  and public.reply_card_valid('review','shown','{"line":"3 texts","items":[{"text":"A","fine":true,"note":"B"}],"decision":"C"}')
  and public.reply_card_valid('question','open','{"question":"Which audience first?","choices":["Parents","Students"],"multiple":false}')
  and not public.reply_card_valid('draft','open','{"line":"Draft","rows":[]}'),
 'done_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='reply_cards' and column_name in ('done_by','done_at'))=2
  and exists(select 1 from pg_constraint where conname='reply_cards_done' and conrelid='public.reply_cards'::regclass),
 'offered_after_show_review',position('''show_review''' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))
  between 1 and position('''hand_over''' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure)),
 'hand_kept_open',position('''open''' in pg_get_functiondef('public.agent_show_card(uuid,text,text,text,text,jsonb)'::regprocedure))>0
  and position('''edits''' in pg_get_functiondef('public.agent_show_card(uuid,text,text,text,text,jsonb)'::regprocedure))>0,
 'done_logged_from_the_answers',position('''agent_hand_done''' in pg_get_functiondef('public.mark_hand_done(uuid,uuid,bigint)'::regprocedure))>0
  and position('''reply_card_answers''' in pg_get_functiondef('public.mark_hand_done(uuid,uuid,bigint)'::regprocedure))>0,
 'person_marks',has_function_privilege('authenticated','public.mark_hand_done(uuid,uuid,bigint)','execute')
  and not has_function_privilege('anon','public.mark_hand_done(uuid,uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.mark_hand_done(uuid,uuid,bigint)','execute'),
 'worker_shows',has_function_privilege('service_role','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute'),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.reply_card_valid(text,text,jsonb)','public.run_tools(uuid,uuid,uuid)']) f)
);
