-- #674: a Conversation keeps who archived it and when, and what its Engine session last took; a person's archive,
-- restore and what-stops are theirs, run as their definer with an empty search path; the worker's two are the worker's;
-- a message its person writes brings it back, and every Run's session is kept.
select json_build_object(
 'archived_kept',(select count(*)=5 from information_schema.columns where table_schema='public' and table_name='conversations'
  and column_name in ('archived_at','archived_by','session_archived','session_missing_since','session_mark_after')),
 'history_closed',(select relrowsecurity from pg_class where oid='public.conversation_archives'::regclass)
  and not has_table_privilege('authenticated','public.conversation_archives','select')
  and not has_function_privilege('authenticated','public.log_conversation_archive(uuid,boolean,uuid)','execute'),
 'who_kept',exists(select 1 from pg_constraint where conrelid='public.conversations'::regclass and conname='conversations_archived_by_archived'),
 'marks_indexed',to_regclass('public.conversations_session_mark') is not null,
 'person_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute')) from unnest(array['public.archive_conversations(uuid,uuid[])','public.restore_conversations(uuid,uuid[])',
  'public.conversation_archive_stops(uuid,uuid[])']) f),
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('authenticated',f,'execute')) from unnest(array['public.conversation_sessions_to_mark()','public.conversation_session_marked(uuid,boolean)',
  'public.conversation_session_missing(uuid,boolean)']) f),
 'as_definer',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('public.archive_conversations(uuid,uuid[])'::regprocedure,
  'public.restore_conversations(uuid,uuid[])'::regprocedure,'public.conversation_archive_stops(uuid,uuid[])'::regprocedure,'public.conversation_sessions_to_mark()'::regprocedure,
  'public.conversation_session_marked(uuid,boolean)'::regprocedure,'public.conversation_session_missing(uuid,boolean)'::regprocedure,'public.restore_written_conversation()'::regprocedure)),
 'helpers_closed',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['public.restore_written_conversation()']) f,
  unnest(array['anon','authenticated','service_role']) r),
 'own_only',position('own_conversations(c)' in pg_get_functiondef('public.archive_conversations(uuid,uuid[])'::regprocedure))>0,
 'restored_by_writing',(select count(*)=3 from pg_trigger where tgfoid='public.restore_written_conversation()'::regprocedure and not tgisinternal),
 'session_kept',position('run_outcome in (''completed'',''stopped'') or carded' in pg_get_functiondef('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)'::regprocedure))>0
);
