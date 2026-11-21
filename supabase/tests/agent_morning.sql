begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
-- #182: the main Agent's daily message is changed by an active Owner or Manager of its Company only (check_agent_setting,
-- asked before the Engine), and each change is one row of the Company log on the Agent naming who did it and the old and
-- the new value (log_agent_morning: "off" or the time). RS Learning: 1 Owner, 2 Manager, 3 Contributor,
-- 4 Viewer. Written without the guards, as agent_routines.sql does.
set local session_replication_role=replica;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000182','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000182','Lead','General',true,'co-10000000000000000000000000000001'),
 ('e1000000-0000-0000-0000-000000000184','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000184','Ads','Meta ads',false,'ag-e1000000000000000000000000000184'),
 ('e1000000-0000-0000-0000-000000000183','10000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000183','Sara','Writing',true,'co-10000000000000000000000000000003');
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.check_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000182')$$,'the Owner may change good morning');
select lives_ok($$select public.log_agent_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000182','off','9:00')$$,'and the change is logged');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.check_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000182')$$,'a Manager may change it');
select lives_ok($$select public.log_agent_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000182','9:00','off')$$,'and switching it off is logged as theirs');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000182')$$,'42501','agentSettingNotAllowed','a Contributor is refused before the Engine is asked');
select throws_ok($$select public.log_agent_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000182','off','9:00')$$,'42501','agentSettingNotAllowed','and logs nothing');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.check_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000182')$$,'42501','agentSettingNotAllowed','so is a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.log_agent_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000182','off','rm -rf /')$$,'22023','agentSettingInvalid','a value that is not off, a time or a schedule is refused');
select throws_ok($$select public.log_agent_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000182','9:00','9:00')$$,'22023','agentSettingInvalid','so is a change that changes nothing');
select throws_ok($$select public.log_agent_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000184','off','9:00')$$,'22023','agentSettingInvalid','and another Agent than the main one has no daily message');
select throws_ok($$select public.check_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000183')$$,'42501','agentSettingNotAllowed','an Agent of another Company is never changed from this one');
-- The Company's lease (agent_morning_leases): one holder at a time, given back by that holder; Owners and Managers only.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.take_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),true,'the Owner takes the lease');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.take_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'),false,'a second holder waits while it is held');
select public.drop_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
select is(public.take_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'),false,'and cannot give back a lease it does not hold');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.drop_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.take_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'),true,'once given back, a Manager takes it');
select is(public.renew_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'),true,'and renews it before each Engine write');
select is(public.renew_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),false,'a holder that gave it back renews nothing');
select is(public.morning_lease_profiles('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
 array['ag-e1000000000000000000000000000184','co-10000000000000000000000000000001'],'{}'),
 array['ag-e1000000000000000000000000000184','co-10000000000000000000000000000001'],'the profiles still to settle are kept with the lease');
select is(public.morning_lease_profiles('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','{}','{}'),null,'only for its holder');
select throws_ok($$select public.morning_lease_profiles('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',array['../etc'],'{}')$$,'22023','agentSettingInvalid','and only Engine profiles');
-- A holder whose time ran out renews nothing, even with nobody holding it since: what it read may be stale.
reset role;
update public.agent_morning_leases set until=now()-interval '1 second' where company_id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.renew_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'),false,'a lease that ran out is not renewed');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.take_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004');
select is(public.morning_lease_profiles('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','{}',array['co-10000000000000000000000000000001']),
 array['ag-e1000000000000000000000000000184'],'the next holder finds the profiles still to settle and takes off the settled ones');
-- The main Agent changes only under a running lease, checked and changed in one transaction.
select throws_ok($$select public.manage_hermes_agent_leased('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','default','e1000000-0000-0000-0000-000000000184')$$,
 '55P03','morningLeaseLost','a holder whose lease ran out changes no Agent');
select is((select is_default from public.hermes_agents where id='e1000000-0000-0000-0000-000000000182'),true,'so Lead is still the main Agent');
select lives_ok($$select public.manage_hermes_agent_leased('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','default','e1000000-0000-0000-0000-000000000184')$$,
 'the holder makes another Agent main');
select is((select is_default from public.hermes_agents where id='e1000000-0000-0000-0000-000000000184'),true,'and it is the main Agent');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.renew_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003')$$,'42501','agentSettingNotAllowed','a Contributor renews none');
select throws_ok($$select public.take_morning_lease('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003')$$,'42501','agentSettingNotAllowed','a Contributor takes none');
select throws_ok($$select * from public.agent_morning_leases$$,'42501',null,'and nobody reads the table itself');
reset role;
-- Read as the database, past the log's own row-level security.
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log
  where action='agent_setting_changed' and details->>'field'='morning' order by id limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent','e1000000-0000-0000-0000-000000000182','agent_setting_changed',
  jsonb_build_object('agent_name','Lead','field','morning','old','off','new','9:00')),
 'switching on is one row on the Agent naming who, the old value and the new time');
select is((select jsonb_build_array(actor_id,details->>'old',details->>'new') from public.company_log
  where action='agent_setting_changed' and details->>'field'='morning' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000002','9:00','off'),'switching off names the Manager, the old time and Off');
select is((select count(*)::int from public.company_log where action='agent_setting_changed' and details->>'field'='morning'),2,'one row per change, none for a refused one');
select * from finish();
rollback;
