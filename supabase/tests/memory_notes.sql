begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
-- Review of spec #353 (#191): one note of an Agent's memory is edited by an active Owner or Manager of its Company and
-- forgotten by the Owner alone, and each change is one row of the Company log naming the person and the Agent with
-- nothing of the note. RS Learning: 1 Owner, 2 Manager, 3 Contributor, 4 Viewer. Ads is not the main Agent, so a Member
-- without a grant for it does not see it (#15). Written without the guards, as company_apps.sql does.
set local session_replication_role=replica;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000091','Lead','General',true,'co-10000000000000000000000000000001'),
 ('e1000000-0000-0000-0000-000000000092','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000092','Ads','Meta ads',false,'ag-e1000000000000000000000000000092'),
 ('e1000000-0000-0000-0000-000000000093','10000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000093','Sara','Writing',true,'co-10000000000000000000000000000003');
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy()),
 ('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',1,public.engine_tool_policy());
insert into public.company_profile_keepers(company_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000091'),
 ('10000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000093');
insert into public.agent_profiles(agent_id,company_id) values ('e1000000-0000-0000-0000-000000000092','10000000-0000-0000-0000-000000000001');
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.check_memory_edit('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092','memory:memory:0:4d2c1b0a9f8e')$$,'the Owner may edit a note of the Agent');
select public.log_memory_edit('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092');
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log where action='memory_edit' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent','e1000000-0000-0000-0000-000000000092','memory_edit',jsonb_build_object('agent_name','Ads')),
 'the edit is one row naming who and the Agent, and no note text');
select is((select count(*)::int from public.company_log where action='memory_edit'),1,'one edit is one row');
select public.log_memory_forget('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092');
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log where action='memory_forget' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent','e1000000-0000-0000-0000-000000000092','memory_forget',jsonb_build_object('agent_name','Ads')),
 'the forget is one row naming who and the Agent, and nothing of the note');
select is((select count(*)::int from public.company_log where action='memory_forget'),1,'one forget is one row');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.check_memory_edit('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092','memory:profile:1:7a1b2c3d4e5f')$$,'a Manager may edit one');
select throws_ok($$select public.check_memory_forget('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092','memory:memory:0:4d2c1b0a9f8e')$$,'42501','memoryNotAllowed','a Manager may not forget one');
select throws_ok($$select public.log_memory_forget('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092')$$,'42501','memoryNotAllowed','nor log a forget');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_memory_edit('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092','memory:memory:0:4d2c1b0a9f8e')$$,'42501','memoryNotAllowed','nor a Contributor, who is not even shown the Agent here');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.check_memory_forget('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092','memory:memory:0:4d2c1b0a9f8e')$$,'42501','memoryNotAllowed','nor a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.check_memory_edit('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000093','memory:memory:0:4d2c1b0a9f8e')$$,'42501','memoryNotAllowed','an Agent of another Company is never edited from this one');
select throws_ok($$select public.check_memory_edit('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092','weekly-recap')$$,'22023','memoryInvalid','an id that is not a memory note''s is refused, so a skill is never named');
select throws_ok($$select public.check_memory_forget('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000092','memory:other:0:4d2c1b0a9f8e')$$,'22023','memoryInvalid','neither is a memory id of no file');
select is((select count(*)::int from public.company_log where action in ('memory_edit','memory_forget')),2,'refused changes write no log row');
-- The read the Memory tab and its route make: an Agent a Member is not shown is not in their list.
select is((select count(*)::int from public.company_app_agents('10000000-0000-0000-0000-000000000001') where agent='e1000000-0000-0000-0000-000000000092'),1,'the Owner sees the Agent, and edits its memory');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.company_app_agents('10000000-0000-0000-0000-000000000001') where agent='e1000000-0000-0000-0000-000000000092'),0,'a Contributor the Agent is hidden from does not see it, so its memory is not found');
reset role;
select ok(not has_function_privilege('anon','public.check_memory_edit(uuid,uuid,text)','execute'),'no signed-out caller reaches the check');
select * from finish();
rollback;
