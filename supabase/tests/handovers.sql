begin;
create extension if not exists pgtap with schema extensions;
select plan(77);
-- #317, #475. RS Learning: Lead on the Company's own profile, Ads and Writer on profiles of their own. The Contributor
-- (…03) is shown Ads and not Writer; the Viewer (…04) writes nothing. Aleem has its own Lead and Ads. Any Agent of a
-- Company hands work to any other Agent of it, seen by the person or not (decision 0057).
insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values
 ('a3170000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',true,true),
 ('a3170000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',true,true),
 ('a3170000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000003',true,true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions) values
 ('a3170000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f3170000-0000-0000-0000-000000000011','Lead','General',true,'co-10000000000000000000000000000001','Lead the team.'),
 ('a3170000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f3170000-0000-0000-0000-000000000012','Ads','Ads',false,'ag-a3170000000000000000000000000012','Run the Meta ads.'),
 ('a3170000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','f3170000-0000-0000-0000-000000000013','Writer','SEO',false,'ag-a3170000000000000000000000000013','Write for search.'),
 ('a3170000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000003','f3170000-0000-0000-0000-000000000021','Lead','General',true,'co-10000000000000000000000000000003','Lead another team.'),
 ('a3170000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000003','f3170000-0000-0000-0000-000000000022','Ads','Ads',false,'ag-a3170000000000000000000000000022','Run another team''s ads.');
insert into public.company_profiles(company_id,profile,skills_shared,tools_confirmed) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true,true),
 ('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',true,true);
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a3170000-0000-0000-0000-000000000012');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c3170000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000011','Lead'),
 ('c3170000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a3170000-0000-0000-0000-000000000011','Lead'),
 ('c3170000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a3170000-0000-0000-0000-000000000011','Lead'),
 ('c3170000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000021','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','Plan the March intake',gen_random_uuid(),'run-owner'),
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000003','Contributor','Plan the March intake',gen_random_uuid(),'run-contributor'),
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000004','person','20000000-0000-0000-0000-000000000004','Viewer','Plan the March intake',gen_random_uuid(),'run-viewer'),
 ('10000000-0000-0000-0000-000000000003','c3170000-0000-0000-0000-000000000021','person','20000000-0000-0000-0000-000000000001','Omar','Plan the March intake',gen_random_uuid(),'run-aleem');

-- Every Agent is offered the tool, and only to a writer of the Company (#475: not only the Lead).
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001')),true,'the Lead offers hand_to_agent to the Owner');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001')),true,'any other Agent hands work on too, to the Owner');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000002')),true,'to a Manager');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000003')),true,'and to a Contributor');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000004')),false,'but never to a Viewer');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000022','20000000-0000-0000-0000-000000000001')),false,'nor for an Agent of another Company');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000003')),true,'a Contributor talking to the Lead is offered it');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000004')),false,'a Viewer writes nothing, so it is offered nothing');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000003','a3170000-0000-0000-0000-000000000021','20000000-0000-0000-0000-000000000003')),false,'and a non-member is offered nothing');
select is('create_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001')),false,'another Agent is not offered the Lead''s own create_agent');

-- The handover Lead's call keeps: one per call, to an Agent of the same Company, seen by the person or not.
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-owner','call-1',' Ads ','Plan the Meta ads for the March intake','EGP 9,000 for 30 days.'),
 '{"state":"created","agent":"Ads"}'::jsonb,'the Lead keeps a handover to an Agent of its Company');
select is((select from_agent||'>'||to_agent||':'||state||':'||goal||':'||context from public.agent_handovers where run_id='run-owner'),
 'a3170000-0000-0000-0000-000000000011>a3170000-0000-0000-0000-000000000012:waiting:Plan the Meta ads for the March intake:EGP 9,000 for 30 days.','from Lead to Ads, waiting, with the job and its context');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-owner','call-1','Ads','Plan it again',null),'{"state":"created","agent":"Ads"}'::jsonb,'the same call again answers the same');
select is((select count(*)::int from public.agent_handovers),1,'and keeps one handover');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-owner','call-2','Nobody','Plan',''),'{"state":"ignored"}'::jsonb,'a name no Agent of the Company has is ignored');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-owner','call-3','Lead','Plan',''),'{"state":"ignored"}'::jsonb,'and the Lead never hands work to itself');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000003','run-contributor','call-1','Writer','Plan',''),'{"state":"created","agent":"Writer"}'::jsonb,'an Agent the sender does not see is a target all the same (#475)');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000003','run-contributor','call-2','Ads','Plan the March intake',null),'{"state":"created","agent":"Ads"}'::jsonb,'and so is one they see');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000021','run-aleem','call-1','Writer','Plan',''),'{"state":"ignored"}'::jsonb,'an Agent of another Company is never a target');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000021','run-aleem','call-2','Ads','Plan the March intake',null),'{"state":"created","agent":"Ads"}'::jsonb,'the name picks the sender''s own Company''s Agent');
select is((select company_id from public.agent_handovers where run_id='run-aleem'),'10000000-0000-0000-0000-000000000003'::uuid,'and the row belongs to that Company');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000004','run-viewer','call-1','Ads','Plan',''),'{"state":"refused"}'::jsonb,'a Viewer''s Conversation hands nothing over, and its Run still closes');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-nobody','call-1','Ads','Plan',''),'{"state":"refused"}'::jsonb,'a run of no message of the Conversation is refused');

-- The person reads every handover of their own Conversation, an Agent hidden from them included (#475).
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal) values
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000003','run-contributor','call-9','a3170000-0000-0000-0000-000000000011','a3170000-0000-0000-0000-000000000013','A hidden one');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(to_agent::text,',' order by to_agent) from public.agent_handovers),'a3170000-0000-0000-0000-000000000012,a3170000-0000-0000-0000-000000000022','the Owner reads the handovers of their own Conversations in both Companies');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select string_agg(to_agent::text,',' order by to_agent) from public.agent_handovers),'a3170000-0000-0000-0000-000000000012,a3170000-0000-0000-0000-000000000013,a3170000-0000-0000-0000-000000000013','a Contributor reads theirs, with the Agent hidden from them');
select is((select string_agg(from_name||'>'||to_name||':'||to_connection||':'||goal,',' order by id) from public.conversation_handovers('c3170000-0000-0000-0000-000000000003')),
 'Lead>Writer:f3170000-0000-0000-0000-000000000013:Plan,Lead>Ads:f3170000-0000-0000-0000-000000000012:Plan the March intake,Lead>Writer:f3170000-0000-0000-0000-000000000013:A hidden one',
 'and the Conversation draws both Agents'' names and faces, the hidden one''s too, which hermes_agents keeps from them');
select is((select count(*)::int from public.hermes_agents where id='a3170000-0000-0000-0000-000000000013'),0,'while the Agent itself stays hidden from them');
select is((select count(*)::int from public.conversation_handovers('c3170000-0000-0000-0000-000000000001')),0,'nobody reads another person''s Conversation''s handovers through it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.agent_handovers),0,'a Viewer reads another person''s handovers from none');
select is((select count(*)::int from public.conversation_handovers('c3170000-0000-0000-0000-000000000003')),0,'nor through the Conversation''s function');
select throws_ok($$select * from public.handovers_due()$$,'42501',null,'nor can any person list the worker''s due handovers');
reset role;

-- The worker moves the two Runs: the target's own profile first, then the Lead's follow-up in the same session.
create temporary table begun as select * from public.begin_handover((select id from public.agent_handovers where run_id='run-owner'));
select is((select count(*)::int from public.handovers_due(null,0) where id=(select id from public.agent_handovers where run_id='run-owner')),0,'the handover that began is no longer due');
select is((select state||':'||attempt from public.handovers_due(null,0) where conversation='c3170000-0000-0000-0000-000000000003' limit 1),'waiting:0','another kept handover waits for the worker');
select is((select profile||':'||session||':'||instructions from begun),'ag-a3170000000000000000000000000012:'||md5('c3170000-0000-0000-0000-000000000001:'||(select to_agent from public.agent_handovers where run_id='run-owner'))::uuid||':Run the Meta ads.','the target''s own profile, a session of its own for this chat, and its own instructions');
select is((select attempt from begun),1,'the first attempt of the target''s Run');
select is((select input from begun) like '%Plan the Meta ads for the March intake%' and (select input from begun) like '%EGP 9,000 for 30 days.%'
 and (select input from begun) like '%Do not save anything to memory, do not schedule anything, and do not hand the job on.%',true,
 'the job and its context go with it, and the target is told not to use the memory and cronjob tools its own profile keeps, nor hand the job on');
select is((select count(*)::int from public.begin_handover((select id from public.agent_handovers where run_id='run-owner'))),0,'nor does it start again within thirty seconds');
select is(public.answer_handover((select id from public.agent_handovers where run_id='run-owner'),1,'run-target'),true,'the target''s Run is kept once');
select is((select state||':'||run from public.handovers_due(null,0) where id=(select id from public.agent_handovers where run_id='run-owner')),'target:run-target','and is read on the target''s own profile');
select throws_ok($$select public.close_handover_target((select id from public.agent_handovers where run_id='run-owner'),'run-target','failed','Some words')$$,'22023','handoverFailed','only a completed Run keeps a summary');
select is(public.close_handover_target((select id from public.agent_handovers where run_id='run-owner'),'run-target','completed','Three ad sets, 30 days, EGP 9,000.'),true,'the target''s Run ends with what it reported');
select is((select state||':'||target_outcome||':'||summary from public.agent_handovers where run_id='run-owner'),'returning:completed:Three ad sets, 30 days, EGP 9,000.','and the handover waits to report it');
create temporary table returned as select * from public.begin_handover((select id from public.agent_handovers where run_id='run-owner'));
select is((select profile||':'||session||':'||attempt from returned),'co-10000000000000000000000000000001:c3170000-0000-0000-0000-000000000001:1','the follow-up goes to the Lead on the Company''s profile, in the same conversation');
select is((select input from returned) like '%Three ad sets, 30 days, EGP 9,000.%',true,'with what the target reported as its input');
select is(public.answer_handover((select id from public.agent_handovers where run_id='run-owner'),1,'run-return'),true,'the follow-up Run is kept once');
select is((select state||':'||run from public.handovers_due(null,0) where id=(select id from public.agent_handovers where run_id='run-owner')),'follow_up:run-return','and is read');
select is(public.close_handover_follow_up((select id from public.agent_handovers where run_id='run-owner'),'run-return','completed','Ads planned the March intake: three ad sets, 30 days, EGP 9,000.'),true,'Lead''s reply closes the handover');
select is((select author||':'||agent_id||':'||body from public.conversation_messages where run_id='run-return'),'agent:a3170000-0000-0000-0000-000000000011:Ads planned the March intake: three ad sets, 30 days, EGP 9,000.','as Lead''s message in the Conversation');
select is((select outcome from public.conversation_run_ends where run_id='run-return'),'completed','with the Run''s end recorded');
select is((select state from public.agent_handovers where run_id='run-owner'),'done','and the handover done');
select is((select count(*)::int from public.handovers_due(null,0) where id=(select id from public.agent_handovers where run_id='run-owner')),0,'so the worker no longer sees it');
select is(public.close_handover_follow_up((select id from public.agent_handovers where run_id='run-owner'),'run-return','completed','Again'),false,'closing it again stores nothing');

-- #354: a start answer names the leg it was asked in, and the attempt the leg made. A Run id that arrives after another
-- leg was claimed records nothing, even when both attempts are numbered 1, since the counters are counted per leg.
select is(public.answer_handover((select id from public.agent_handovers where run_id='run-contributor' and call_id='call-2'),1,'run-wrong-leg','returning'),false,
 'a start answer from another leg records no Run');
select is(public.answer_handover((select id from public.agent_handovers where run_id='run-contributor' and call_id='call-2'),1,'run-stale-attempt','waiting'),false,
 'nor one from an attempt its leg never made');
select is((select state||':'||coalesce(target_run,'-') from public.agent_handovers where run_id='run-contributor' and call_id='call-2'),'waiting:-',
 'so that handover stays where it was, waiting for its own start');

-- #354: the follow-up leg is given up a day after it began, so a start whose answer was lost still ends, and Lead's
-- follow-up is still asked for within that day.
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,state,target_outcome,summary,return_started_at) values
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000001','run-late','call-late','a3170000-0000-0000-0000-000000000011','a3170000-0000-0000-0000-000000000012','Plan it again','returning','completed','Done.',now()-interval '2 days'),
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000001','run-fresh','call-fresh','a3170000-0000-0000-0000-000000000011','a3170000-0000-0000-0000-000000000012','Plan it once more','returning','completed','Done.',now()-interval '1 hour');
select is((select count(*)::int from public.begin_handover((select id from public.agent_handovers where call_id='call-late'))),0,
 'a follow-up leg that could not start for a day ends');
select is((select state||':'||(closed_at is not null)::text from public.agent_handovers where call_id='call-late'),'failed:true',
 'as a failed handover, so the person is still told the job did not reach them');
select is((select attempt from public.begin_handover((select id from public.agent_handovers where call_id='call-fresh'))),1,
 'while one that began an hour ago is asked for again');

-- #475: a target need not be the person's to call (#354's re-check is a job command's alone now): one hidden from them
-- after the job was kept still starts its Run.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c3170000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a3170000-0000-0000-0000-000000000011','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000005','person','20000000-0000-0000-0000-000000000003','Contributor','Plan the August intake',gen_random_uuid(),'run-hidden');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000005','run-hidden','call-1','Ads','Plan the August intake',null),
 '{"state":"created","agent":"Ads"}'::jsonb,'a job is kept for an Agent the sender sees');
delete from public.member_agent_access where company_id='10000000-0000-0000-0000-000000000001'
 and person_id='20000000-0000-0000-0000-000000000003' and agent_id='a3170000-0000-0000-0000-000000000012';
select is((select count(*)::int from public.begin_handover((select id from public.agent_handovers where run_id='run-hidden'))),1,
 'a target hidden since the job was kept still starts its Run');
select is((select state||':'||coalesce(target_outcome,'-')||':'||target_attempts from public.agent_handovers where run_id='run-hidden'),'waiting:-:1',
 'its first attempt, with nothing ended');

-- #475: an Agent that is not the main one hands work over from its own Conversation. The Contributor talks to Ads and
-- Ads asks Writer, an Agent hidden from them; the job runs on Writer's own profile and Ads's follow-up in Ads's chat.
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a3170000-0000-0000-0000-000000000012');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c3170000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a3170000-0000-0000-0000-000000000012','Ads'),
 ('c3170000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a3170000-0000-0000-0000-000000000012','Ads');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000006','person','20000000-0000-0000-0000-000000000003','Contributor','Write the ad copy',gen_random_uuid(),'run-ads'),
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000007','person','20000000-0000-0000-0000-000000000004','Viewer','Write the ad copy',gen_random_uuid(),'run-ads-viewer');
select is((select string_agg(name||':'||job,',' order by name) from public.conversation_handover_agents('c3170000-0000-0000-0000-000000000006')),'Lead:General,Writer:SEO',
 'the tool names the Company''s other Agents with their job line, never the asking Agent');
select is((select count(*)::int from public.conversation_handover_agents('c3170000-0000-0000-0000-000000000007')),0,'and none to a Viewer''s Run');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000006','run-ads','call-1','Writer','Write three headlines','For the March intake.'),
 '{"state":"created","agent":"Writer"}'::jsonb,'Ads keeps a handover to Writer, which the person does not see');
select is((select from_agent||'>'||to_agent from public.agent_handovers where run_id='run-ads'),'a3170000-0000-0000-0000-000000000012>a3170000-0000-0000-0000-000000000013','from Ads to Writer');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000006','run-ads','call-2','Ads','Write it yourself',null),'{"state":"ignored"}'::jsonb,'an Agent never hands work to itself');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000006','run-ads','call-3','Nobody','Write it',null),'{"state":"ignored"}'::jsonb,'a name no Agent has is ignored');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000007','run-ads-viewer','call-1','Writer','Write it',null),'{"state":"refused"}'::jsonb,'a Viewer''s Run hands nothing over');
select is((select count(*)::int from public.work_cards where conversation_id='c3170000-0000-0000-0000-000000000006'),0,'a non-main Agent''s handover makes no Card of its own');
create temporary table asked as select * from public.begin_handover((select id from public.agent_handovers where run_id='run-ads'));
select is((select profile||':'||session from asked),'ag-a3170000000000000000000000000013:'||md5('c3170000-0000-0000-0000-000000000006:a3170000-0000-0000-0000-000000000013')::uuid,
 'the job runs on Writer''s own profile, in its own session of this chat');
select is((select input from asked) like 'Ads in the team is handing you a job%' and (select input from asked) like '%Reply with your result for Ads:%',true,
 'and names Ads as the Agent that asked');
select is(public.answer_handover((select id from public.agent_handovers where run_id='run-ads'),1,'run-writer','waiting'),true,'Writer''s Run is kept');
select is(public.close_handover_target((select id from public.agent_handovers where run_id='run-ads'),'run-writer','completed','Three headlines.'),true,'and ends with its answer');
create temporary table followed as select * from public.begin_handover((select id from public.agent_handovers where run_id='run-ads'));
select is((select profile||':'||session from followed),'ag-a3170000000000000000000000000012:c3170000-0000-0000-0000-000000000006','Ads''s follow-up runs on Ads''s own profile in the Conversation''s session');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select from_name||'>'||to_name||':'||coalesce(answer,'-')||':'||(answered_at is not null)::text from public.conversation_handovers('c3170000-0000-0000-0000-000000000006')),
 'Ads>Writer:Three headlines.:true','the Contributor reads the row and Writer''s answer in their chat with Ads');
reset role;

-- #358 is unchanged: a job command hands over only from the main Agent's Conversation.
update public.hermes_agents set template='writer' where id='a3170000-0000-0000-0000-000000000013';
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a3170000-0000-0000-0000-000000000013');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.command_handover('c3170000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000012',gen_random_uuid(),'/write three headlines','writer','three headlines'),
 false,'a command typed to another Agent is sent as plain text');
select is(public.command_handover('c3170000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000011',gen_random_uuid(),'/write three headlines','writer','three headlines'),
 true,'and one typed to the main Agent still hands its job over');
reset role;
select * from finish();
rollback;
