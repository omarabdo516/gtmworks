-- A chat tied to a Card: whose it is, asked only through the Card's visibility.
select json_build_object(
 -- A Card's own chat tab went with the Card window (#678) and its starter with the Card cutover (#684); a chat tied to
 -- a Card stays its person's Conversation, and who it is is asked as before.
 'card_chats_start_from_a_chat',to_regprocedure('public.start_card_conversation(uuid,bigint,uuid)') is null,
 'members_ask_whose_chat',(select prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.card_chat_person(uuid,bigint)'::regprocedure)
  and has_function_privilege('authenticated','public.card_chat_person(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.card_chat_person(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.card_chat_person(uuid,bigint)','execute'),
 'whose_chat_follows_the_card',position('can_see_card' in pg_get_functiondef('public.card_chat_person(uuid,bigint)'::regprocedure))>0
);
