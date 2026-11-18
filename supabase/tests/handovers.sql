begin;
create extension if not exists pgtap with schema extensions;
select plan(44);
-- #317. RS Learning: Lead on the Company's own profile, Ads and Writer on profiles of their own. The Contributor (…03) is
-- shown Ads and not Writer; the Viewer (…04) writes nothing. Aleem has its own Lead and Ads.
insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy,skills_shared) values
 ('a3170000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy(),true),
 ('a3170000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy(),true),
 ('a3170000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000003',1,public.engine_tool_policy(),true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions) values
 ('a3170000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f3170000-0000-0000-0000-000000000011','Lead','General',true,'co-10000000000000000000000000000001','Lead the team.'),
 ('a3170000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f3170000-0000-0000-0000-000000000012','Ads','Ads',false,'ag-a3170000000000000000000000000012','Run the Meta ads.'),
 ('a3170000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','f3170000-0000-0000-0000-000000000013','Writer','SEO',false,'ag-a3170000000000000000000000000013','Write for search.'),
 ('a3170000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000003','f3170000-0000-0000-0000-000000000021','Lead','General',true,'co-10000000000000000000000000000003','Lead another team.'),
 ('a3170000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000003','f3170000-0000-0000-0000-000000000022','Ads','Ads',false,'ag-a3170000000000000000000000000022','Run another team''s ads.');
insert into public.company_profiles(company_id,profile,tools_level,tools_policy,skills_shared) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy(),true),
 ('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',1,public.engine_tool_policy(),true);
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

-- Only the Lead is offered the tool, and only to a writer of the Company.
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001')),true,'the Lead offers hand_to_agent to the Owner');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001')),false,'another Agent never hands work on');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000003')),true,'a Contributor talking to the Lead is offered it');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000004')),false,'a Viewer writes nothing, so it is offered nothing');
select is('hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000003','a3170000-0000-0000-0000-000000000021','20000000-0000-0000-0000-000000000003')),false,'and a non-member is offered nothing');
select is('create_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001')) or 'hand_to_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001','a3170000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001')),false,'the target is offered neither tool');

-- The handover Lead's call keeps: one per call, to an Agent of the same Company the person sees.
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-owner','call-1',' Ads ','Plan the Meta ads for the March intake','EGP 9,000 for 30 days.'),
 '{"state":"created","agent":"Ads"}'::jsonb,'the Lead keeps a handover to an Agent of its Company');
select is((select from_agent||'>'||to_agent||':'||state||':'||goal||':'||context from public.agent_handovers where run_id='run-owner'),
 'a3170000-0000-0000-0000-000000000011>a3170000-0000-0000-0000-000000000012:waiting:Plan the Meta ads for the March intake:EGP 9,000 for 30 days.','from Lead to Ads, waiting, with the job and its context');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-owner','call-1','Ads','Plan it again',null),'{"state":"created","agent":"Ads"}'::jsonb,'the same call again answers the same');
select is((select count(*)::int from public.agent_handovers),1,'and keeps one handover');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-owner','call-2','Nobody','Plan',''),'{"state":"ignored"}'::jsonb,'a name no Agent of the Company has is ignored');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-owner','call-3','Lead','Plan',''),'{"state":"ignored"}'::jsonb,'and the Lead never hands work to itself');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000003','run-contributor','call-1','Writer','Plan',''),'{"state":"ignored"}'::jsonb,'an Agent the sender does not see is no target');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000003','run-contributor','call-2','Ads','Plan the March intake',null),'{"state":"created","agent":"Ads"}'::jsonb,'and one they see is');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000021','run-aleem','call-1','Writer','Plan',''),'{"state":"ignored"}'::jsonb,'an Agent of another Company is never a target');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000021','run-aleem','call-2','Ads','Plan the March intake',null),'{"state":"created","agent":"Ads"}'::jsonb,'the name picks the sender''s own Company''s Agent');
select is((select company_id from public.agent_handovers where run_id='run-aleem'),'10000000-0000-0000-0000-000000000003'::uuid,'and the row belongs to that Company');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000004','run-viewer','call-1','Ads','Plan',''),'{"state":"refused"}'::jsonb,'a Viewer''s Conversation hands nothing over, and its Run still closes');
select is(public.lead_hand_to_agent('c3170000-0000-0000-0000-000000000001','run-nobody','call-1','Ads','Plan',''),'{"state":"refused"}'::jsonb,'a run of no message of the Conversation is refused');

-- The person reads the handovers of their own Conversation, and only those made with Agents they see.
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal) values
 ('10000000-0000-0000-0000-000000000001','c3170000-0000-0000-0000-000000000003','run-contributor','call-9','a3170000-0000-0000-0000-000000000011','a3170000-0000-0000-0000-000000000013','A hidden one');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(to_agent::text,',' order by to_agent) from public.agent_handovers),'a3170000-0000-0000-0000-000000000012,a3170000-0000-0000-0000-000000000022','the Owner reads the handovers of their own Conversations in both Companies');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select string_agg(to_agent::text,',' order by to_agent) from public.agent_handovers),'a3170000-0000-0000-0000-000000000012','a Contributor reads theirs, without the Agent hidden from them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.agent_handovers),0,'a Viewer reads another person''s handovers from none');
select throws_ok($$select * from public.handovers_due()$$,'42501',null,'nor can any person list the worker''s due handovers');
reset role;

-- The worker moves the two Runs: the target's own profile first, then the Lead's follow-up in the same session.
create temporary table begun as select * from public.begin_handover((select id from public.agent_handovers where run_id='run-owner'));
select is((select count(*)::int from public.handovers_due(null,0) where id=(select id from public.agent_handovers where run_id='run-owner')),0,'the handover that began is no longer due');
select is((select state||':'||attempt from public.handovers_due(null,0) where conversation='c3170000-0000-0000-0000-000000000003' limit 1),'waiting:0','another kept handover waits for the worker');
select is((select profile||':'||session||':'||instructions from begun),'ag-a3170000000000000000000000000012:c3170000-0000-0000-0000-000000000001:Run the Meta ads.','the target''s own profile, the Conversation''s session, and its own instructions');
select is((select attempt from begun),1,'the first attempt of the target''s Run');
select is((select input from begun) like '%Plan the Meta ads for the March intake%' and (select input from begun) like '%EGP 9,000 for 30 days.%',true,'the job and its context go with it');
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
select * from finish();
rollback;
