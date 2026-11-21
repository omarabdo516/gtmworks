begin;
create extension if not exists pgtap with schema extensions;
select plan(58);
-- #478 (spec #474): Stop ends the whole Handover chain. RS Learning has Lead, Writer, Ads and Critic, each on its own
-- profile. The Owner (1) talks to Writer in a Conversation; in the "launch" team channel the Contributor (3) and the
-- Viewer (4) work with Writer, and the Manager (2) made the channel but is not in it.
insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values
 ('a4780000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',true,true),
 ('a4780000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',true,true),
 ('a4780000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000001',true,true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions) values
 ('a4780000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f4780000-0000-0000-0000-000000000011','Lead','Runs the team',true,'co-10000000000000000000000000000001','Lead the team.'),
 ('a4780000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f4780000-0000-0000-0000-000000000012','Ads','Meta ads and their numbers',false,'ag-a4780000000000000000000000000012','Run the Meta ads.'),
 ('a4780000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','f4780000-0000-0000-0000-000000000013','Writer','Posts and articles',false,'ag-a4780000000000000000000000000013','Write the posts.'),
 ('a4780000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000001','f4780000-0000-0000-0000-000000000014','Critic','Reviews claims',false,'ag-a4780000000000000000000000000014','Review.');
insert into public.company_profiles(company_id,profile,skills_shared,tools_confirmed) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true,true);
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c4780000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a4780000-0000-0000-0000-000000000013','Writer');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','Write the March post',gen_random_uuid(),'run-writer'),
 ('10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000001','agent',null,'Writer','I asked Ads.',null,'run-writer');

-- A two-level chain is open: Writer asked Ads, whose leg waits on Critic, and Critic is working.
select is(public.lead_hand_to_agent('c4780000-0000-0000-0000-000000000001','run-writer','call-1','Ads','Last campaign''s numbers',null),'{"state":"created","agent":"Ads"}'::jsonb,'Writer hands the numbers to Ads');
select set_config('test.p',(select id::text from public.agent_handovers where run_id='run-writer' and call_id='call-1'),true);
select is((select count(*)::int from public.begin_handover(current_setting('test.p')::bigint)),1,'Ads''s job begins');
select is(public.pin_handover_tools(current_setting('test.p')::bigint,'{"name":"hand_to_agent"}'),'{"name":"hand_to_agent"}','with its tool');
select is(public.answer_handover(current_setting('test.p')::bigint,1,'run-ads','waiting'),true,'Ads''s Run started');
select is(public.handover_hand_to_agent(current_setting('test.p')::bigint,'run-ads','call-1','Critic','Check the figures',null),'{"state":"created","agent":"Critic"}'::jsonb,'Ads hands on to Critic');
select set_config('test.q',(select id::text from public.agent_handovers where parent_id=current_setting('test.p')::bigint),true);
select is(public.close_handover_target(current_setting('test.p')::bigint,'run-ads','completed',null),true,'Ads''s leg waits for Critic');
select is((select count(*)::int from public.begin_handover(current_setting('test.q')::bigint)),1,'Critic''s job begins');
select is(public.answer_handover(current_setting('test.q')::bigint,1,'run-critic','waiting'),true,'Critic''s Run started');
-- A second top handover of the chat is still waiting for its start.
select is(public.lead_hand_to_agent('c4780000-0000-0000-0000-000000000001','run-writer','call-2','Lead','The brand''s tone',null),'{"state":"created","agent":"Lead"}'::jsonb,'Writer also asked Lead');

-- While the chain moves, the chat's Agent is working for its person, with no Run of the chat's own open.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select person from public.conversation_working_for('c4780000-0000-0000-0000-000000000001')),'20000000-0000-0000-0000-000000000001'::uuid,
 'the chat keeps its Stop square while its chain moves');
select throws_ok($$select * from public.conversation_stop_target('c4780000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')$$,
 'P0002','conversationNothingToStop','the chat has no Run of its own open');
-- The person writes again, and that Run of the chat's own completed with a call to hand on, not closed yet at the press.
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','Add a call to action',gen_random_uuid(),'run-writer-open');

-- Another Member who sees the Writer may not stop it (a Manager or Owner may, as they may stop the chat's own Run); the
-- Owner, the chat's person, presses Stop.
reset role;
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','a4780000-0000-0000-0000-000000000013');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select * from public.stop_conversation_handovers('c4780000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')$$,
 '42501','conversationStopNotAllowed','a Contributor who is not the chat''s person may not stop its chain');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
create temporary table stopped on commit drop as
 select * from public.stop_conversation_handovers('c4780000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
select is((select string_agg(coalesce(run,'-')||'@'||coalesce(profile,'-'),' | ' order by run nulls last) from stopped),
 'run-critic@ag-a4780000000000000000000000000014 | -@- | -@-',
 'Stop names Critic''s Run on Critic''s profile, and the two legs with no Run going');
reset role;
select is((select string_agg(state||':'||coalesce(target_outcome,'-')||':'||coalesce(follow_up_outcome,'-'),' | ' order by id) from public.agent_handovers
  where conversation_id='c4780000-0000-0000-0000-000000000001'),'done:stopped:- | done:stopped:- | done:stopped:-','every handover of the chat ended as stopped');
select is((select count(*)::int from public.handovers_due('c4780000-0000-0000-0000-000000000001')),0,'the worker has nothing more to move');
select is((select count(*)::int from public.begin_handover(current_setting('test.p')::bigint)),0,'Ads''s answer never starts');
select is(public.answer_handover(current_setting('test.q')::bigint,1,'run-critic-late','waiting'),false,'a Run id that comes back late is kept nowhere');
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal) values
 ('10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000001','run-writer','call-open','a4780000-0000-0000-0000-000000000013','a4780000-0000-0000-0000-000000000012','Later');
select set_config('test.p2pending',(select id::text from public.agent_handovers where call_id='call-open'),true);
select is(public.stop_late_handover_run(current_setting('test.q')::bigint,'run-critic-late'),true,'the worker hears the handover was stopped, and keeps that Run to stop');
select is(public.stop_late_handover_run(current_setting('test.p2pending')::bigint,'run-x'),false,'a leg that was not stopped keeps no Run to stop');
select is((select string_agg(id::text||':'||run||'@'||coalesce(profile,'-'),' | ' order by id) from public.handover_runs_stopping()),
 current_setting('test.q')||':run-critic@ag-a4780000000000000000000000000014',
 'the worker keeps stopping Critic''s Run, the one Stop ended its Handover on, until its Engine says it ended');
-- The profile the Run ran on is kept with it, and is the one the worker asks, wherever its Agent moves since.
select is((select stopping_profile from public.agent_handovers where id=current_setting('test.q')::bigint),'ag-a4780000000000000000000000000014',
 'Critic''s profile is kept with its Run');
update public.agent_handovers set stopping_profile='ag-a4780000000000000000000000000099' where id=current_setting('test.q')::bigint;
select is((select profile from public.handover_runs_stopping() where id=current_setting('test.q')::bigint),'ag-a4780000000000000000000000000099',
 'the worker asks the kept profile, not the Agent''s present one');
update public.agent_handovers set stopping_profile='ag-a4780000000000000000000000000014' where id=current_setting('test.q')::bigint;
select is(public.handover_run_stopped(current_setting('test.q')::bigint,'run-critic'),true,'its Engine says it ended');
select is((select count(*)::int from public.handover_runs_stopping()),0,'and nothing is left to stop');
delete from public.agent_handovers where call_id='call-open';
select is(public.lead_hand_to_agent('c4780000-0000-0000-0000-000000000001','run-writer-open','call-1','Critic','Check the call to action',null),'{"state":"refused"}'::jsonb,
 'the chat''s own Run that was open at Stop hands nothing on when it closes');
insert into public.conversation_messages(company_id,conversation_id,author,author_name,body,run_id) values
 ('10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000001','agent','Writer','I asked Critic.','run-writer-open');
select is(public.close_handover_target(current_setting('test.q')::bigint,'run-critic','stopped',null),false,'Critic''s Run ending later changes nothing');
select is(public.handover_hand_to_agent(current_setting('test.q')::bigint,'run-critic','call-1','Lead','x',null),'{"state":"refused"}'::jsonb,'and its calls hand nothing on');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(from_name||'>'||to_name||':'||stopped,' | ' order by id) from public.conversation_handovers('c4780000-0000-0000-0000-000000000001')),
 'Writer>Ads:true | Ads>Critic:true | Writer>Lead:true','the chat reads each step as stopped');
select is((select count(*)::int from public.conversation_working_for('c4780000-0000-0000-0000-000000000001')),0,'and its Agent works for nobody now');
select is((select count(*)::int from public.stop_conversation_handovers('c4780000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')),0,'a second Stop has nothing to end');
reset role;

-- A follow-up that is running is the leg stopped once the asked Agent answered.
select is(public.lead_hand_to_agent('c4780000-0000-0000-0000-000000000001','run-writer','call-3','Ads','Again',null),'{"state":"created","agent":"Ads"}'::jsonb,'Writer asks Ads again');
select set_config('test.r',(select id::text from public.agent_handovers where call_id='call-3'),true);
update public.agent_handovers set state='follow_up', target_run='run-ads-2', target_outcome='completed', summary='120 leads.', target_closed_at=now(), follow_up_run='run-writer-2'
 where id=current_setting('test.r')::bigint;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select run||'@'||profile from public.stop_conversation_handovers('c4780000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')),
 'run-writer-2@ag-a4780000000000000000000000000013','Stop names the Writer''s follow-up Run');
reset role;
select is((select state||':'||target_outcome||':'||follow_up_outcome||':'||summary from public.agent_handovers where id=current_setting('test.r')::bigint),'done:completed:stopped:120 leads.',
 'Ads''s answer stays, and the follow-up ended as stopped');
select is((select run||'@'||profile from public.handover_runs_stopping() where id=current_setting('test.r')::bigint),'run-writer-2@ag-a4780000000000000000000000000013',
 'the follow-up''s Run is kept to stop on the Writer''s profile');

-- A start whose answer was lost when Stop is pressed: only a retry with the same key can learn its Run.
select is(public.lead_hand_to_agent('c4780000-0000-0000-0000-000000000001','run-writer','call-4','Critic','Once more',null),'{"state":"created","agent":"Critic"}'::jsonb,'Writer asks Critic');
select set_config('test.u',(select id::text from public.agent_handovers where call_id='call-4'),true);
update public.agent_handovers set target_attempts=1, attempted_at=now() where id=current_setting('test.u')::bigint;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select coalesce(run,'-') from public.stop_conversation_handovers('c4780000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')),'-',
 'Stop reaches it with no Run to stop yet');
reset role;
select is((select state||':'||(stop_requested_at is not null) from public.agent_handovers where id=current_setting('test.u')::bigint),'waiting:true',
 'the leg is left to the worker, marked to stop');
select is(public.answer_handover(current_setting('test.u')::bigint,1,'run-critic-found','waiting'),false,'its Run id, come back on a retry, is not kept as its Run');
select is((select state||':'||target_outcome||':'||stopping_run from public.agent_handovers where id=current_setting('test.u')::bigint),'done:stopped:run-critic-found',
 'the leg ended as stopped, its Run kept to stop in the same transaction');
select is(public.stop_late_handover_run(current_setting('test.u')::bigint,'run-critic-found'),true,'and its Run is kept to stop');
-- One whose start is then refused ends as stopped too, and moves to no follow-up.
select is(public.lead_hand_to_agent('c4780000-0000-0000-0000-000000000001','run-writer','call-5','Critic','And again',null),'{"state":"created","agent":"Critic"}'::jsonb,'Writer asks Critic again');
select set_config('test.v',(select id::text from public.agent_handovers where call_id='call-5'),true);
update public.agent_handovers set target_attempts=1, attempted_at=now(), stop_requested_at=now() where id=current_setting('test.v')::bigint;
select is(public.answer_handover(current_setting('test.v')::bigint,1,null,'waiting'),false,'its start is refused');
select is((select state||':'||target_outcome||':'||coalesce(follow_up_outcome,'-') from public.agent_handovers where id=current_setting('test.v')::bigint),'done:stopped:-',
 'it ended as stopped, with no follow-up to start');
-- One whose start is given up by another path (its window ran out) ends as stopped too, never moving on.
select is(public.lead_hand_to_agent('c4780000-0000-0000-0000-000000000001','run-writer','call-6','Critic','Once again',null),'{"state":"created","agent":"Critic"}'::jsonb,'Writer asks Critic once more');
select set_config('test.w',(select id::text from public.agent_handovers where call_id='call-6'),true);
update public.agent_handovers set target_attempts=1, attempted_at=now(), stop_requested_at=now() where id=current_setting('test.w')::bigint;
update public.agent_handovers set state='returning', target_outcome='failed', target_closed_at=now(), return_started_at=now() where id=current_setting('test.w')::bigint;
select is((select state||':'||target_outcome||':'||coalesce(follow_up_outcome,'-')||':'||(closed_at is not null) from public.agent_handovers where id=current_setting('test.w')::bigint),
 'done:stopped:-:true','a marked leg given up ends as stopped, with no follow-up to start');

-- In a channel: two messages of the Contributor, each with a handover open; Stop on the first ends only its own.
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('c4780000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','team','launch','20000000-0000-0000-0000-000000000002','e4780000-0000-0000-0000-000000000001');
insert into public.channel_people(channel_id,company_id,person_id,added_by) values
 ('c4780000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002'),
 ('c4780000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002');
insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values
 ('c4780000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','a4780000-0000-0000-0000-000000000013','20000000-0000-0000-0000-000000000002'),
 ('c4780000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','a4780000-0000-0000-0000-000000000014','20000000-0000-0000-0000-000000000002');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a4780000-0000-0000-0000-000000000013'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a4780000-0000-0000-0000-000000000014'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a4780000-0000-0000-0000-000000000013');
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000003','مراجع','@Writer @Critic the launch post',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000003','مراجع','@Writer the tone',gen_random_uuid());
select set_config('test.m1',(select min(id)::text from public.channel_messages where channel_id='c4780000-0000-0000-0000-000000000002'),true);
select set_config('test.m2',(select max(id)::text from public.channel_messages where channel_id='c4780000-0000-0000-0000-000000000002'),true);
-- Message 1: Writer's Run is still going, and Critic, called after it, has not started. Message 2's Writer Run ended.
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at) values
 (current_setting('test.m1')::bigint,1,'10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000002','a4780000-0000-0000-0000-000000000013','Writer',gen_random_uuid(),'write','run-m1-writer','ag-a4780000000000000000000000000013',1,now()),
 (current_setting('test.m2')::bigint,1,'10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000002','a4780000-0000-0000-0000-000000000013','Writer',gen_random_uuid(),'tone','run-m2-writer','ag-a4780000000000000000000000000013',1,now());
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,profile) values
 (current_setting('test.m1')::bigint,2,'10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000002','a4780000-0000-0000-0000-000000000014','Critic',gen_random_uuid(),'review','ag-a4780000000000000000000000000014');
select is(public.channel_hand_to_agent(current_setting('test.m1')::bigint,'run-m1-writer','call-1','Ads','The numbers',null),'{"state":"created","agent":"Ads"}'::jsonb,'message 1''s Writer hands to Ads');
select is(public.channel_hand_to_agent(current_setting('test.m2')::bigint,'run-m2-writer','call-1','Lead','The tone',null),'{"state":"created","agent":"Lead"}'::jsonb,'message 2''s Writer hands to Lead');
update public.channel_runs set outcome='completed', closed_at=now() where message_id=current_setting('test.m2')::bigint;
update public.agent_handovers set state='target', target_run='run-m1-ads', target_attempts=1 where channel_message_id=current_setting('test.m1')::bigint;
update public.agent_handovers set state='target', target_run='run-m2-lead', target_attempts=1 where channel_message_id=current_setting('test.m2')::bigint;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok(format('select * from public.stop_channel_message(%L,%L,%s)','10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000002',current_setting('test.m1')),
 '42501','channelNotAllowed','a Viewer of the channel may not stop');
select is((select count(*)::int from public.channel_stoppable('c4780000-0000-0000-0000-000000000002')),0,'and is offered nothing to stop');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select message::text||':'||agent_name from public.channel_stoppable('c4780000-0000-0000-0000-000000000002')),current_setting('test.m2')||':Writer',
 'the Contributor''s Stop ends their newest message with work open, with the Agent that made its handover');
select is((select string_agg(coalesce(run,'-')||'@'||coalesce(profile,'-'),' | ' order by run nulls last)
  from public.stop_channel_message('10000000-0000-0000-0000-000000000001','c4780000-0000-0000-0000-000000000002',current_setting('test.m1')::bigint)),
 'run-m1-ads@ag-a4780000000000000000000000000012 | run-m1-writer@ag-a4780000000000000000000000000013 | -@-',
 'Stop on message 1 names its Writer''s Run and Ads''s, and ends Critic''s start before it began');
reset role;
select is(public.channel_hand_to_agent(current_setting('test.m1')::bigint,'run-m1-writer','call-2','Critic','Check the post',null),'{"state":"refused"}'::jsonb,
 'message 1''s Writer Run, open at Stop, hands nothing on when it closes');
select is((select string_agg(ordinal||':'||coalesce(outcome,'open'),' | ' order by ordinal) from public.channel_runs where message_id=current_setting('test.m1')::bigint),
 '1:open | 2:stopped','Critic, not started, never starts; Writer''s Run ends as stopped when next closed');
select is((select string_agg(run||'@'||profile,' | ') from public.stopped_runs_open() where run like 'run-m1-%'),'run-m1-writer@ag-a4780000000000000000000000000013',
 'the worker keeps stopping message 1''s own Writer Run while it is open');
update public.channel_runs set outcome='stopped', closed_at=now() where message_id=current_setting('test.m1')::bigint and run_id='run-m1-writer';
select is((select count(*)::int from public.stopped_runs_open() where run like 'run-m1-%'),0,'and not once it closed');
select is((select state||':'||target_outcome from public.agent_handovers where channel_message_id=current_setting('test.m1')::bigint),'done:stopped','message 1''s handover ended as stopped');
select is((select state||':'||coalesce(target_outcome,'-') from public.agent_handovers where channel_message_id=current_setting('test.m2')::bigint),'target:-','and message 2''s keeps going');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select string_agg(from_name||'>'||to_name||':'||stopped,' | ' order by id) from public.channel_handovers('c4780000-0000-0000-0000-000000000002')),
 'Writer>Ads:true | Writer>Lead:false','every member of the channel reads which step was stopped');
reset role;

select * from finish();
rollback;
