begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
-- #358. RS Learning: Lead on the Company's own profile, Reach (made from the meta role) and Faye on profiles of their
-- own. The Owner and the Manager see every Agent; the Contributor (…03) sees only the ones given to them; the Viewer
-- (…04) writes nothing.
insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy,skills_shared) values
 ('a3580000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy(),true),
 ('a3580000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy(),true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions,template) values
 ('a3580000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f3580000-0000-0000-0000-000000000011','Lead','General',true,'co-10000000000000000000000000000001','Lead the team.',null),
 ('a3580000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f3580000-0000-0000-0000-000000000012','Reach','Meta ads',false,'ag-a3580000000000000000000000000012','Run the Meta ads.','meta'),
 ('a3580000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','f3580000-0000-0000-0000-000000000013','Faye','Marketing',false,'ag-a3580000000000000000000000000013','Write short.',null);
insert into public.company_profiles(company_id,profile,tools_level,tools_policy,skills_shared) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy(),true);
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a3580000-0000-0000-0000-000000000012');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c3580000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a3580000-0000-0000-0000-000000000011','Lead'),
 ('c3580000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a3580000-0000-0000-0000-000000000013','Faye'),
 ('c3580000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a3580000-0000-0000-0000-000000000011','Lead'),
 ('c3580000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a3580000-0000-0000-0000-000000000011','Lead');

-- A command sent in the main Agent's Conversation keeps the person's message and its handover row in one call.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.command_handover('c3580000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 'a3580000-0000-0000-0000-000000000011','d3580000-0000-0000-0000-000000000001','/campaign Launch the December ads','Reach','Launch the December ads'),true,
 'the Owner''s command in the Lead''s chat is handed to the Agent of its role');
select is((select author||':'||author_name||':'||body||':'||run_id from public.conversation_messages where conversation_id='c3580000-0000-0000-0000-000000000001'),
 'person:عمر:/campaign Launch the December ads:command:'||'d3580000-0000-0000-0000-000000000001','with the person''s message kept, on the command''s own Run');
select is((select a.name||'>'||b.name||':'||h.goal||':'||h.answers_person||':'||h.state from public.agent_handovers h
 join public.hermes_agents a on a.id=h.from_agent join public.hermes_agents b on b.id=h.to_agent),
 'Lead>Reach:Launch the December ads:true:waiting','and a handover from the Lead to that Agent, the target answering the person');
select is(public.command_handover('c3580000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 'a3580000-0000-0000-0000-000000000011','d3580000-0000-0000-0000-000000000001','/campaign Launch the December ads','Reach','Launch the December ads'),true,
 'the same send key again answers true');
select is((select count(*)::int from public.conversation_messages where conversation_id='c3580000-0000-0000-0000-000000000001')
  +(select count(*)::int from public.agent_handovers where conversation_id='c3580000-0000-0000-0000-000000000001'),2,
 'and keeps one message and one handover');
select is(public.command_handover('c3580000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 'a3580000-0000-0000-0000-000000000011','d3580000-0000-0000-0000-000000000002','/campaign '||repeat('x',600),'Reach',repeat('x',600)),true,
 'a job longer than a handover holds is cut, never lost');
select is((select length(goal) from public.agent_handovers where run_id='command:d3580000-0000-0000-0000-000000000002'),500,'to the length its row takes');
select is(public.command_handover('c3580000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 'a3580000-0000-0000-0000-000000000011','d3580000-0000-0000-0000-000000000003','/campaign Launch','Lead','Launch'),false,
 'the Lead never hands a command to itself, and the message is then sent as typed');
reset role;

-- A Contributor hands a command to only the Agents they see; a Viewer writes nothing; and another Agent's chat hands none.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.command_handover('c3580000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
 'a3580000-0000-0000-0000-000000000011','d3580000-0000-0000-0000-000000000004','/campaign Launch','Faye','Launch'),false,
 'an Agent the person is not given is no target');
reset role;
delete from public.member_agent_access where company_id='10000000-0000-0000-0000-000000000001'
 and person_id='20000000-0000-0000-0000-000000000003' and agent_id='a3580000-0000-0000-0000-000000000012';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.command_handover('c3580000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',
 'a3580000-0000-0000-0000-000000000011',gen_random_uuid(),'/campaign Launch','Reach','Launch')$$,'42501',null,
 'a Viewer''s command hands nothing over');
reset role;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.command_handover('c3580000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
 'a3580000-0000-0000-0000-000000000013',gen_random_uuid(),'/campaign Launch','Reach','Launch'),false,
 'a command in another Agent''s Conversation is sent as plain text');
select set_config('request.jwt.claim.sub','',true);
reset role;

-- The chat's Agent never works on the command's Run, and the worker never reads it as a Run of its own.
select is((select count(*)::int from public.conversation_open_run('c3580000-0000-0000-0000-000000000001')),0,
 'the Lead is not working on the command''s Run');
select is((select count(*)::int from public.open_conversation_runs('c3580000-0000-0000-0000-000000000001',null,0)),0,
 'and the worker lists no Run to close for it');
select is((select count(*)::int from public.conversation_messages where conversation_id='c3580000-0000-0000-0000-000000000003'),0,
 'a handover refused keeps no message');

-- The person reads their own handover, with the flag the record needs; another person reads none of it.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select answers_person from public.agent_handovers where run_id='command:d3580000-0000-0000-0000-000000000001'),true,
 'the person reads the handover''s own flag');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.agent_handovers),0,'and nobody else reads their handovers');
select set_config('request.jwt.claim.sub','',true);
reset role;

-- The worker starts the target's Run in a session of its own for this chat, and its input asks for the person's reply.
create temporary table begun as select * from public.begin_handover((select id from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000001'));
select is((select state||':'||attempt||':'||profile||':'||session||':'||instructions from begun),
 'waiting:1:ag-a3580000000000000000000000000012:'||md5('c3580000-0000-0000-0000-000000000001:'||'a3580000-0000-0000-0000-000000000012')::uuid||':Run the Meta ads.',
 'the target''s own profile, a session of its own for this chat, and its own instructions');
select is((select input from begun) like '%Launch the December ads%' and (select input from begun) like '%write the reply they read%'
 and (select input from begun) not like '%Reply with your result for Lead%',true,
 'with the job, and the person''s answer asked for rather than a report for the Lead');
select is((select count(*)::int from public.begin_handover((select id from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000001'))),0,
 'nor does it start again within thirty seconds');
select is(public.answer_handover((select id from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000001'),1,'run-target'),true,
 'its Run is kept once');

-- Its end is the chat's answer: the target's words are its message in the chat, kept from that Agent.
select is(public.close_handover_target((select id from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000001'),'run-target','completed','Three ad sets, 30 days, EGP 9,000.'),true,
 'the target''s Run ends with what it wrote');
select is((select author||':'||author_name||':'||agent_id||':'||body||':'||run_id from public.conversation_messages where run_id='run-target'),
 'agent:Reach:a3580000-0000-0000-0000-000000000012:Three ad sets, 30 days, EGP 9,000.:run-target','kept as that Agent''s message in the chat');
select is((select state||':'||target_outcome||':'||(closed_at is not null)::text||':'||(return_started_at is null)::text from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000001'),
 'done:completed:true:true','and the handover done at once, with no Lead follow-up to wait for');
select is((select outcome from public.conversation_run_ends where run_id='command:'||'d3580000-0000-0000-0000-000000000001'),'completed',
 'the person''s own Run ended with it, so the chat waits no more');
select is((select count(*)::int from public.handovers_due(null,0,null) where id=(select id from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000001')),0,
 'and the worker no longer sees it');
select is(public.close_handover_target((select id from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000001'),'run-target','completed','Again'),false,
 'closing it again keeps nothing');

-- A target that fails still ends the person's Run, so the chat says the reply did not come, and keeps no message.
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,answers_person,state,target_run)
 values('10000000-0000-0000-0000-000000000001','c3580000-0000-0000-0000-000000000001','command:'||'d3580000-0000-0000-0000-000000000006',
 'd3580000-0000-0000-0000-000000000006','a3580000-0000-0000-0000-000000000011','a3580000-0000-0000-0000-000000000012','Launch',true,'target','run-failed');
select is(public.close_handover_target((select id from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000006'),'run-failed','failed',null),true,
 'a target that failed ends its handover');
select is((select state||':'||target_outcome from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000006'),'done:failed',
 'as done, with what it ended as');
select is((select count(*)::int from public.conversation_messages where run_id='run-failed'),0,'and no reply is kept for it');
select is((select outcome from public.conversation_run_ends where run_id='command:'||'d3580000-0000-0000-0000-000000000006'),'failed',
 'while the person''s Run ends as failed, the line the chat draws');

-- A target hidden since the job was kept starts no Run, and the handover ends so the person is told.
delete from public.member_agent_access where company_id='10000000-0000-0000-0000-000000000001'
 and person_id='20000000-0000-0000-0000-000000000003' and agent_id='a3580000-0000-0000-0000-000000000012';
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,answers_person)
 values('10000000-0000-0000-0000-000000000001','c3580000-0000-0000-0000-000000000003','command:'||'d3580000-0000-0000-0000-000000000005',
 'd3580000-0000-0000-0000-000000000005','a3580000-0000-0000-0000-000000000011','a3580000-0000-0000-0000-000000000012','Launch',true);
select is((select count(*)::int from public.begin_handover((select id from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000005'))),0,
 'a target hidden since the command was sent starts no Run');
select is((select state||':'||target_outcome||':'||(closed_at is not null)::text from public.agent_handovers where call_id='d3580000-0000-0000-0000-000000000005'),
 'failed:failed:true','as a handover that could not start');
select is((select outcome from public.conversation_run_ends where run_id='command:'||'d3580000-0000-0000-0000-000000000005'),'failed',
 'with the person''s Run ended as failed');
select * from finish();
rollback;
