-- #883: every Conversation is on the Engine; the face and its waiting read nothing of the old record.
select json_build_object(
 'send_has_no_switch',position('engine_conversations' in pg_get_functiondef('public.open_engine_conversation(uuid,uuid,uuid,text)'::regprocedure))=0
  and position('''old''' in pg_get_functiondef('public.open_engine_conversation(uuid,uuid,uuid,text)'::regprocedure))=0,
 'send_reads_no_old_record',position('conversation_messages' in pg_get_functiondef('public.open_engine_conversation(uuid,uuid,uuid,text)'::regprocedure))=0
  and position('conversation_queued_turns' in pg_get_functiondef('public.open_engine_conversation(uuid,uuid,uuid,text)'::regprocedure))=0,
 'first_conversation_on_the_engine',position('engine_conversations' in pg_get_functiondef('public.open_first_conversation(uuid,uuid,uuid,text)'::regprocedure))=0
  and position('conversation_messages' in pg_get_functiondef('public.open_first_conversation(uuid,uuid,uuid,text)'::regprocedure))=0,
 'work_reads_no_old_record',position('conversation_messages' in pg_get_functiondef('public.agent_work(uuid)'::regprocedure))=0
  and position('conversation_run_ends' in pg_get_functiondef('public.agent_work(uuid)'::regprocedure))=0,
 'open_run_from_the_row',position('open_runs' in pg_get_functiondef('public.agent_open_run(uuid,uuid)'::regprocedure))>0
  and position('conversation_messages' in pg_get_functiondef('public.agent_open_run(uuid,uuid)'::regprocedure))=0,
 'no_screen_hands',position('where false' in pg_get_functiondef('public.screen_hands(uuid)'::regprocedure))>0,
 'face_leaves_out_old_cards',position('''question'',''hand'',''permission''' in pg_get_functiondef('public.agent_face_states(uuid)'::regprocedure))>0,
 'grants_kept',has_function_privilege('authenticated','public.open_engine_conversation(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.open_engine_conversation(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated','public.open_first_conversation(uuid,uuid,uuid,text)','execute')
  and has_function_privilege('authenticated','public.agent_face_states(uuid)','execute'),
 'old_record_kept',to_regclass('public.conversation_messages') is not null and to_regclass('public.conversation_attachments') is not null
  and to_regclass('public.conversation_queued_turns') is not null and to_regclass('public.conversation_run_ends') is not null
  and to_regclass('public.conversation_run_notes') is not null and to_regclass('public.conversation_run_reservations') is not null
);
