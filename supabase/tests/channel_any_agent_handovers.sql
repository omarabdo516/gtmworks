begin;
create extension if not exists pgtap with schema extensions;
select plan(34);
-- #476 (decision 0057 point 8): in a channel, any Agent of the channel hands a job to any other Agent of the Company, in
-- the channel or not. RS Learning has three Agents: Lead (the main one, on the Company's profile), Ads and Writer (each on
-- its own). The "launch" team channel holds the Manager (2), the Contributor (3) and the Viewer (4), not the Owner (1)
-- nor Member 5, and Writer alone of the Agents. Aleem has an Agent of its own, Critic, which is never a target here.
insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values
 ('a4760000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',true,true),
 ('a4760000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',true,true),
 ('a4760000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000003',true,true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions) values
 ('a4760000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f4760000-0000-0000-0000-000000000011','Lead','Runs the team',true,'co-10000000000000000000000000000001','Lead the team.'),
 ('a4760000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f4760000-0000-0000-0000-000000000012','Ads','Meta ads and their numbers',false,'ag-a4760000000000000000000000000012','Run the Meta ads.'),
 ('a4760000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','f4760000-0000-0000-0000-000000000013','Writer','Posts and articles',false,'ag-a4760000000000000000000000000013','Write the posts.'),
 ('a4760000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000003','f4760000-0000-0000-0000-000000000031','Critic','Reviews',false,'ag-a4760000000000000000000000000031','Review.');
insert into public.company_profiles(company_id,profile,skills_shared,tools_confirmed) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true,true);
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('c4760000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','team','launch','20000000-0000-0000-0000-000000000002','e4760000-0000-0000-0000-000000000001');
insert into public.channel_people(channel_id,company_id,person_id,added_by) values
 ('c4760000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002'),
 ('c4760000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002'),
 ('c4760000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002');
insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values
 ('c4760000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a4760000-0000-0000-0000-000000000013','20000000-0000-0000-0000-000000000002');
-- The channel's members were given Writer, the channel's Agent, as a team working with it is; none of them sees Ads.
-- The channel's Card is Writer's, and a Card's log rows follow its Agent (#367).
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a4760000-0000-0000-0000-000000000013'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a4760000-0000-0000-0000-000000000013'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a4760000-0000-0000-0000-000000000013');
insert into auth.users(id,email) values ('e4769000-0000-0000-0000-000000000001','karim.channel-handovers@example.test');
insert into public.people(id,name) values ('e4769000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','e4769000-0000-0000-0000-000000000001','manager');

-- The Contributor's and the Viewer's messages to Writer, each with its Run.
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','c4760000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Writer write the launch post',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c4760000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000004','مشاهد','@Writer write it all',gen_random_uuid());
select set_config('test.writer',(select id::text from public.channel_messages where body='@Writer write the launch post'),true);
select set_config('test.viewer',(select id::text from public.channel_messages where body='@Writer write it all'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at)
 select id,1,'10000000-0000-0000-0000-000000000001','c4760000-0000-0000-0000-000000000001','a4760000-0000-0000-0000-000000000013','Writer',gen_random_uuid(),body,
  case when body='@Writer write the launch post' then 'run-writer' else 'run-viewer' end,'ag-a4760000000000000000000000000013',1,now()
 from public.channel_messages where channel_id='c4760000-0000-0000-0000-000000000001';

-- Who may hand over: a writer of the channel talking to its Agent, not only the main one.
select is(public.channel_can_hand_over('c4760000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a4760000-0000-0000-0000-000000000013'),true,'a Contributor of the channel talking to Writer, not the main Agent, may hand over');
select is(public.channel_can_hand_over('c4760000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a4760000-0000-0000-0000-000000000013'),false,'a Viewer may not');
select is(public.channel_can_hand_over('c4760000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a4760000-0000-0000-0000-000000000013'),false,'nor the Owner, who is not in the channel');

-- The tool's targets for Writer's Run: the Company's other two Agents with their jobs, though neither is in the channel.
select is((select string_agg(name||': '||job,' | ') from public.channel_handover_targets(current_setting('test.writer')::bigint)),
 'Ads: Meta ads and their numbers | Lead: Runs the team','Writer''s Run is told the Company''s other Agents, outside the channel, with their jobs, never itself nor another Company''s');
select is(public.channel_handover_agents(current_setting('test.writer')::bigint),array['Ads','Lead'],'and the previous app version''s list names the same');
select is((select count(*)::int from public.channel_handover_targets(current_setting('test.viewer')::bigint)),0,'a Viewer''s Run is told none');
set local role service_role;
select ok(public.pin_channel_run(current_setting('test.writer')::bigint,
 '{"show_draft":"{\"name\":\"show_draft\"}","hand_to_agent":"{\"name\":\"hand_to_agent\"}"}'::jsonb)->>'tools' like '%"hand_to_agent"%','Writer''s channel Run is offered the handover, pinned with it');
reset role;

-- The calls Writer's Run makes: any Agent of the Company is kept, in the channel or not; another Company's is not.
select is(public.channel_hand_to_agent(current_setting('test.writer')::bigint,'run-writer','call-1','ads','Pull last campaign''s numbers','The March launch.'),
 '{"state":"created","agent":"Ads"}'::jsonb,'Writer keeps a handover to Ads, an Agent outside the channel');
select is((select from_agent||'>'||to_agent||':'||state||':'||goal||':'||channel_message_id from public.agent_handovers where run_id='run-writer' and call_id='call-1'),
 'a4760000-0000-0000-0000-000000000013>a4760000-0000-0000-0000-000000000012:waiting:Pull last campaign''s numbers:'||current_setting('test.writer'),
 'from Writer to Ads, waiting, on the channel message');
select is(public.channel_hand_to_agent(current_setting('test.writer')::bigint,'run-writer','call-2','Critic','Review it',null),'{"state":"ignored"}'::jsonb,'an Agent of another Company is ignored');
select is(public.channel_hand_to_agent(current_setting('test.writer')::bigint,'run-writer','call-3','Writer','Write it',null),'{"state":"ignored"}'::jsonb,'and Writer never hands work to itself');
select is(public.channel_hand_to_agent(current_setting('test.viewer')::bigint,'run-viewer','call-1','Ads','Pull the numbers',null),'{"state":"refused"}'::jsonb,'a Viewer''s message hands nothing over, and its Run still closes');
select is((select count(*)::int from public.agent_handovers where channel_message_id in (current_setting('test.writer')::bigint,current_setting('test.viewer')::bigint)),1,'so one handover is kept');

-- The two legs: Ads works in its own session of this channel, then Writer's follow-up in Writer's.
create temporary table begun as select * from public.begin_handover((select id from public.agent_handovers where run_id='run-writer'));
select is((select profile||':'||session||':'||instructions from begun),
 'ag-a4760000000000000000000000000012:'||md5('c4760000-0000-0000-0000-000000000001:'||'a4760000-0000-0000-0000-000000000012')::uuid||':Run the Meta ads.',
 'Ads, outside the channel, starts on its own profile in its own session for that channel');
select ok((select input from begun) like 'Writer in the team is handing you a job in this channel.%'
 and (select input from begun) like '%What Writer knows about the job:%The March launch.%'
 and (select input from begun) like '%Reply with your result for Writer:%anything Writer must tell the team.%'
 and (select input from begun) not like '%Lead%','the job names Writer, the Agent that asked, never Lead');
select is(public.answer_handover((select id from public.agent_handovers where run_id='run-writer'),1,'run-ads'),true,'Ads''s Run is kept');
select is(public.close_handover_target((select id from public.agent_handovers where run_id='run-writer'),'run-ads','completed','March: 412 leads at EGP 21 each.'),true,'and ends with what Ads reported');
create temporary table returned as select * from public.begin_handover((select id from public.agent_handovers where run_id='run-writer'));
select is((select profile||':'||session from returned),
 'ag-a4760000000000000000000000000013:'||md5('c4760000-0000-0000-0000-000000000001:'||'a4760000-0000-0000-0000-000000000013')::uuid,
 'the answer comes back to Writer, in Writer''s own session of the channel');
select ok((select input from returned) like '%What Ads reported:%March: 412 leads at EGP 21 each.%Write your reply to the team%','with what Ads reported, to answer to the team');
select is(public.answer_handover((select id from public.agent_handovers where run_id='run-writer'),1,'run-writer-return'),true,'Writer''s follow-up Run is kept');
select is(public.close_handover_follow_up((select id from public.agent_handovers where run_id='run-writer'),'run-writer-return','completed','The post leads with 412 leads in March.'),true,'and its reply closes the handover');

-- Who reads it: every member of the channel, the Viewer included, with Ads's name, face and answer; nobody outside the
-- team channel, the Owner included, and nobody of another Company.
create temporary table seen(who int, reads int, drawn text, logged int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*)::int from public.channel_handovers('c4760000-0000-0000-0000-000000000001')),null,
 (select count(*)::int from public.company_log where source='agent_handovers' and actor_id='a4760000-0000-0000-0000-000000000013');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*)::int from public.channel_handovers('c4760000-0000-0000-0000-000000000001')),
 (select from_name||'>'||to_name||':'||to_connection||':'||summary||':'||reply from public.channel_handovers('c4760000-0000-0000-0000-000000000001')),
 (select count(*)::int from public.company_log where source='agent_handovers' and actor_id='a4760000-0000-0000-0000-000000000013');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*)::int from public.channel_handovers('c4760000-0000-0000-0000-000000000001')),null,
 (select count(*)::int from public.company_log where source='agent_handovers' and actor_id='a4760000-0000-0000-0000-000000000013');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*)::int from public.channel_handovers('c4760000-0000-0000-0000-000000000001')),
 (select from_name||'>'||to_name||':'||to_connection||':'||summary||':'||reply from public.channel_handovers('c4760000-0000-0000-0000-000000000001')),
 (select count(*)::int from public.company_log where source='agent_handovers' and actor_id='a4760000-0000-0000-0000-000000000013');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*)::int from public.channel_handovers('c4760000-0000-0000-0000-000000000001')),null,
 (select count(*)::int from public.company_log where source='agent_handovers' and actor_id='a4760000-0000-0000-0000-000000000013');
select set_config('request.jwt.claim.sub','e4769000-0000-0000-0000-000000000001',true);
insert into seen select 6,(select count(*)::int from public.channel_handovers('c4760000-0000-0000-0000-000000000001')),null,
 (select count(*)::int from public.company_log where source='agent_handovers' and actor_id='a4760000-0000-0000-0000-000000000013');
reset role;
select is((select reads from seen where who=2),1,'the Manager in the channel reads the handover');
select is((select drawn from seen where who=2),'Writer>Ads:f4760000-0000-0000-0000-000000000012:March: 412 leads at EGP 21 each.:The post leads with 412 leads in March.',
 'with Ads''s name, its face and its answer, and Writer''s reply');
select is((select reads from seen where who=3),1,'the Contributor reads it');
select is((select reads from seen where who=4),1,'the Viewer reads it too');
select is((select drawn from seen where who=4),(select drawn from seen where who=2),'the same as every other member, the outside Agent''s answer included');
select is((select reads from seen where who=1),0,'the Owner, outside the team channel, reads none of it');
select is((select reads from seen where who=5),0,'nor another Member of the Company outside it');
select is((select reads from seen where who=6),0,'nor anyone of another Company');
select is((select string_agg(who::text||':'||logged,',' order by who) from seen),'1:0,2:1,3:1,4:1,5:0,6:0','its log row is read by the channel''s members alone, though none of them sees Ads elsewhere');

-- When a kept job's Run would start, its sender must still be a writer of the channel, talking to an Agent of it.
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','c4760000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Writer write the April post',gen_random_uuid());
select set_config('test.april',(select id::text from public.channel_messages where body='@Writer write the April post'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at)
 values (current_setting('test.april')::bigint,1,'10000000-0000-0000-0000-000000000001','c4760000-0000-0000-0000-000000000001',
  'a4760000-0000-0000-0000-000000000013','Writer',gen_random_uuid(),'@Writer write the April post','run-april','ag-a4760000000000000000000000000013',1,now());
select is(public.channel_hand_to_agent(current_setting('test.april')::bigint,'run-april','call-1','Lead','Plan April',null),'{"state":"created","agent":"Lead"}'::jsonb,
 'Writer keeps a handover to Lead, the main Agent, outside the channel');
update public.members set role='viewer' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.begin_handover((select id from public.agent_handovers where run_id='run-april'))),0,
 'a sender who is now a Viewer starts no Run');
select is((select state||':'||target_outcome||':'||target_attempts from public.agent_handovers where run_id='run-april'),'returning:failed:0',
 'the leg ends as failed, so Writer still tells the channel');

-- Grants: the target list is the worker's alone.
select is(has_function_privilege('service_role','public.channel_handover_targets(bigint)','execute')
 and not has_function_privilege('authenticated','public.channel_handover_targets(bigint)','execute')
 and not has_function_privilege('anon','public.channel_handover_targets(bigint)','execute'),true,'the target list is the service role''s alone');
select * from finish();
rollback;
