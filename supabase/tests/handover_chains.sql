begin;
create extension if not exists pgtap with schema extensions;
select plan(63);
-- #477 (decision 0057): an asked Agent hands on. RS Learning has Lead (the main one, on the Company's profile), Writer,
-- Ads and Critic, each on its own profile; Aleem has an Ads of its own, which is never a target here. The Owner talks
-- to Writer in a Conversation; in the "launch" team channel the Contributor (3) and the Viewer (4) work with Writer
-- alone, and Member 1 (the Owner) is not in it.
insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values
 ('a4770000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',true,true),
 ('a4770000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',true,true),
 ('a4770000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000001',true,true),
 ('a4770000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000003',true,true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions) values
 ('a4770000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f4770000-0000-0000-0000-000000000011','Lead','Runs the team',true,'co-10000000000000000000000000000001','Lead the team.'),
 ('a4770000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f4770000-0000-0000-0000-000000000012','Ads','Meta ads and their numbers',false,'ag-a4770000000000000000000000000012','Run the Meta ads.'),
 ('a4770000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','f4770000-0000-0000-0000-000000000013','Writer','Posts and articles',false,'ag-a4770000000000000000000000000013','Write the posts.'),
 ('a4770000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000001','f4770000-0000-0000-0000-000000000014','Critic','Reviews claims',false,'ag-a4770000000000000000000000000014','Review.'),
 ('a4770000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000003','f4770000-0000-0000-0000-000000000022','Ads','Another team''s ads',false,'ag-a4770000000000000000000000000022','Run another team''s ads.');
insert into public.company_profiles(company_id,profile,skills_shared,tools_confirmed) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true,true);
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c4770000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a4770000-0000-0000-0000-000000000013','Writer');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c4770000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','Write the March post with last campaign''s numbers',gen_random_uuid(),'run-writer');

-- Writer hands the numbers to Ads, as any Agent does (#475).
select is(public.lead_hand_to_agent('c4770000-0000-0000-0000-000000000001','run-writer','call-1','Ads','Last campaign''s numbers','For the March post.'),
 '{"state":"created","agent":"Ads"}'::jsonb,'Writer hands the numbers to Ads');
select set_config('test.p',(select id::text from public.agent_handovers where run_id='run-writer'),true);
-- A handover whose asked Agent's Run started with no tool pinned (as the previous app version starts one).
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,state,target_run,target_attempts) values
 ('10000000-0000-0000-0000-000000000001','c4770000-0000-0000-0000-000000000001','run-writer','call-unpinned','a4770000-0000-0000-0000-000000000013','a4770000-0000-0000-0000-000000000011','Unpinned','target','run-unpinned',1);
select set_config('test.p2pin',(select id::text from public.agent_handovers where call_id='call-unpinned'),true);
create temporary table begun on commit drop as select * from public.begin_handover(current_setting('test.p')::bigint);
select is((select profile||':'||session from begun),'ag-a4770000000000000000000000000012:'||md5('c4770000-0000-0000-0000-000000000001:a4770000-0000-0000-0000-000000000012')::uuid,
 'Ads works on its own profile, in its own session for this chat');
select ok((select input from begun) not like '%memory%' and (select input from begun) not like '%schedule%' and (select input from begun) not like '%hand the job on%'
 and (select input from begun) like '%Writer in the team is handing you a job%'
 and (select input from begun) like '%put anything you need from the person in your reply, and Writer will ask them.%',
 'its job no longer forbids memory, routines or handing on, and puts any need from the person in its reply');

-- The tool it is offered names the Company's other Agents, the one that asked included, and is pinned once.
select is((select string_agg((t->>'name')||': '||(t->>'job'),' | ') from begun, jsonb_array_elements(begun.targets) t),
 'Critic: Reviews claims | Lead: Runs the team | Writer: Posts and articles','Ads may hand on to any other Agent of its Company, Writer who asked it included, never itself nor another Company''s');
select is(public.pin_handover_tools(current_setting('test.p')::bigint,'{"name":"hand_to_agent"}'),'{"name":"hand_to_agent"}','the tool text is pinned at its first start');
select is(public.pin_handover_tools(current_setting('test.p')::bigint,'{"name":"other"}'),'{"name":"hand_to_agent"}','and a retry gets the same text, whatever it is given');
select is(public.answer_handover(current_setting('test.p')::bigint,1,'run-ads','waiting'),true,'Ads''s Run started');

-- Ads's calls are kept under the handover its Run serves, once per run and call.
select is(public.handover_hand_to_agent(current_setting('test.p')::bigint,'run-ads','call-1',' Critic ','Check the figures',null),
 '{"state":"created","agent":"Critic"}'::jsonb,'Ads hands on to Critic');
select is(public.handover_hand_to_agent(current_setting('test.p')::bigint,'run-ads','call-1','Critic','Check again',null),
 '{"state":"created","agent":"Critic"}'::jsonb,'the same call again answers the same');
select is((select count(*)::int from public.agent_handovers where parent_id=current_setting('test.p')::bigint),1,'and keeps one child');
select is((select from_agent||'>'||to_agent||':'||conversation_id||':'||state||':'||goal from public.agent_handovers where parent_id=current_setting('test.p')::bigint),
 'a4770000-0000-0000-0000-000000000012>a4770000-0000-0000-0000-000000000014:c4770000-0000-0000-0000-000000000001:waiting:Check the figures',
 'from Ads to Critic, in the same Conversation, waiting, with its job');
select is(public.handover_hand_to_agent(current_setting('test.p')::bigint,'run-ads','call-2','Writer','Say which month the post is for','The figures are for February.'),
 '{"state":"created","agent":"Writer"}'::jsonb,'Ads may ask Writer back, an Agent already in the chain');
select is(public.handover_hand_to_agent(current_setting('test.p')::bigint,'run-ads','call-3','Ads','Do it yourself',null),'{"state":"ignored"}'::jsonb,'never itself');
select is(public.handover_hand_to_agent(current_setting('test.p')::bigint,'run-ads','call-4','Nobody','Plan',null),'{"state":"ignored"}'::jsonb,'a name no Agent of the Company has is ignored');
select is(public.handover_hand_to_agent(current_setting('test.p')::bigint,'run-other','call-5','Critic','Plan',null),'{"state":"refused"}'::jsonb,'a call from no Run of the handover is refused');
select is(public.handover_hand_to_agent(current_setting('test.p2pin')::bigint,'run-unpinned','call-1','Critic','Plan',null),'{"state":"refused"}'::jsonb,'and so is one from a Run that was offered no tool');
select is((select count(*)::int from public.agent_handovers where parent_id=current_setting('test.p')::bigint),2,'two children in all');
select is((select to_agent from public.agent_handovers where parent_id=current_setting('test.p')::bigint and call_id='call-2'),'a4770000-0000-0000-0000-000000000013'::uuid,
 'and the name picks the Company''s own Agent');
select set_config('test.q1',(select id::text from public.agent_handovers where parent_id=current_setting('test.p')::bigint and call_id='call-1'),true);
select set_config('test.q2',(select id::text from public.agent_handovers where parent_id=current_setting('test.p')::bigint and call_id='call-2'),true);

-- Ads's leg does not close while a child is open.
select is(public.close_handover_target(current_setting('test.p')::bigint,'run-ads','completed','I asked Critic and Writer.'),true,'Ads''s Run ended');
select is((select state||':'||coalesce(target_outcome,'-')||':'||coalesce(summary,'-') from public.agent_handovers where id=current_setting('test.p')::bigint),'handing:-:-',
 'its leg waits for its children, with no answer yet');
select is((select answer_started_at from public.agent_handovers where id=current_setting('test.p')::bigint),null,'and its answer''s day does not start while they work');
select is((select count(*)::int from public.begin_handover(current_setting('test.p')::bigint)),0,'and its answer does not start while they are open');
select is((select count(*)::int from public.handovers_due() d where d.id=current_setting('test.p')::bigint),0,'the worker does not list it while they work');

-- Critic answers Ads.
truncate begun; insert into begun select * from public.begin_handover(current_setting('test.q1')::bigint);
select is((select profile||':'||session from begun),'ag-a4770000000000000000000000000014:'||md5('c4770000-0000-0000-0000-000000000001:a4770000-0000-0000-0000-000000000014')::uuid,
 'Critic works on its own profile, in its own session for this chat');
select ok((select input from begun) like 'Ads in the team is handing you a job%','its job names Ads, the Agent that asked it');
select is(public.answer_handover(current_setting('test.q1')::bigint,1,'run-critic','waiting'),true,'Critic''s Run started');
select is(public.close_handover_target(current_setting('test.q1')::bigint,'run-critic','completed','The figures check out: 120 leads.'),true,'and ended');
select is((select count(*)::int from public.begin_handover(current_setting('test.q1')::bigint)),0,'a child has no follow-up Run');
select is((select state||':'||target_outcome||':'||summary from public.agent_handovers where id=current_setting('test.q1')::bigint),'done:completed:The figures check out: 120 leads.',
 'it is done with its answer');
select is((select count(*)::int from public.begin_handover(current_setting('test.p')::bigint)),0,'Ads still waits for Writer');

-- Writer, asked back, works in its own handover session, not the Conversation's, and does not finish.
truncate begun; insert into begun select * from public.begin_handover(current_setting('test.q2')::bigint);
select is((select profile||':'||session from begun),'ag-a4770000000000000000000000000013:'||md5('c4770000-0000-0000-0000-000000000001:a4770000-0000-0000-0000-000000000013')::uuid,
 'Writer asked back works in its own handover session');
select isnt((select session from begun),'c4770000-0000-0000-0000-000000000001'::uuid,'never the Conversation''s');
select is(public.answer_handover(current_setting('test.q2')::bigint,1,'run-writer-asked','waiting'),true,'Writer''s Run started');
select is(public.close_handover_target(current_setting('test.q2')::bigint,'run-writer-asked','failed',null),true,'and failed');
select is((select count(*)::int from public.begin_handover(current_setting('test.q2')::bigint)),0,'a failed child has no follow-up either');
select is((select state||':'||target_outcome from public.agent_handovers where id=current_setting('test.q2')::bigint),'done:failed','it is done as not finished');

-- Every child ended: Ads answers in its own handover session with what came back.
select is((select attempt from public.handovers_due() d where d.id=current_setting('test.p')::bigint and d.run is null),0,'once they ended, the worker lists its answer as a leg to start');
truncate begun; insert into begun select * from public.begin_handover(current_setting('test.p')::bigint);
select is((select state||':'||attempt||':'||profile||':'||session from begun),
 'handing:1:ag-a4770000000000000000000000000012:'||md5('c4770000-0000-0000-0000-000000000001:a4770000-0000-0000-0000-000000000012')::uuid,
 'Ads''s answer Run starts on its profile, in the same session as its job');
select is((select targets from begun),null,'and is given no Agents to hand to: it writes its answer');
select ok((select input from begun) like E'%What Critic answered:\nThe figures check out: 120 leads.%'
 and (select input from begun) like '%Writer did not finish: it failed before answering.%'
 and (select input from begun) like '%Write your answer for Writer now%','it is told what each child answered, and which did not finish');
-- A second job for Ads in this chat waits while Ads's answer runs in that session.
reset role;
select is(public.lead_hand_to_agent('c4770000-0000-0000-0000-000000000001','run-writer','call-2','Ads','Another job',null),'{"state":"created","agent":"Ads"}'::jsonb,'Writer hands Ads a second job');
select set_config('test.p2',(select id::text from public.agent_handovers where run_id='run-writer' and call_id='call-2'),true);
select is(public.answer_handover(current_setting('test.p')::bigint,1,'run-ads-answer','handing'),true,'Ads''s answer Run started');
select is((select state from public.agent_handovers where id=current_setting('test.p')::bigint),'answering','and is being answered');
select is((select count(*)::int from public.begin_handover(current_setting('test.p2')::bigint)),0,'the second job waits while the answer runs in Ads''s session');
select is((select run||':'||profile from public.handovers_due() d where d.id=current_setting('test.p')::bigint),'run-ads-answer:ag-a4770000000000000000000000000012',
 'the worker reads the answer Run on Ads''s profile');
select is(public.close_handover_answer(current_setting('test.p')::bigint,'run-other','completed','No'),false,'another Run''s end changes nothing');
select is(public.close_handover_answer(current_setting('test.p')::bigint,'run-ads-answer','completed','February: 120 leads, EGP 9,000. Writer did not say the month.'),true,'Ads answered');
select is((select state||':'||target_outcome||':'||summary from public.agent_handovers where id=current_setting('test.p')::bigint),
 'returning:completed:February: 120 leads, EGP 9,000. Writer did not say the month.','its answer is the leg''s answer, for Writer''s follow-up');
truncate begun; insert into begun select * from public.begin_handover(current_setting('test.p')::bigint);
select is((select state||':'||profile||':'||session from begun),'returning:ag-a4770000000000000000000000000013:c4770000-0000-0000-0000-000000000001',
 'Writer, the Agent the person talks to, replies last, in the Conversation''s session');
select ok((select input from begun) like E'%What Ads reported:\nFebruary: 120 leads, EGP 9,000.%','with what Ads answered, on its own line');

-- The Conversation's person reads every step of the chain, each with its parent.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(from_name||'>'||to_name||':'||coalesce(answer,'-')||':'||case when parent is null then 'top' else 'child' end,' | ' order by id)
  from public.conversation_handovers('c4770000-0000-0000-0000-000000000001')),
 'Writer>Ads:February: 120 leads, EGP 9,000. Writer did not say the month.:top | Writer>Lead:-:top | Ads>Critic:The figures check out: 120 leads.:child | Ads>Writer:-:child | Writer>Ads:-:top',
 'the Owner reads each step with its answer, and which ones were handed on');
select is((select count(*)::int from public.agent_handovers where parent_id is not null),2,'and the children from the table');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.conversation_handovers('c4770000-0000-0000-0000-000000000001')),0,'another Member reads none of them');
select throws_ok($$select public.handover_hand_to_agent(1,'r','c','Ads','x',null)$$,'42501',null,'nor may any person keep a handover through the worker''s function');
reset role;

-- In a channel: Writer hands to Ads, outside the channel, and Ads hands on to Critic, outside it too.
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('c4770000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','team','launch','20000000-0000-0000-0000-000000000002','e4770000-0000-0000-0000-000000000001');
insert into public.channel_people(channel_id,company_id,person_id,added_by) values
 ('c4770000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002'),
 ('c4770000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002');
insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values
 ('c4770000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','a4770000-0000-0000-0000-000000000013','20000000-0000-0000-0000-000000000002');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a4770000-0000-0000-0000-000000000013'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a4770000-0000-0000-0000-000000000013');
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','c4770000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000003','مراجع','@Writer write the launch post',gen_random_uuid());
select set_config('test.message',(select id::text from public.channel_messages where channel_id='c4770000-0000-0000-0000-000000000002'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at) values
 (current_setting('test.message')::bigint,1,'10000000-0000-0000-0000-000000000001','c4770000-0000-0000-0000-000000000002','a4770000-0000-0000-0000-000000000013','Writer',gen_random_uuid(),'write','run-channel-writer','ag-a4770000000000000000000000000013',1,now());
select is(public.channel_hand_to_agent(current_setting('test.message')::bigint,'run-channel-writer','call-1','Ads','The numbers',null),'{"state":"created","agent":"Ads"}'::jsonb,'Writer hands the numbers to Ads in the channel');
select set_config('test.cp',(select id::text from public.agent_handovers where channel_message_id=current_setting('test.message')::bigint and parent_id is null),true);
select is((select jsonb_array_length(targets) from public.begin_handover(current_setting('test.cp')::bigint)),3,'Ads, outside the channel, is offered the Company''s other three Agents');
select is(public.pin_handover_tools(current_setting('test.cp')::bigint,'{"name":"hand_to_agent"}'),'{"name":"hand_to_agent"}','its tool is pinned');
update public.agent_handovers set state='target', target_run='run-channel-ads' where id=current_setting('test.cp')::bigint;
select is(public.handover_hand_to_agent(current_setting('test.cp')::bigint,'run-channel-ads','call-1','Critic','Check the figures',null),'{"state":"created","agent":"Critic"}'::jsonb,
 'and hands on to Critic, outside the channel too, as the channel''s writer asked of Writer');
select is((select channel_message_id::text||':'||(parent_id=current_setting('test.cp')::bigint) from public.agent_handovers where run_id='run-channel-ads'),current_setting('test.message')||':true',
 'kept under its parent, on the same channel message');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select string_agg(from_name||'>'||to_name,' | ' order by id) from public.channel_handovers('c4770000-0000-0000-0000-000000000002')),'Writer>Ads | Ads>Critic',
 'a Viewer of the channel reads every step');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channel_handovers('c4770000-0000-0000-0000-000000000002')),0,'and the Owner, outside the team channel, reads none');
reset role;

-- A job command's Agent (#358) is offered nothing, as before.
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c4770000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','/ads the numbers',gen_random_uuid(),'command:x');
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,answers_person) values
 ('10000000-0000-0000-0000-000000000001','c4770000-0000-0000-0000-000000000001','command:x','x','a4770000-0000-0000-0000-000000000013','a4770000-0000-0000-0000-000000000014','the numbers',true);
select set_config('test.command',(select id::text from public.agent_handovers where run_id='command:x'),true);
select is((select targets from public.begin_handover(current_setting('test.command')::bigint)),null,'a job command''s Agent is given no Agents to hand to');
select is(public.pin_handover_tools(current_setting('test.command')::bigint,'{"name":"hand_to_agent"}'),'','and is pinned no tool, whatever it is given');

select * from finish();
rollback;
