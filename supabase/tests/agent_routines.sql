begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
-- #31: an Agent's Routine is changed by an active Owner or Manager of its Company only, and each change is one row of
-- the Company log naming who, the Agent, the Routine and its schedule. RS Learning: 1 Owner, 2 Manager, 3 Contributor,
-- 4 Viewer. Written without the guards, as memory_notes.sql does.
set local session_replication_role=replica;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000191','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000191','Lead','General',true,'co-10000000000000000000000000000001'),
 ('e1000000-0000-0000-0000-000000000192','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000192','Ads','Meta ads',false,'ag-e1000000000000000000000000000192'),
 ('e1000000-0000-0000-0000-000000000193','10000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000193','Sara','Writing',true,'co-10000000000000000000000000000003');
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.check_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000192','routine_paused','Ads summary',null)$$,'the Owner may change a Routine of the Agent');
select public.log_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000192','routine_created','Ads summary','0 9 * * *');
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log where action='routine_created' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent','e1000000-0000-0000-0000-000000000192','routine_created',jsonb_build_object('agent_name','Ads','routine','Ads summary','schedule','0 9 * * *')),
 'a new Routine is one row naming who, the Agent, the Routine and its schedule');
select public.log_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000192','routine_paused','Ads summary',null);
select is((select details from public.company_log where action='routine_paused' order by id desc limit 1),
 jsonb_build_object('agent_name','Ads','routine','Ads summary'),'a pause names the Routine and no schedule');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.check_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000192','routine_paused','Ads summary',null)$$,'a Manager may change one');
select lives_ok($$select public.log_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000192','routine_changed','Ads summary','30 8 * * 1')$$,'and the change is logged as theirs');
select lives_ok($$select public.log_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000192','routine_run','Ads summary',null)$$,'a run now is logged');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000191','routine_paused','Lead summary',null)$$,'42501','routineNotAllowed','a Contributor may not change a Routine, even of the main Agent');
select throws_ok($$select public.log_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000191','routine_paused','Lead summary',null)$$,'42501','routineNotAllowed','nor log one');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.check_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000191','routine_paused','Lead summary',null)$$,'42501','routineNotAllowed','nor a Viewer');
select throws_ok($$select public.log_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000191','routine_run','Lead summary',null)$$,'42501','routineNotAllowed','who logs nothing either');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.check_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000193','routine_paused','Sara summary',null)$$,'42501','routineNotAllowed','an Agent of another Company is never changed from this one');
select throws_ok($$select public.log_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000192','routine_created','Ads summary','rm -rf /')$$,'22023','routineInvalid','a schedule that is not a cron expression is refused');
select throws_ok($$select public.log_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000192','routine_dropped','Ads summary',null)$$,'22023','routineInvalid','so is an act that is not a Routine change');
reset role;
select throws_ok($$select public.check_routine_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000192','routine_created','Ads summary',null)$$,'22023','routineInvalid','the check refuses before the Engine what the log would refuse: a new Routine with no schedule');
select is((select count(*)::int from public.company_log where action like 'routine_%'),4,'refused changes write no log row');
-- Read as the database, past the log's own row-level security.
select is((select actor_id from public.company_log where action='routine_changed' order by id desc limit 1),'20000000-0000-0000-0000-000000000002'::uuid,'the Manager is named');
select ok(not has_function_privilege('anon','public.log_routine_change(uuid,uuid,text,text,text)','execute'),'no signed-out caller reaches the log');
select * from finish();
rollback;
