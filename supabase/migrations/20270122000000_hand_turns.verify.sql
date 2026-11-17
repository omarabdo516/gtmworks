-- A queued turn may name the hand card it picks up from, one turn per card; the Agent is told who did the step, which
-- one and when; "Done it" queues that turn under the Conversation's turn lock and never through
-- reserve_conversation_turn; an open hand card waits in "Waiting on you" beside every earlier branch; the functions keep
-- their grants.
select json_build_object(
 'turn_names_its_card',exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversation_queued_turns' and column_name='hand_card')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='conversation_queued_turns_one_per_hand' and indexdef like '%UNIQUE%'),
 'agent_told_who_and_when',public.hand_turn_message('Omar','Publish the article','WordPress','2026-11-17 09:05:00+02')
  ='Omar did the step you handed over, "Publish the article" in WordPress, and pressed "Done it" at 2026-11-17 07:05 UTC. Pick up from there.',
 'done_queues_the_turn',position('conversation_queued_turns' in pg_get_functiondef('public.mark_hand_done(uuid,uuid,bigint)'::regprocedure))>0
  and position('conversation_turn:' in pg_get_functiondef('public.mark_hand_done(uuid,uuid,bigint)'::regprocedure))>0
  and position('reserve_conversation_turn' in pg_get_functiondef('public.mark_hand_done(uuid,uuid,bigint)'::regprocedure))=0
  and position('''agent_hand_done''' in pg_get_functiondef('public.mark_hand_done(uuid,uuid,bigint)'::regprocedure))>0,
 'hand_waits_on_the_person',position('''hand''' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('''question''' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0
  and position('agent_request' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0,
 'grants_kept',has_function_privilege('authenticated','public.mark_hand_done(uuid,uuid,bigint)','execute')
  and not has_function_privilege('anon','public.mark_hand_done(uuid,uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.mark_hand_done(uuid,uuid,bigint)','execute')
  and has_function_privilege('authenticated','public.waiting_list(uuid)','execute')
  and not has_function_privilege('anon','public.waiting_list(uuid)','execute')
  and not has_function_privilege('service_role','public.waiting_list(uuid)','execute'),
 'message_private',(select bool_and(not has_function_privilege(r,'public.hand_turn_message(text,text,text,timestamptz)','execute')) from unnest(array['anon','authenticated','service_role']) r)
);
