-- #675: an archived team channel is a time and a person on it; its Members' lists leave it out, its work stops, a Member's
-- message there and a change of who is in it are refused, its log rows are read by its Members alone, the four
-- functions are the signed-in person's own, run as their definer with an empty search path, and All conversations'
-- two readers ask archived_at of Conversations and channels alike.
select json_build_object(
 'columns',(select count(*)=2 from information_schema.columns where table_schema='public' and table_name='channels' and column_name in ('archived_at','archived_by') and is_nullable='YES'),
 'team_only',exists(select 1 from pg_constraint where conrelid='public.channels'::regclass and conname='channels_archived_team'),
 'history_closed',(select relrowsecurity from pg_class where oid='public.channel_archives'::regclass)
  and not has_table_privilege('authenticated','public.channel_archives','select'),
 'log_rows_in_channel',exists(select 1 from pg_policies where schemaname='public' and tablename='company_log' and policyname='channel_archive_rows' and permissive='RESTRICTIVE' and cmd='SELECT'),
 'people_kept',exists(select 1 from pg_trigger where tgrelid='public.channel_people'::regclass and tgname='channel_people_not_archived' and not tgisinternal)
  and position('archived_at' in pg_get_functiondef('public.set_channel_person(uuid,uuid,boolean)'::regprocedure))>0,
 'start_stopped',position('public.stop_named_channel_run(' in pg_get_functiondef('public.answer_channel_start(bigint,integer,text,smallint)'::regprocedure))>0,
 'write_refused',exists(select 1 from pg_trigger where tgrelid='public.channel_messages'::regclass and tgname='channel_messages_not_archived' and not tgisinternal),
 'member_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute')) from unnest(array['public.archive_channel(uuid,uuid)','public.restore_channel(uuid,uuid)',
  'public.archived_channels(uuid)','public.channel_archive_stops(uuid)']) f),
 'as_definer',(select count(*)=4 and bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.archive_channel(uuid,uuid)'::regprocedure,'public.restore_channel(uuid,uuid)'::regprocedure,
   'public.archived_channels(uuid)'::regprocedure,'public.channel_archive_stops(uuid)'::regprocedure)),
 'role_checked',position('public.can_manage_company(k.company_id)' in pg_get_functiondef('public.archive_channel(uuid,uuid)'::regprocedure))>0
  and position('public.can_manage_company(k.company_id)' in pg_get_functiondef('public.restore_channel(uuid,uuid)'::regprocedure))>0,
 'sidebar_current',position('archived_at is null' in pg_get_functiondef('public.channel_sidebar(uuid)'::regprocedure))>0,
 'work_stopped',position('public.stop_channel_work(' in pg_get_functiondef('public.archive_channel(uuid,uuid)'::regprocedure))>0,
 'listed_by_archive',position('k.archived_at is not null)=archived' in pg_get_functiondef('public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text)'::regprocedure))>0
  and position('v.archived_at is not null)=archived' in pg_get_functiondef('public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text)'::regprocedure))>0
  and position('archived_at' in pg_get_functiondef('public.conversation_counts(uuid)'::regprocedure))>0,
 'reader_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute')) from unnest(array['public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text)','public.conversation_counts(uuid)']) f),
 'readers_as_definer',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text)'::regprocedure,'public.conversation_counts(uuid)'::regprocedure))
);
