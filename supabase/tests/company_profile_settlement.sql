begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
-- R&S Consultations (2) runs on its own profile; Aleem (3) is on the shared profile with a Contributor (5).
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002');
reset role;
update public.company_profiles set skills_shared=true where company_id='10000000-0000-0000-0000-000000000002';
set local role service_role;
select public.attach_company_profile('10000000-0000-0000-0000-000000000002');

-- 2. Changing tools is marked first: until the read-back matches and is recorded, no run starts.
reset role;
create temporary table rs as select id as agent from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000002';
grant select on rs to authenticated;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002');
select lives_ok($$select public.begin_company_tools('10000000-0000-0000-0000-000000000002')$$,'the worker marks the tools as changing before it writes them');
select ok((select tools_pending from public.company_profile_work() where company_id='10000000-0000-0000-0000-000000000002'),'a profile whose change was not confirmed stays work');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.reserve_conversation_run('c4000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',(select agent from rs),'c5000000-0000-0000-0000-000000000002','Hi')$$,'55000','agentToolsPending',
 'a change written but not recorded (1 to 3, then back to 1) starts nothing although the levels agree');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select ok(public.reserve_conversation_run('c4000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',(select agent from rs),'c5000000-0000-0000-0000-000000000002','Hi') is not null,'once the read-back is recorded, runs start');

-- 3. A retry passes the same checks as a new reservation: none while the profile's tools are pending.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.begin_company_tools('10000000-0000-0000-0000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.reserve_conversation_run('c4000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',(select agent from rs),'c5000000-0000-0000-0000-000000000002','Hi')$$,'55000','agentToolsPending',
 'a retry of an existing reservation is refused while the tools are pending');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002');

-- 4. An active reservation holds the move; after ten minutes the worker abandons it, without Hermes.
-- The previous version's provider put each Company with no Agent on the shared `default` profile (#342 dropped it).
reset role;
insert into public.hermes_agents(company_id,name,speciality,is_default,profile) select c.id,'Lead','General',true,'default' from public.companies c
 where not exists(select 1 from public.hermes_agents a where a.company_id=c.id) and exists(select 1 from public.members m where m.company_id=c.id and m.role='owner' and m.removed_at is null);
set local role service_role;
select cmp_ok((select count(*)::int from public.hermes_agents where profile='default'),'>=',1,'Aleem is on the shared profile');
select public.record_company_profile('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003');
reset role;
update public.company_profiles set skills_shared=true where company_id='10000000-0000-0000-0000-000000000003';
create temporary table aleem as select id as agent,connection_id from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000003';
grant select on aleem to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.reserve_conversation_run('c4000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c5000000-0000-0000-0000-000000000003','Hello'),(select connection_id from aleem),'the run is reserved on the shared Connection');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003'),0,'an active reservation holds the move');
reset role;
set local role service_role;
select is(public.abandon_conversation_reservations(),0,'a young reservation is not abandoned');
reset role;
update public.conversation_run_reservations set created_at=now()-interval '11 minutes' where company_id='10000000-0000-0000-0000-000000000003';
set local role service_role;
select is(public.abandon_conversation_reservations(),1,'after ten minutes it is abandoned');
reset role;
select is((select profile||':'||(connection_id=(select connection_id from aleem))::text||':'||(abandoned_at is not null)::text from public.conversation_run_reservations where company_id='10000000-0000-0000-0000-000000000003'),
 'default:true:true','it is kept with its pinned Connection and profile');

-- 5. The quiet window still holds a move after a message; an abandoned reservation does not hold the move.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select public.reserve_conversation_run('c4000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c5000000-0000-0000-0000-000000000005','Hi again');
select ok(public.send_conversation_message('c4000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000003',(select agent from aleem),'Hi again','c5000000-0000-0000-0000-000000000005','run_quiet',(select connection_id from aleem)),'a run is recorded');
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
 values ('10000000-0000-0000-0000-000000000003','c4000000-0000-0000-0000-000000000005','agent',(select agent from aleem),'Lead','Hi','run_quiet');
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003'),0,'no move right after a message, though no run is open');
reset role;
-- Messages are append-only; the test moves their time back with the triggers off.
set local session_replication_role=replica;
update public.conversation_messages set created_at=now()-interval '6 minutes' where company_id='10000000-0000-0000-0000-000000000003';
set local session_replication_role=origin;
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003'),1,'after five quiet minutes the company moves past the abandoned reservation');
reset role;
select ok(exists(select 1 from public.conversation_run_reservations where company_id='10000000-0000-0000-0000-000000000003' and abandoned_at is not null),'the abandoned reservation stays for the record');
-- The race: the send that reserved on the shared Connection (section 4) records only now, after it was abandoned and
-- the company moved. Its run would be read on the new profile and end lost, so the record is refused.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.send_conversation_message('c4000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'Hello','c5000000-0000-0000-0000-000000000003','run_late',(select connection_id from aleem))$$,'55000','conversationSendAgain',
 'a late record of an abandoned reservation is refused after the move');
reset role;
-- The person sends again with the same send key: the abandoned reservation is replaced on Aleem's own Connection. The old
-- request, whose run started on the shared Connection, still arrives late: it is refused; the new one is recorded.
create temporary table moved as select connection_id from public.hermes_agents where id=(select agent from aleem);
grant select on moved to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.reserve_conversation_run('c4000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c5000000-0000-0000-0000-000000000003','Hello'),(select connection_id from moved),
 'sending again reserves on the company''s own Connection');
select throws_ok($$select public.send_conversation_message('c4000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'Hello','c5000000-0000-0000-0000-000000000003','run_old',(select connection_id from aleem))$$,'55000','conversationSendAgain',
 'the old request, started on the shared Connection, is refused after the re-reservation');
select ok(public.send_conversation_message('c4000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',(select agent from aleem),'Hello','c5000000-0000-0000-0000-000000000003','run_new',(select connection_id from moved)),
 'the new request, started on the pinned Connection, is recorded');
select ok(public.reserve_conversation_run('c4000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000003',(select agent from aleem),'c5000000-0000-0000-0000-000000000008','Hi') is not null,'another run is reserved');
select throws_ok($$select public.send_conversation_message('c4000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000003',(select agent from aleem),'Hi','c5000000-0000-0000-0000-000000000008','run_unpinned')$$,'55000','conversationSendAgain',
 'a reserved run recorded without the Connection it started on is refused');
reset role;

-- 6. A reservation that can never be recorded (its Agent is gone) is abandoned at once, without Hermes.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.reserve_conversation_run('c4000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000002',(select agent from rs),'c5000000-0000-0000-0000-000000000006','Bye');
reset role;
delete from public.hermes_agents where id=(select agent from rs);
set local role service_role;
select is(public.abandon_conversation_reservations(),2,'the reservations of a removed Agent are abandoned at once');
reset role;
select * from finish();
rollback;
