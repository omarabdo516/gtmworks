-- A Card reads its chat's wait as a field of its own, answered for the caller's own Company only; the person's list and
-- the Card wait by one rule; a question and a hand name their chat's Card beside every earlier branch; the three writers
-- place their rows through log_chat_event, which nobody calls directly; the log stays append-only; grants are kept.
select json_build_object(
 'card_wait_is_a_field',(select prosecdef from pg_proc where oid='public.card_wait(public.work_cards)'::regprocedure)
  and has_function_privilege('authenticated','public.card_wait(public.work_cards)','execute')
  and not has_function_privilege('anon','public.card_wait(public.work_cards)','execute')
  and not has_function_privilege('service_role','public.card_wait(public.work_cards)','execute')
  and position('can_see_card' in pg_get_functiondef('public.card_wait(public.work_cards)'::regprocedure))>0
  and position('is_member' in pg_get_functiondef('public.card_wait(public.work_cards)'::regprocedure))>0,
 'one_rule',position('reply_card_waits' in pg_get_functiondef('public.card_wait(public.work_cards)'::regprocedure))>0
  and position('reply_card_waits' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and has_function_privilege('authenticated','public.reply_card_waits(public.reply_cards)','execute')
  and not has_function_privilege('anon','public.reply_card_waits(public.reply_cards)','execute')
  and not has_function_privilege('service_role','public.reply_card_waits(public.reply_cards)','execute'),
 'list_names_the_card',position('work_cards w where w.company_id=c and w.conversation_id=h.conversation_id' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('''hand''' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('''question''' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('agent_request' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('waiting_items' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('approval_holds' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and not (select prosecdef from pg_proc where oid='public.waiting_list(uuid)'::regprocedure),
 'writers_place_rows',(select bool_and(position('log_chat_event' in pg_get_functiondef(f))>0 and position('company_log' in pg_get_functiondef(f))=0)
  from unnest(array['public.agent_show_card(uuid,text,text,text,text,jsonb)','public.settle_question(bigint,text)','public.mark_hand_done(uuid,uuid,bigint)']::regprocedure[]) f),
 'writer_private',(select bool_and(not has_function_privilege(r,'public.log_chat_event(uuid,uuid,text,text,text,jsonb,uuid,text,bigint,timestamptz)','execute')) from unnest(array['anon','authenticated','service_role']) r),
 'log_permanent',exists(select 1 from pg_trigger where tgname='company_log_append_only' and tgrelid='public.company_log'::regclass)
  and position('raise exception ''logIsPermanent''' in pg_get_functiondef('public.refuse_log_change()'::regprocedure))>0
  and position('reply_card' in pg_get_functiondef('public.refuse_log_change()'::regprocedure))=0,
 'grants_kept',has_function_privilege('authenticated','public.mark_hand_done(uuid,uuid,bigint)','execute')
  and not has_function_privilege('anon','public.mark_hand_done(uuid,uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.mark_hand_done(uuid,uuid,bigint)','execute')
  and has_function_privilege('service_role','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and has_function_privilege('service_role','public.settle_question(bigint,text)','execute')
  and not has_function_privilege('authenticated','public.settle_question(bigint,text)','execute')
  and has_function_privilege('authenticated','public.waiting_list(uuid)','execute')
  and not has_function_privilege('anon','public.waiting_list(uuid)','execute')
  and not has_function_privilege('service_role','public.waiting_list(uuid)','execute')
);
