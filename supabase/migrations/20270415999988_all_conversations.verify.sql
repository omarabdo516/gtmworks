-- #673: every Conversation keeps the time of its newest message, and All conversations' two readers are the reader's
-- own, run as their definer with an empty search path; their helpers are no one's to call.
select json_build_object(
 'newest_kept',(select bool_and(v.last_message_at=coalesce((select max(m.created_at) from public.conversation_messages m where m.conversation_id=v.id),v.created_at)) is not false from public.conversations v),
 'newest_indexed',to_regclass('public.conversations_newest') is not null,
 'kept_on_each_message',exists(select 1 from pg_trigger where tgname='conversation_messages_newest' and tgrelid='public.conversation_messages'::regclass),
 'reader_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute')) from unnest(array['public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text)','public.conversation_counts(uuid)']) f),
 'as_definer',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text)'::regprocedure,'public.conversation_counts(uuid)'::regprocedure)),
 'helpers_closed',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['public.search_fold(text)','public.conversation_title(uuid,text)',
  'public.own_conversations(uuid)','public.keep_conversation_newest()']) f, unnest(array['anon','authenticated','service_role']) r),
 'own_only',position('v.person_id=(select auth.uid())' in pg_get_functiondef('public.own_conversations(uuid)'::regprocedure))>0,
 'folds_arabic',public.search_fold('  مُـــهمّة أإآٱ مستوى  ')='مهمه اااا مستوي'
);
