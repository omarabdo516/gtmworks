begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
-- Review of spec #353 (#350): an Agent's memory is reset by an active Owner of its Company alone, and each reset is one
-- row of the Company log naming the person and the Agent, with nothing of the notes. RS Learning: 1 Owner, 2 Manager,
-- 3 Contributor, 4 Viewer. Ads is not the main Agent, so a Member without a grant for it does not see it (#15).
-- Written without the guards, as company_apps.sql does: the functions read only which profile is whose.
set local session_replication_role=replica;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000081','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000081','Lead','General',true,'co-10000000000000000000000000000001'),
 ('e1000000-0000-0000-0000-000000000082','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000082','Ads','Meta ads',false,'ag-e1000000000000000000000000000082'),
 ('e1000000-0000-0000-0000-000000000083','10000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000083','Sara','Writing',true,'co-10000000000000000000000000000003');
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy()),
 ('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',1,public.engine_tool_policy());
insert into public.company_profile_keepers(company_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000081'),
 ('10000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000083');
insert into public.agent_profiles(agent_id,company_id) values ('e1000000-0000-0000-0000-000000000082','10000000-0000-0000-0000-000000000001');
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.check_memory_reset('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000082')$$,'the Owner may clear the Agent''s memory');
select public.log_memory_reset('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000082');
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log where action='memory_reset' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent','e1000000-0000-0000-0000-000000000082','memory_reset',jsonb_build_object('agent_name','Ads')),
 'the reset is one log row naming who and the Agent, and no note text');
select is((select count(*)::int from public.company_log where action='memory_reset'),1,'one reset is one row');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.check_memory_reset('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000082')$$,'42501','memoryNotAllowed','a Manager may not clear it');
select throws_ok($$select public.log_memory_reset('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000082')$$,'42501','memoryNotAllowed','nor log a reset');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_memory_reset('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000082')$$,'42501','memoryNotAllowed','nor a Contributor, who is not even shown the Agent here');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.check_memory_reset('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000082')$$,'42501','memoryNotAllowed','nor a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.check_memory_reset('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000083')$$,'42501','memoryNotAllowed','an Agent of another Company is never cleared from this one');
select is((select count(*)::int from public.company_log where action='memory_reset'),1,'refused resets write no log row');
-- The read the Memory tab and its route make: an Agent a Member is not shown is not in their list.
select is((select count(*)::int from public.company_app_agents('10000000-0000-0000-0000-000000000001') where agent='e1000000-0000-0000-0000-000000000082'),1,'the Owner sees the Agent, and reads its memory');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.company_app_agents('10000000-0000-0000-0000-000000000001') where agent='e1000000-0000-0000-0000-000000000082'),0,'a Contributor the Agent is hidden from does not see it, so its memory is not found');
reset role;
select ok(not has_function_privilege('anon','public.check_memory_reset(uuid,uuid)','execute'),'no signed-out caller reaches the check');
select * from finish();
rollback;
