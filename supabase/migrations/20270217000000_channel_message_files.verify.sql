-- #156: a channel message keeps its images, every Member of the channel reads them, and only a Member who may write
-- keeps them.
select json_build_object(
 'table',to_regclass('public.channel_attachments') is not null,
 'columns',(select count(*)=8 from information_schema.columns where table_schema='public' and table_name='channel_attachments'
  and column_name in ('id','company_id','channel_id','send_key','message_id','position','path','created_at')),
 'linked_to_its_message',exists(select 1 from pg_constraint where conrelid='public.channel_attachments'::regclass
  and contype='f' and pg_get_constraintdef(oid) like '%channel_messages(id)%'),
 'members_read_them',exists(select 1 from pg_policies where schemaname='public' and tablename='channel_attachments'
  and policyname='channel_attachments_read' and cmd='SELECT' and qual like '%in_channel%'),
 'no_policy_writes_them',not exists(select 1 from pg_policies where schemaname='public' and tablename='channel_attachments' and cmd<>'SELECT'),
 'sender_writes_their_own',has_function_privilege('authenticated','public.reserve_channel_files(uuid,uuid,uuid,jsonb)','execute')
  and has_function_privilege('authenticated','public.discard_channel_files(uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.reserve_channel_files(uuid,uuid,uuid,jsonb)','execute')
  and not has_function_privilege('service_role','public.reserve_channel_files(uuid,uuid,uuid,jsonb)','execute'),
 'paths_stay_in_the_channel',(select count(*)=1 from pg_constraint where conrelid='public.channel_attachments'::regclass
  and contype='c' and pg_get_constraintdef(oid) like '%split_part(path%'),
 'server_reads_the_bytes',has_table_privilege('service_role','public.channel_attachments','select')
  and not has_table_privilege('anon','public.channel_attachments','select'),
 'one_file_per_path',(select count(*)=1 from pg_constraint where conrelid='public.channel_attachments'::regclass and contype='u'
  and pg_get_constraintdef(oid)='UNIQUE (company_id, path)'),
 'body_may_be_empty',(select pg_get_constraintdef(oid) like '%(length(body) >= 0)%' from pg_constraint
  where conname='channel_messages_body_check' and conrelid='public.channel_messages'::regclass),
 'post_allows_images_alone',position($q$or btrim(message)='' or$q$ in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))=0,
 'spaces_still_refused',position($q$(length(message)>0 and btrim(message)='')$q$ in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0,
 'start_says_which_run_carries_them',(select pg_get_function_result(p.oid) like '%has_files boolean%'
  from pg_proc p where p.oid='public.begin_channel_start(bigint)'::regprocedure),
 'company_rules_skip_the_channels_folder',(select bool_and(coalesce(qual,with_check) like '%channels%') from pg_policies
  where schemaname='storage' and tablename='objects' and policyname in ('creative_read','creative_write')),
 'only_channel_members_read_its_bytes',exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
  and policyname='channel_file_read' and cmd='SELECT' and qual like '%in_channel%' and qual like '%channels%')
);
