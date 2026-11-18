begin;
create extension if not exists pgtap with schema extensions;
select plan(35);
-- RS Learning with four Agents: Lead (main), Ads, SEO and Coder; Aleem's Lead is another Company's. The Contributor
-- (…03) has a Conversation with each, a message in two, and every Agent has a row in the log.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a1500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a1500000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000002','Ads','Ads',false,'default'),
 ('a1500000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000003','SEO','SEO',false,'default'),
 ('a1500000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000004','Coder','Code',false,'default'),
 ('a1500000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000003','f1500000-0000-0000-0000-000000000005','Lead','General',true,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('c1500000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',('a1500000-0000-0000-0000-00000000000'||n)::uuid,name
 from public.hermes_agents, generate_series(1,4) n where id=('a1500000-0000-0000-0000-00000000000'||n)::uuid;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('c1500000-0000-0000-0000-00000000000'||n)::uuid,'person','20000000-0000-0000-0000-000000000003','مراجع','Hello',gen_random_uuid(),'visibility-run-'||n from generate_series(2,4,2) n;
insert into public.waiting_items(company_id,person_id,kind,title,conversation_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','question','From Coder','c1500000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','question','From SEO','c1500000-0000-0000-0000-000000000003');
select public.log_agent_event('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null,('a1500000-0000-0000-0000-00000000000'||n)::uuid,'attach','{}') from generate_series(1,4) n;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- The Owner allows the Contributor two of the three Agents beside Lead.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000002',true)$$,'the Owner shows Ads to the Contributor');
select lives_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000003',true)$$,'and SEO');
select lives_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a1500000-0000-0000-0000-000000000002',true)$$,'and Ads to the Manager');
select is((select string_agg(name,',' order by name) from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001'),'Ads,Coder,Lead,SEO','the Owner sees every Agent without being allowed any');
select throws_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000001',false)$$,'42501','mainAgentShownToAll','the main Agent cannot be hidden');
select throws_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a1500000-0000-0000-0000-000000000001',true)$$,'42501','mainAgentShownToAll','nor given a row of its own');
select throws_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000004',false)$$,'42501','ownerSeesEveryAgent','the Owner sees every Agent');
select throws_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000005',true)$$,'P0002','agentNotFound','another Company''s Agent is not found');
select throws_ok($$delete from public.member_agent_access$$,'42501',null,'nobody changes the rows except through set_agent_visible');

-- A Manager changes it too, for the Agents the Manager sees.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','a1500000-0000-0000-0000-000000000002',true)$$,'a Manager shows Ads to another Member');
select is((select count(*)::int from public.member_agent_access where company_id='10000000-0000-0000-0000-000000000001'),4,'a Manager reads every Member''s switches');
select is((select string_agg(name,',' order by name) from public.hermes_agents),'Ads,Lead','a Manager sees the main Agent and the Agents allowed to them');
select throws_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','a1500000-0000-0000-0000-000000000004',true)$$,'P0002','agentNotFound','an Agent hidden from the Manager is not found for them to show');

-- The Contributor: two of four Agents allowed, and Lead.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000004',true)$$,'42501','agentVisibilityNotAllowed','a Contributor cannot change visibility');
select is((select string_agg(name,',' order by name) from public.hermes_agents),'Ads,Lead,SEO','the Contributor reads the allowed Agents and the main Agent');
select is((select string_agg(agent_name,',' order by agent_name) from public.conversations),'Ads,Lead,SEO','and only their Conversations');
select is((select count(*)::int from public.conversation_messages where conversation_id='c1500000-0000-0000-0000-000000000004'),0,'not a message with the hidden Agent');
select is((select count(*)::int from public.conversation_messages where conversation_id='c1500000-0000-0000-0000-000000000002'),1,'while an allowed Agent''s messages read as before');
select is((select string_agg(details->>'agent_name',',' order by details->>'agent_name') from public.company_log where subject='agent'),'Ads,Lead,SEO','the log leaves out the hidden Agent');
select is((select count(*)::int from public.company_log where agent_id='a1500000-0000-0000-0000-000000000004'),0,'and so does the Agent record');
select is((select count(*)::int from public.member_agent_access),2,'a Member reads their own switches only');
select throws_ok($$select public.agent_visible_to('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','a1500000-0000-0000-0000-000000000002')$$,'42501',null,'a Member cannot ask whether another person sees an Agent');
select is(public.can_see_agent('10000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000005'),false,'nor learn anything of a Company they are not in');
select is((select string_agg(title,',' order by title) from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'),'From SEO','Waiting on you leaves out the hidden Agent''s question');
select throws_ok($$select * from public.conversation_stop_target('c1500000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001')$$,'P0002','conversationNotFound','nor can its run be stopped');
select throws_ok($$select public.send_conversation_message('c1500000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000004','Hi','e1500000-0000-0000-0000-000000000001','visibility-run-9')$$,'P0002','conversationNotFound','a Conversation with the hidden Agent cannot start, even by its address');
select throws_ok($$select public.reserve_conversation_turn('c1500000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000004','e1500000-0000-0000-0000-000000000002','Hi')$$,'P0002','conversationNotFound','nor an older one go on');
select throws_ok($$insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('c1500000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000004','Coder')$$,'42501',null,'the database refuses the insert');
select is(public.send_conversation_message('c1500000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000003','Hi','e1500000-0000-0000-0000-000000000003','visibility-run-7'),true,'an allowed Agent''s Conversation starts');

-- A Viewer cannot change it, and sees the main Agent with nothing allowed.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a1500000-0000-0000-0000-000000000002',true)$$,'42501','agentVisibilityNotAllowed','a Viewer cannot change visibility');
select is((select string_agg(name,',' order by name) from public.hermes_agents),'Lead','the main Agent is visible to every Member');

-- Hiding an Agent again takes it, and its Conversations, away at once.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000002',false)$$,'the Owner hides Ads from the Contributor');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select string_agg(name,',' order by name) from public.hermes_agents),'Lead,SEO','Ads is gone for the Contributor');
select is((select string_agg(agent_name,',' order by agent_name) from public.conversations),'Lead,SEO,SEO','with its Conversation');

-- The worker, with no person, finishes what a person sent while the Agent was shown.
reset role;
select set_config('request.jwt.claim.sub','',true);
select lives_ok($$insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('c1500000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000004','Coder')$$,'a write with no person is not refused');
select * from finish();
rollback;
