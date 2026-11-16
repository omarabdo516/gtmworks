select json_build_object(
 'general_and_team',(select pg_get_constraintdef(oid) like '%general%team%' from pg_constraint where conrelid='public.channels'::regclass and conname='channels_kind_check')
  and exists(select 1 from pg_constraint where conrelid='public.channels'::regclass and conname='channels_team_named')
  and exists(select 1 from pg_indexes where schemaname='public' and tablename='channels' and indexname='channels_team_name'),
 'people_and_agents_only_in_team_channels',(select count(*)=2 from pg_constraint where contype='f' and confrelid='public.channels'::regclass
  and conrelid in ('public.channel_people'::regclass,'public.channel_agents'::regclass) and array_length(conkey,1)=3),
 'rls_on_all_three',(select bool_and(relrowsecurity) from pg_class where oid in ('public.channel_people'::regclass,'public.channel_agents'::regclass,'public.channel_reads'::regclass)),
 'no_client_table_writes',(select bool_and(not has_table_privilege('authenticated',t,'insert,update,delete,truncate') and not has_table_privilege('anon',t,'select,insert,update,delete')
  and has_table_privilege('authenticated',t,'select'))
  from unnest(array['public.channel_people','public.channel_agents','public.channel_reads']) t),
 'internals_uncallable',(select bool_and(not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.channel_person(uuid,uuid)','public.channel_agent(uuid,uuid,uuid)','public.channel_mention_in(uuid,uuid,text)','public.start_general_read()',
   'public.channel_member(uuid,uuid)','public.channel_mention(uuid,uuid,text)']) f),
 'members_callable',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.channel_agent_list(uuid)','public.channel_sidebar(uuid)','public.read_channel(uuid,bigint)','public.create_channel(uuid,uuid,text,uuid[],uuid[])',
   'public.set_channel_person(uuid,uuid,boolean)','public.set_channel_agent(uuid,uuid,boolean)','public.post_channel_message(uuid,uuid,text)']) f),
 'post_calls_channel_agents',position('channel_mention_in(' in pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure))>0,
 'visibility_elsewhere_unchanged',position('channel' in pg_get_functiondef('public.agent_visible_to(uuid,uuid,uuid)'::regprocedure))=0
  and position('channel' in pg_get_functiondef('public.can_see_agent(uuid,uuid)'::regprocedure))=0,
 'joiners_start_read',exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname='members_general_read' and not tgisinternal),
 'every_member_has_a_general_read_position',not exists(select 1 from public.channels k join public.members m on m.company_id=k.company_id
  where k.kind='general' and not exists(select 1 from public.channel_reads r where r.channel_id=k.id and r.person_id=m.person_id))
);
