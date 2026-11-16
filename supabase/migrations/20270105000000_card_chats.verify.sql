select json_build_object(
 'members_start_card_chats',(select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.start_card_conversation(uuid,bigint,uuid)'::regprocedure)
  and has_function_privilege('authenticated','public.start_card_conversation(uuid,bigint,uuid)','execute')
  and not has_function_privilege('anon','public.start_card_conversation(uuid,bigint,uuid)','execute')
  and not has_function_privilege('service_role','public.start_card_conversation(uuid,bigint,uuid)','execute'),
 'start_checks_writer_card_and_agent',position('conversation_can_write' in pg_get_functiondef('public.start_card_conversation(uuid,bigint,uuid)'::regprocedure))>0
  and position('can_see_card' in pg_get_functiondef('public.start_card_conversation(uuid,bigint,uuid)'::regprocedure))>0
  and position('can_see_agent' in pg_get_functiondef('public.start_card_conversation(uuid,bigint,uuid)'::regprocedure))>0,
 'members_ask_whose_chat',(select prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.card_chat_person(uuid,bigint)'::regprocedure)
  and has_function_privilege('authenticated','public.card_chat_person(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.card_chat_person(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.card_chat_person(uuid,bigint)','execute'),
 'whose_chat_follows_the_card',position('can_see_card' in pg_get_functiondef('public.card_chat_person(uuid,bigint)'::regprocedure))>0
);
