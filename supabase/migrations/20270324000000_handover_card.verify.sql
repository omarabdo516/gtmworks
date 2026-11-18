-- A handover's Card follows it: one Card a Conversation may have, one log row a handover may write, and both written by
-- the Lead's call alone.
select json_build_object(
 'call_only',has_function_privilege('service_role','public.lead_hand_to_agent(uuid,text,text,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.lead_hand_to_agent(uuid,text,text,text,text,text)','execute')
  and not has_function_privilege('anon','public.lead_hand_to_agent(uuid,text,text,text,text,text)','execute'),
 'card_follows',position('work_cards' in pg_get_functiondef('public.lead_hand_to_agent(uuid,text,text,text,text,text)'::regprocedure))>0
  and position('progress' in pg_get_functiondef('public.lead_hand_to_agent(uuid,text,text,text,text,text)'::regprocedure))>0
  and position('chat_card_title' in pg_get_functiondef('public.lead_hand_to_agent(uuid,text,text,text,text,text)'::regprocedure))>0,
 'logged_on_the_card',position('agent_handed_to' in pg_get_functiondef('public.lead_hand_to_agent(uuid,text,text,text,text,text)'::regprocedure))>0
  and position('''agent_handovers''' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_log'::regclass and conname='company_log_source_check')))>0,
 'one_card_a_chat',(select indisunique and pg_get_expr(indpred,indrelid) like '%conversation_id IS NOT NULL%' from pg_index where indexrelid='public.work_cards_one_per_conversation'::regclass),
 'one_row_a_handover',exists(select 1 from pg_constraint where conrelid='public.company_log'::regclass and contype='u'
  and conkey=array(select attnum from pg_attribute where attrelid='public.company_log'::regclass and attname in ('source','source_id') order by attnum)),
 'rows_follow_their_agents',position('can_see_agent' in (select qual from pg_policies where schemaname='public' and tablename='company_log' and policyname='company_log_read'))>0
);
