-- #150: a handover is kept in a Conversation or in a channel message, and a channel's is moved and drawn on its own
-- terms. Grants are kept: only the worker keeps and moves a handover or pins a channel Run's tools, a signed-in Member
-- reads the channel's record, and who may hand over stays private.
select json_build_object(
 'one_place',exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_handovers'
   and column_name='conversation_id' and is_nullable='YES')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_handovers'
   and column_name='channel_message_id')
  and exists(select 1 from pg_constraint where conrelid='public.agent_handovers'::regclass and conname='agent_handovers_one_place')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='agent_handovers_channel_call'
   and indexdef like 'CREATE UNIQUE INDEX%'),
 'answer_and_reply',exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_handovers'
   and column_name='target_closed_at')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_handovers'
   and column_name='reply')
  and position('r.conversation_id is null' in pg_get_functiondef('public.close_handover_follow_up(bigint,text,text,text)'::regprocedure))>0,
 'handover_kept',has_function_privilege('service_role','public.channel_hand_to_agent(bigint,text,text,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.channel_hand_to_agent(bigint,text,text,text,text,text)','execute')
  and position('channel_message_id' in pg_get_functiondef('public.channel_hand_to_agent(bigint,text,text,text,text,text)'::regprocedure))>0
  and position('channel_can_hand_over' in pg_get_functiondef('public.channel_hand_to_agent(bigint,text,text,text,text,text)'::regprocedure))>0,
 'channel_pins_handover',position('''hand_to_agent''' in pg_get_functiondef('public.pin_channel_run(bigint,jsonb)'::regprocedure))>0
  and position('channel_can_hand_over' in pg_get_functiondef('public.pin_channel_run(bigint,jsonb)'::regprocedure))>0,
 'agents_named',has_function_privilege('service_role','public.channel_handover_agents(bigint)','execute')
  and not has_function_privilege('authenticated','public.channel_handover_agents(bigint)','execute')
  and position('channel_agent' in pg_get_functiondef('public.channel_handover_agents(bigint)'::regprocedure))>0,
 'channel_legs',position('channel_message_id' in pg_get_functiondef('public.handovers_due(uuid,bigint,uuid)'::regprocedure))>0
  and has_function_privilege('service_role','public.handovers_due(uuid,bigint,uuid)','execute')
  and not has_function_privilege('authenticated','public.handovers_due(uuid,bigint,uuid)','execute')
  and position('md5(chan::text' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0
  and position('in this channel' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0
  and position('target_closed_at' in pg_get_functiondef('public.close_handover_target(bigint,text,text,text)'::regprocedure))>0,
 'channel_reads_its_record',has_function_privilege('authenticated','public.channel_handovers(uuid)','execute')
  and not has_function_privilege('anon','public.channel_handovers(uuid)','execute')
  and not has_function_privilege('service_role','public.channel_handovers(uuid)','execute')
  and position('in_channel' in pg_get_functiondef('public.channel_handovers(uuid)'::regprocedure))>0,
 'who_hands_over_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['public','anon','authenticated','service_role']) r,
   unnest(array['public.channel_can_hand_over(uuid,uuid,uuid)']) f),
 'handover_row_read_by_channel',exists(select 1 from pg_policies where schemaname='public' and tablename='agent_handovers'
   and policyname='agent_handovers_channel_read')
  and has_column_privilege('authenticated','public.agent_handovers','channel_message_id','select'),
 'log_row_read_by_channel',position('agent_handovers' in (select qual from pg_policies where schemaname='public'
   and tablename='company_log' and policyname='company_log_read'))>0
  and position('handover_in_channel' in (select qual from pg_policies where schemaname='public'
   and tablename='company_log' and policyname='company_log_read'))>0
  and has_function_privilege('authenticated','public.handover_in_channel(bigint)','execute')
  and not has_function_privilege('anon','public.handover_in_channel(bigint)','execute')
);
