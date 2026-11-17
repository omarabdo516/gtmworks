-- A permission request is a waiting kind in a Conversation and a Card's wait, a channel's requests have their table, read
-- under the channel's rule and written only by its functions, a channel Run's end closes them, a decision is logged from
-- their source, and the functions keep their grants.
select json_build_object(
 'permission_waits',position('''permission''' in pg_get_functiondef('public.reply_card_waits(public.reply_cards)'::regprocedure))>0
  and position('''permission''' in pg_get_functiondef('public.card_wait(public.work_cards)'::regprocedure))>0
  and position('''channel_permission''' in pg_get_functiondef('public.waiting_list(uuid)'::regprocedure))>0,
 'channel_table',(select relrowsecurity from pg_class where oid='public.channel_permissions'::regclass)
  and exists(select 1 from pg_policies where schemaname='public' and tablename='channel_permissions' and policyname='channel_permissions_read' and cmd='SELECT')
  and has_table_privilege('authenticated','public.channel_permissions','select')
  and not has_table_privilege('authenticated','public.channel_permissions','insert,update,delete')
  and not has_table_privilege('anon','public.channel_permissions','select'),
 'run_end_closes',exists(select 1 from pg_trigger where tgname='channel_runs_close_permissions' and tgrelid='public.channel_runs'::regclass),
 'logged_from_its_source',position('''channel_permissions''' in pg_get_constraintdef((select oid from pg_constraint where conname='company_log_source_check')))>0,
 'caller_decides',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.decide_channel_permission(uuid,bigint,text)','public.channel_permission_waits(public.channel_permissions)']) f),
 'closers_track_and_settle',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text)','public.settle_channel_permission(bigint,text)']) f),
 'trigger_private',(select bool_and(not has_function_privilege(r,'public.close_ended_channel_permissions()','execute')) from unnest(array['anon','authenticated','service_role']) r)
);
