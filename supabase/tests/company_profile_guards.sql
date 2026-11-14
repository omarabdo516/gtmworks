begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- Omar owns R&S Consultations (2) and Aleem (3); 5 is a Contributor of Aleem. R&S runs on its own profile.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy());
select public.attach_company_profile('10000000-0000-0000-0000-000000000002','http://hermes:8642','encrypted','0.23.0','{run_submission}');
reset role;
create temporary table ids as select (select connection_id from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000002') as rs;
grant select on ids to authenticated;

-- 1. A Company profile serves its own Company only: not through the sharing confirmation, not through a pasted row.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000003','attach',(select rs from ids),null,'Borrowed','General',false,true)$$,'42501','hermesProfileNotShared',
 'an Owner of both companies cannot attach one company''s profile to the other''s agent, even after the sharing warning');
select throws_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) values ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','http://hermes:8642','co-10000000000000000000000000000002','x','connected')$$,
 '42501','hermesProfileNotShared','nor save a Connection to it in the other company');
reset role;
select throws_ok($$update public.hermes_agents set company_id='10000000-0000-0000-0000-000000000003' where connection_id=(select rs from ids)$$,'42501','hermesProfileNotShared','no writer moves an agent on it to another company');
select lives_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','writer','x','connected')$$,'other profiles are unchanged');

-- 2. A Run is reserved on its pinned Connection before Hermes is called, and a move waits for it.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select cmp_ok(public.provide_bundled_hermes('http://hermes:8642','default','encrypted','0.23.0','{run_submission}'),'>=',1,'Aleem is on the shared profile');
select public.record_company_profile('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',1,public.engine_tool_policy());
reset role;
insert into ids select connection_id from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000003';
create temporary table aleem as select a.id as agent,a.connection_id from public.hermes_agents a where a.company_id='10000000-0000-0000-0000-000000000003';
grant select on aleem to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.reserve_conversation_run('c2000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c3000000-0000-0000-0000-000000000003','Hello'),(select connection_id from aleem),
 'a member reserves the run on the agent''s current Connection');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),0,'a move between reservation and start waits');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.reserve_conversation_run('c2000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c3000000-0000-0000-0000-000000000003','Hello'),(select connection_id from aleem),'a retry keeps the same Connection');
select ok(public.send_conversation_message('c2000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'Hello','c3000000-0000-0000-0000-000000000003','run_reserved',(select connection_id from aleem)),'the started run is recorded');
reset role;
select is((select count(*)::int from public.conversation_run_reservations),0,'recording ends the reservation');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),0,'the open run still holds the move');
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
 values ('10000000-0000-0000-0000-000000000003','c2000000-0000-0000-0000-000000000003','agent',(select agent from aleem),'Lead','Hi','run_reserved');
-- Five quiet minutes pass (messages are append-only, so their time is moved back with the triggers off).
set local session_replication_role=replica;
update public.conversation_messages set created_at=now()-interval '6 minutes' where company_id='10000000-0000-0000-0000-000000000003';
set local session_replication_role=origin;
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),1,'once it ended, the company moves');
reset role;

-- 3. No new run while the profile's tools differ from the level the Owner chose.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.set_agent_level('10000000-0000-0000-0000-000000000003',3),3,'the Owner raises the level');
select throws_ok($$select public.reserve_conversation_run('c2000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c3000000-0000-0000-0000-000000000004','Hello')$$,'55000','agentLevelPending',
 'no run starts until the worker applied the new tools');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',3,public.engine_tool_policy());
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select ok(public.reserve_conversation_run('c2000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c3000000-0000-0000-0000-000000000004','Hello') is not null,'once applied, runs start again');
reset role;
set local role anon;
select throws_ok($$select public.reserve_conversation_run('c2000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003',null,'c3000000-0000-0000-0000-000000000004','Hello')$$,'42501',null,'a visitor reserves nothing');
select * from finish();
rollback;
