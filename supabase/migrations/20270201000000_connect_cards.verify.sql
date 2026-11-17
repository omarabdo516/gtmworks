-- A connect card is a known kind beside every earlier one, which hold as before: open or postponed, never connected, an
-- app key and a reason of at most 200 characters; any Agent's runs are offered ask_for_app after hand_over; a connect
-- card is kept open and writes no log row; only the Conversation's person, as an Owner, postpones it, and writes no row;
-- the functions keep their grants.
select json_build_object(
 'connect_is_a_kind',public.reply_card_valid('connect','open','{"app":"amplitude","reason":"To read which leads bought."}')
  and public.reply_card_valid('connect','postponed','{"app":"amplitude","reason":"To read which leads bought."}')
  and not public.reply_card_valid('connect','connected','{"app":"amplitude","reason":"To read which leads bought."}')
  and not public.reply_card_valid('connect','open',jsonb_build_object('app','amplitude','reason',repeat('r',201)))
  and not public.reply_card_valid('connect','open','{"app":"Amplitude","reason":"r"}')
  and not public.reply_card_valid('connect','open','{"app":"amplitude"}'),
 'others_hold_as_before',public.reply_card_valid('draft','shown','{"line":"Draft · Meta Ads","rows":[{"label":"Goal","value":"Leads"}]}')
  and public.reply_card_valid('review','shown','{"line":"3 texts","items":[{"text":"A","fine":true,"note":"B"}],"decision":"C"}')
  and public.reply_card_valid('question','open','{"question":"Which audience first?","choices":["Parents","Students"],"multiple":false}')
  and public.reply_card_valid('hand','open','{"app":"WordPress","line":"The draft is ready","rows":[]}')
  and public.reply_card_valid('permission','open','{"description":"delete the old exports","command":"rm -r exports","choices":["once","deny"]}'),
 'offered_after_hand_over',position('''hand_over''' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))
  between 1 and position('''ask_for_app''' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure)),
 'connect_kept_open_unlogged',position('''connect''' in pg_get_functiondef('public.agent_show_card(uuid,text,text,text,text,jsonb)'::regprocedure))>0
  and position('log_chat_event' in pg_get_functiondef('public.agent_show_card(uuid,text,text,text,text,jsonb)'::regprocedure))>0,
 'later_writes_no_row',position('is_company_owner' in pg_get_functiondef('public.postpone_app_card(uuid,uuid,bigint)'::regprocedure))>0
  and position('company_log' in pg_get_functiondef('public.postpone_app_card(uuid,uuid,bigint)'::regprocedure))=0
  and position('log_chat_event' in pg_get_functiondef('public.postpone_app_card(uuid,uuid,bigint)'::regprocedure))=0,
 'person_postpones',has_function_privilege('authenticated','public.postpone_app_card(uuid,uuid,bigint)','execute')
  and not has_function_privilege('anon','public.postpone_app_card(uuid,uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.postpone_app_card(uuid,uuid,bigint)','execute'),
 'worker_shows',has_function_privilege('service_role','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute'),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.reply_card_valid(text,text,jsonb)','public.run_tools(uuid,uuid,uuid)']) f)
);
