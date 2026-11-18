select json_build_object(
 'every_company_has_one_general',not exists(select 1 from public.companies c where (select count(*) from public.channels k where k.company_id=c.id and k.kind='general')<>1),
 'general_made_with_company',exists(select 1 from pg_trigger where tgrelid='public.companies'::regclass and tgname='companies_general_channel' and not tgisinternal),
 'rls_on_all_three',(select bool_and(relrowsecurity) from pg_class where oid in ('public.channels'::regclass,'public.channel_messages'::regclass,'public.channel_runs'::regclass)),
 'no_client_table_writes',not has_table_privilege('authenticated','public.channels','insert,update,delete,truncate')
  and not has_table_privilege('authenticated','public.channel_messages','insert,update,delete,truncate')
  and not has_table_privilege('authenticated','public.channel_runs','insert,update,delete,truncate')
  and not has_table_privilege('anon','public.channels','select,insert,update,delete')
  and not has_table_privilege('anon','public.channel_messages','select,insert,update,delete')
  and not has_table_privilege('anon','public.channel_runs','select,insert,update,delete'),
 'members_read',has_table_privilege('authenticated','public.channels','select')
  and has_column_privilege('authenticated','public.channel_messages','body','select')
  and has_column_privilege('authenticated','public.channel_runs','outcome','select'),
 'keys_and_run_internals_hidden',not has_column_privilege('authenticated','public.channel_messages','send_key','select')
  and not has_column_privilege('authenticated','public.channel_runs','input','select')
  and not has_column_privilege('authenticated','public.channel_runs','instructions','select')
  and not has_column_privilege('authenticated','public.channel_runs','connection_id','select')
  and not has_column_privilege('authenticated','public.channel_runs','run_id','select'),
 'lifecycle_service_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.channel_runs_due(uuid,bigint,bigint)','public.begin_channel_start(bigint)','public.answer_channel_start(bigint,integer,text)','public.close_channel_run(bigint,text,text,text,bigint,bigint)']) f),
 'internals_uncallable',(select bool_and(not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.channel_member(uuid,uuid)','public.channel_mention(uuid,uuid,text)','public.add_general_channel()','public.refuse_channel_change()']) f),
 'members_callable',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.post_channel_message(uuid,uuid,text)','public.in_channel(uuid)','public.channel_members(uuid)']) f),
 'append_only',exists(select 1 from pg_trigger where tgrelid='public.channel_messages'::regclass and tgname='channel_messages_append_only' and not tgisinternal),
 'one_run_one_reply',exists(select 1 from pg_constraint where conrelid='public.channel_messages'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (reply_to)')
  and exists(select 1 from pg_constraint where conrelid='public.channel_runs'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (message_id)'),
 'move_waits_for_channel_runs',position('channel_runs' in pg_get_functiondef('public.move_company_profile(uuid)'::regprocedure))>0
);
