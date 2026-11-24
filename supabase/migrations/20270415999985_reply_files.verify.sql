-- #708: a reply's files are kept by the worker's own closes, beside the previous version's, with their names checked and
-- their paths built in the database; the names of files a reply could not hand over are read with its message.
select json_build_object(
 'missed_kept',(select count(*)=2 from information_schema.columns where table_schema='public' and column_name='missed_files'
  and table_name in ('conversation_messages','channel_messages')),
 'missed_read',has_column_privilege('authenticated','public.channel_messages','missed_files','select'),
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('authenticated',f,'execute')) from unnest(array['public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean,jsonb,text[])',
  'public.close_channel_run(bigint,text,text,text,bigint,bigint,jsonb,text[])']) f),
 'previous_kept',to_regprocedure('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)') is not null
  and to_regprocedure('public.close_channel_run(bigint,text,text,text,bigint,bigint)') is not null,
 'as_definer',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in
  ('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean,jsonb,text[])'::regprocedure,'public.close_channel_run(bigint,text,text,text,bigint,bigint,jsonb,text[])'::regprocedure)),
 'helpers_closed',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['public.reply_files_valid(jsonb,text[])','public.reply_hands_files(jsonb,text[])']) f,
  unnest(array['anon','authenticated','service_role']) r),
 'paths_built',position('md5(run)' in pg_get_functiondef('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean,jsonb,text[])'::regprocedure))>0
);
