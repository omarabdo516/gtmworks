begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
-- #434. A new Company with an Owner (عمر), a Manager and its main Agent: Lead opens the Company's first Conversation once,
-- for an active Owner only, into the Owner's empty Conversation with it when there is one, and never in a Company where
-- something was written already. The Run that answers it carries
-- Lead's opening in its brief. Each Company profile is listed for the soul check until it is recorded.
insert into public.company_engines(id,address,key_encrypted) values ('e4340000-0000-4000-8000-000000000001','http://engine:8642','cipher'),('e4340000-0000-4000-8000-000000000002','http://engine-two:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000434','opening-test','Opening','e4340000-0000-4000-8000-000000000001');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000434','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000434','20000000-0000-0000-0000-000000000002','manager');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,is_default)
 values('f4340000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000434',gen_random_uuid(),'Lead','General','lead434opening',true);

set local role service_role;
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000434','20000000-0000-0000-0000-000000000002','e4340000-0000-0000-0000-000000000001','Hi'),null::uuid,
 'a Manager is never given the opening');
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000434','20000000-0000-0000-0000-000000000001','e4340000-0000-0000-0000-000000000002','Hi عمر, I manage the team.'),'e4340000-0000-0000-0000-000000000002'::uuid,
 'the Owner opening Lead with no Conversation gets a new one');
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000434','20000000-0000-0000-0000-000000000001','e4340000-0000-0000-0000-000000000003','Hi again'),'e4340000-0000-0000-0000-000000000002'::uuid,
 'a second visit before anyone writes, from another tab or a prefetch, finds the same opening and writes nothing');
reset role;
select results_eq($$select id,person_id,agent_id,agent_name from public.conversations where company_id='10000000-0000-0000-0000-000000000434'$$,
 $$select 'e4340000-0000-0000-0000-000000000002'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,'f4340000-0000-0000-0000-000000000001'::uuid,'Lead'::text$$,
 'one Conversation, the Owner''s, with the main Agent');
select results_eq($$select author,agent_id,author_name,body,run_id,person_id,send_key from public.conversation_messages where conversation_id='e4340000-0000-0000-0000-000000000002'$$,
 $$select 'agent'::text,'f4340000-0000-0000-0000-000000000001'::uuid,'Lead'::text,'Hi عمر, I manage the team.'::text,'lead-opening'::text,null::uuid,null::uuid$$,
 'whose one message is Lead''s, written by no Engine run');

-- The Owner's answer: its Run, pinned before its message is stored, is given Lead's opening.
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile) values
 ('e4340000-0000-0000-0000-000000000002','d4340000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000434',gen_random_uuid(),'20000000-0000-0000-0000-000000000001','f4340000-0000-0000-0000-000000000001','We sell courses','lead434opening');
insert into public.conversation_run_notes(conversation_id,send_key,company_id) values ('e4340000-0000-0000-0000-000000000002','d4340000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000434');
set local role service_role;
select is(public.pin_lead_brief('e4340000-0000-0000-0000-000000000002','d4340000-0000-0000-0000-000000000003')->>'opening','Hi عمر, I manage the team.',
 'the answer''s Run is given Lead''s opening');
reset role;
delete from public.conversation_run_notes where send_key='d4340000-0000-0000-0000-000000000003';
delete from public.conversation_run_reservations where send_key='d4340000-0000-0000-0000-000000000003';

-- Once the Owner answers, a visit finds nothing to open or go back to.
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000434','e4340000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000001','عمر','We sell courses',gen_random_uuid(),'run-434-answer');
set local role service_role;
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000434','20000000-0000-0000-0000-000000000001','e4340000-0000-0000-0000-000000000008','Hi'),null::uuid,
 'after the answer, Lead''s chat is an empty chat again');
reset role;

-- First run made the Owner an empty Conversation with Lead: the opening goes into it, not into a new one.
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000435','opening-first-run','First run','e4340000-0000-4000-8000-000000000002');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000435','20000000-0000-0000-0000-000000000001','owner');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,is_default)
 values('f4340000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000435',gen_random_uuid(),'Lead','General','lead435opening',true);
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e4340000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000435','20000000-0000-0000-0000-000000000001','f4340000-0000-0000-0000-000000000003','Lead');
set local role service_role;
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000435','20000000-0000-0000-0000-000000000001','e4340000-0000-0000-0000-000000000007','Hi'),'e4340000-0000-0000-0000-000000000006'::uuid,
 'the Owner''s empty Conversation from first run is the one Lead opens');
reset role;
select is((select count(*) from public.conversations where company_id='10000000-0000-0000-0000-000000000435'),1::bigint,'and no other is made');

-- An Owner who typed before a model was connected: that message's Run ended no_model, so the opening still comes, into
-- the same Conversation.
insert into public.company_engines(id,address,key_encrypted) values ('e4340000-0000-4000-8000-000000000003','http://engine-three:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000436','opening-no-model','No model','e4340000-0000-4000-8000-000000000003');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000436','20000000-0000-0000-0000-000000000001','owner');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,is_default)
 values('f4340000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000436',gen_random_uuid(),'Lead','General','lead436opening',true);
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e4340000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000436','20000000-0000-0000-0000-000000000001','f4340000-0000-0000-0000-000000000004','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000436','e4340000-0000-0000-0000-000000000010','person','20000000-0000-0000-0000-000000000001','عمر','Hello?',gen_random_uuid(),'run-436');
insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome) values ('10000000-0000-0000-0000-000000000436','e4340000-0000-0000-0000-000000000010','run-436','no_model');
set local role service_role;
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000436','20000000-0000-0000-0000-000000000001','e4340000-0000-0000-0000-000000000011','Hi'),'e4340000-0000-0000-0000-000000000010'::uuid,
 'a message that failed for want of a model does not keep the opening away');
reset role;

-- A Company where someone already wrote (RS Learning, a Manager's message) is never opened.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,is_default)
 select 'f4340000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Lead','General','lead434seed',true
 where not exists(select 1 from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default);
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select 'e4340000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',id,name from public.hermes_agents
 where company_id='10000000-0000-0000-0000-000000000001' and is_default;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','e4340000-0000-0000-0000-000000000009','person','20000000-0000-0000-0000-000000000002','Manager','Plan the week',gen_random_uuid(),'run-434');
set local role service_role;
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e4340000-0000-0000-0000-000000000004','Hi'),null::uuid,
 'a Company where someone wrote already, even another person, is not opened');
reset role;

-- A later Run in the opened Conversation, once the Owner has answered, carries no opening; nor does one elsewhere.
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile) values
 ('e4340000-0000-0000-0000-000000000002','d4340000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000434',gen_random_uuid(),'20000000-0000-0000-0000-000000000001','f4340000-0000-0000-0000-000000000001','We sell courses','lead434opening'),
 ('e4340000-0000-0000-0000-000000000005','d4340000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000434',gen_random_uuid(),'20000000-0000-0000-0000-000000000001','f4340000-0000-0000-0000-000000000001','Plan the week','lead434opening');
insert into public.conversation_run_notes(conversation_id,send_key,company_id)
 select conversation_id,send_key,company_id from public.conversation_run_reservations where conversation_id::text like 'e4340000-%';
set local role service_role;
select is(public.pin_lead_brief('e4340000-0000-0000-0000-000000000002','d4340000-0000-0000-0000-000000000001')->'opening','null'::jsonb,
 'a Run after the Owner has answered is not given the opening again');
select is(public.pin_lead_brief('e4340000-0000-0000-0000-000000000002','d4340000-0000-0000-0000-000000000001')->>'role','owner',
 'beside the brief it always had');
select is(public.pin_lead_brief('e4340000-0000-0000-0000-000000000005','d4340000-0000-0000-0000-000000000002')->'opening','null'::jsonb,
 'a Run in another Conversation is given no opening');
reset role;

-- The soul check: a Company profile is listed until its read is recorded.
insert into public.company_profiles(company_id,profile,tools_level) values ('10000000-0000-0000-0000-000000000434','co-10000000000000000000000000000434',1);
set local role service_role;
select ok(exists(select 1 from public.lead_soul_work() where profile='co-10000000000000000000000000000434'),'a profile not yet checked is listed');
select is(public.record_lead_soul('10000000-0000-0000-0000-000000000434','co-10000000000000000000000000000434'),true,'its check is recorded');
select ok(not exists(select 1 from public.lead_soul_work() where profile='co-10000000000000000000000000000434'),'and it is not listed again');
reset role;
select * from finish();
rollback;
