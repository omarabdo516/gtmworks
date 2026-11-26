begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
-- Spec #831 (#844): every Agent's Run is told the board names (Engine profiles) of the Agents its person sees and its
-- own, so it gives a job as a Card with the Engine's own kanban_create; pinned once with the Run. RS Learning's main
-- Agent, and Reach on its own profile, made from the meta role.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,is_default,template)
 values('f8440000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Reach','Plans the Meta ads.','ag-f8440000000000000000000000000002',false,'meta');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,is_default)
 select 'f8440000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Lead','General','co-10000000000000000000000000000001',true
 where not exists(select 1 from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default);
select set_config('test.main',(select id::text from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default),true);
select set_config('test.main_profile',(select profile from public.hermes_agents where id=current_setting('test.main')::uuid),true);
-- The Contributor (…05) sees Reach; the Owner sees everyone. One Run of the main Agent for the Contributor, one of Reach
-- for the Owner.
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','f8440000-0000-0000-0000-000000000002');
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 values('e8440000-0000-0000-0000-000000000001','d8440000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f8440000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-000000000005',current_setting('test.main')::uuid,'/campaign Plan March',current_setting('test.main_profile')),
       ('e8440000-0000-0000-0000-000000000002','d8440000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f8440000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-000000000001','f8440000-0000-0000-0000-000000000002','Give Lead the report','ag-f8440000000000000000000000000002');
insert into public.conversation_run_notes(conversation_id,send_key,company_id)
 select conversation_id,send_key,company_id from public.conversation_run_reservations where conversation_id::text like 'e8440000-%';

set local role service_role;
select is(public.pin_run_brief('e8440000-0000-0000-0000-000000000001','d8440000-0000-0000-0000-000000000001')->'main','true'::jsonb,'the main Agent''s Run is the main one''s');
select is(public.pin_run_brief('e8440000-0000-0000-0000-000000000001','d8440000-0000-0000-0000-000000000001')->'self',to_jsonb(current_setting('test.main_profile')),
 'and its own board name is the profile its Run was reserved on');
select is(public.pin_run_brief('e8440000-0000-0000-0000-000000000001','d8440000-0000-0000-0000-000000000001')->'agents',
 '[{"name":"Reach","job":"Plans the Meta ads.","role":"meta","board":"ag-f8440000000000000000000000000002"}]'::jsonb,
 'a Contributor''s main Agent is told the Agent they see, its ready-made role and its board name, and no one hidden from them');
select is(public.pin_run_brief('e8440000-0000-0000-0000-000000000002','d8440000-0000-0000-0000-000000000002')->'main','false'::jsonb,'another Agent''s Run is pinned a brief too');
select is(public.pin_run_brief('e8440000-0000-0000-0000-000000000002','d8440000-0000-0000-0000-000000000002')->'self','"ag-f8440000000000000000000000000002"'::jsonb,'with its own profile');
select is((select e->'board' from jsonb_array_elements(public.pin_run_brief('e8440000-0000-0000-0000-000000000002','d8440000-0000-0000-0000-000000000002')->'agents') e
  where e->>'name'=(select name from public.hermes_agents where id=current_setting('test.main')::uuid)),
 to_jsonb(current_setting('test.main_profile')),'it names the main Agent by the Company''s profile');
select is(public.pin_run_brief('e8440000-0000-0000-0000-000000000002','d8440000-0000-0000-0000-000000000002')->'hidden','[]'::jsonb,'and is told no hidden job, which is the main Agent''s');
-- Pinned once: a later change to the team changes no brief already pinned.
reset role;
update public.hermes_agents set name='Reach two' where id='f8440000-0000-0000-0000-000000000002';
set local role service_role;
select is(public.pin_run_brief('e8440000-0000-0000-0000-000000000001','d8440000-0000-0000-0000-000000000001')->'agents'->0->>'name','Reach','a retry sends the brief pinned at the first start');
reset role;
select ok(not has_function_privilege('authenticated','public.pin_run_brief(uuid,uuid)','execute'),'no person pins a brief');
select * from finish();
rollback;
