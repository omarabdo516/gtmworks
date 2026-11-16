-- A reply's cards are read-only to people, read by the Conversation's own person only, kept once per run and call, and
-- written only by the worker's one function; each kind is listed once, in reply_card_valid; any Agent's runs are offered
-- show_draft beside the tools they had; a card's log row carries its kind and title.
select json_build_object(
 'cards_read_only',(select relrowsecurity from pg_class where oid='public.reply_cards'::regclass)
  and has_table_privilege('authenticated','public.reply_cards','select')
  and not has_table_privilege('authenticated','public.reply_cards','insert,update,delete')
  and not has_table_privilege('anon','public.reply_cards','select,insert,update,delete')
  and not has_table_privilege('service_role','public.reply_cards','select,insert,update,delete')
  and not exists(select 1 from pg_policies where schemaname='public' and tablename='reply_cards' and cmd<>'SELECT'),
 'only_the_conversations_person_reads',exists(select 1 from pg_policies where schemaname='public' and tablename='reply_cards' and policyname='reply_cards_read'
  and qual like '%person_id = auth.uid()%' and qual like '%can_see_agent%'),
 'one_card_per_run_and_call',exists(select 1 from pg_constraint where conrelid='public.reply_cards'::regclass and contype='u'
  and pg_get_constraintdef(oid)='UNIQUE (conversation_id, run_id, call_id)'),
 'a_card_belongs_to_a_conversation_of_its_company',exists(select 1 from pg_constraint where conrelid='public.reply_cards'::regclass and contype='f'
  and confrelid='public.conversations'::regclass and array_length(conkey,1)=2),
 'every_row_is_a_known_kind',(select count(*)=2 from pg_constraint where conrelid='public.reply_cards'::regclass and conname in ('reply_cards_title','reply_cards_kind'))
  and public.reply_card_valid('draft','shown','{"line":"Draft · Meta Ads","rows":[{"label":"Goal","value":"Leads"}]}')
  and not public.reply_card_valid('draft','answered','{"line":"Draft · Meta Ads","rows":[]}')
  and not public.reply_card_valid('nope','shown','{"line":"Draft · Meta Ads","rows":[]}'),
 'worker_shows',has_function_privilege('service_role','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute'),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.reply_card_text(jsonb,integer)','public.reply_card_valid(text,text,jsonb)','public.may_show_reply_cards(uuid,uuid,uuid)']) f),
 'offered_beside_the_other_tools',(select bool_and(position(p in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0)
  from unnest(array['may_use_lead_tools','may_ask_lead_for_agents','may_tell_agent_rules','may_suggest_agent_rules','may_show_reply_cards']) p),
 'logged_with_its_card',public.log_agent_action('AGENT_CARD_SHOWN')='agent_card_shown'
  and position('''card''' in pg_get_functiondef('public.log_agent_change()'::regprocedure))>0
  and position('''teller''' in pg_get_functiondef('public.log_agent_change()'::regprocedure))>0
);
