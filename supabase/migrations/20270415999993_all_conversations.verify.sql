-- #673: every Conversation keeps the time of its newest message, and All conversations' helpers are no one's to call
-- (its two readers are 20270415999995's).
select json_build_object(
 'newest_kept',(select bool_and(v.last_message_at=coalesce((select max(m.created_at) from public.conversation_messages m where m.conversation_id=v.id),v.created_at)) is not false from public.conversations v),
 'newest_indexed',to_regclass('public.conversations_newest') is not null,
 'kept_on_each_message',exists(select 1 from pg_trigger where tgname='conversation_messages_newest' and tgrelid='public.conversation_messages'::regclass),
 'helpers_closed',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['public.search_fold(text)','public.conversation_title(uuid,text)',
  'public.own_conversations(uuid)','public.keep_conversation_newest()']) f, unnest(array['anon','authenticated','service_role']) r),
 'own_only',position('v.person_id=(select auth.uid())' in pg_get_functiondef('public.own_conversations(uuid)'::regprocedure))>0,
 'folds_arabic',public.search_fold('  مُـــهمّة أإآٱ مستوى  ')='مهمه اااا مستوي'
);
