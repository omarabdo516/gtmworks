begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
-- R&S Consultations (2) runs on its own profile; Aleem (3) is on the shared profile with a Contributor (5).
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy());
select public.attach_company_profile('10000000-0000-0000-0000-000000000002','http://hermes:8642','encrypted','0.23.0','{run_submission}');

-- 1. The tool policy is versioned: a profile applied under an older policy is applied again, and runs wait for it.
reset role;
update public.company_profiles set tools_policy=public.engine_tool_policy()-1 where company_id='10000000-0000-0000-0000-000000000002';
set local role service_role;
select ok((select tools_level=agent_level and tools_policy<>public.engine_tool_policy() from public.company_profile_work() where company_id='10000000-0000-0000-0000-000000000002'),
 'a profile applied under an older policy is work again, even at the same level');
select throws_ok($$select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy()-1)$$,'22023','companyProfileInvalid','only the current policy is recorded');
reset role;
create temporary table rs as select id as agent from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000002';
grant select on rs to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.reserve_conversation_run('c4000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',(select agent from rs),'c5000000-0000-0000-0000-000000000002','Hi')$$,'55000','agentLevelPending','no run starts on a profile under an older policy');

-- 2. Changing tools is marked first: until the read-back matches and is recorded, no run starts, whatever the levels say.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy());
select lives_ok($$select public.begin_company_tools('10000000-0000-0000-0000-000000000002')$$,'the worker marks the tools as changing before it writes them');
select ok((select tools_pending from public.company_profile_work() where company_id='10000000-0000-0000-0000-000000000002'),'a profile whose change was not confirmed stays work');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.reserve_conversation_run('c4000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',(select agent from rs),'c5000000-0000-0000-0000-000000000002','Hi')$$,'55000','agentLevelPending',
 'a change written but not recorded (1 to 3, then back to 1) starts nothing although the levels agree');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy());
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select ok(public.reserve_conversation_run('c4000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',(select agent from rs),'c5000000-0000-0000-0000-000000000002','Hi') is not null,'once the read-back is recorded, runs start');

-- 3. A reservation never expires by age and its Connection is never deleted under it; the worker settles it with Hermes.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select cmp_ok(public.provide_bundled_hermes('http://hermes:8642','default','encrypted','0.23.0','{run_submission}'),'>=',1,'Aleem is on the shared profile');
select public.record_company_profile('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',1,public.engine_tool_policy());
reset role;
create temporary table aleem as select id as agent,connection_id from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000003';
grant select on aleem to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.reserve_conversation_run('c4000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c5000000-0000-0000-0000-000000000003','Hello'),(select connection_id from aleem),'the run is reserved on the shared Connection');
reset role;
-- Hermes started the run, but saving the message failed; an hour passes.
update public.conversation_run_reservations set created_at=now()-interval '1 hour' where company_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),0,'an old reservation still holds the move');
reset role;
select throws_ok($$delete from public.hermes_connections where id=(select connection_id from aleem)$$,'23503',null,'its Connection cannot be deleted under it');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select is(public.reserve_conversation_run('c4000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c5000000-0000-0000-0000-000000000003','Hello'),(select connection_id from aleem),'a retry starts on the pinned Connection');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select string_agg(profile||':'||message||':'||send_key,',') from public.unsettled_conversation_runs()),'default:Hello:c5000000-0000-0000-0000-000000000003','the worker finds the unsettled run with its pinned profile and message');
select ok(public.settle_conversation_run('c4000000-0000-0000-0000-000000000003','c5000000-0000-0000-0000-000000000003','run_settled'),'the worker records the run Hermes replayed for it');
reset role;
select is((select person_id::text||':'||body from public.conversation_messages where run_id='run_settled'),'20000000-0000-0000-0000-000000000005:Hello','as the person''s own message');
select is((select count(*)::int from public.conversation_run_reservations),1,'and the reservation is settled (only R&S''s remains)');

-- 4. The previous app version calls Hermes before it records: a move waits until the company's conversations were quiet.
insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
 values ('10000000-0000-0000-0000-000000000003','c4000000-0000-0000-0000-000000000003','agent',(select agent from aleem),'Lead','Hi','run_settled');
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),0,'no move right after a message, though no run is open');
reset role;
-- Messages are append-only; the test moves their time back with the triggers off.
set local session_replication_role=replica;
update public.conversation_messages set created_at=now()-interval '6 minutes' where conversation_id='c4000000-0000-0000-0000-000000000003';
set local session_replication_role=origin;
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),1,'after five quiet minutes the company moves');
reset role;
select ok(not exists(select 1 from public.hermes_connections where id=(select connection_id from aleem)),'and the shared Connection nobody pins any more is removed');
select * from finish();
rollback;
