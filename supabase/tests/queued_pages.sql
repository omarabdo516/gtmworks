begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
-- #68: a page of waiting Conversations whose Company profile the worker has not finished never hides a ready one.
-- RS Learning (1) is on its own profile, not ready; R&S Consultations (2) is on its own profile, ready.
insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000501','10000000-0000-0000-0000-000000000001','Blocked Lead','General',true,'co-10000000000000000000000000000001'),
 ('e1000000-0000-0000-0000-000000000502','10000000-0000-0000-0000-000000000002','Ready Lead','General',true,'co-10000000000000000000000000000002');

-- 501 Conversations wait on RS Learning's unready profile, ahead of the one ready Conversation by id.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
select ('b1000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000501','Blocked Lead'
from generate_series(1,501) n;
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message)
select ('b1000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('b3000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000501','Waiting '||n
from generate_series(1,501) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('d1000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000502','Ready Lead');
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message) values
 ('d1000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000502','Ready now');

set local role service_role;
select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy());
reset role;

select ok(public.company_profile_ready('10000000-0000-0000-0000-000000000002'),'the ready Company''s profile is ready');

set local role service_role;
select is((select count(*)::int from public.queued_conversations(null)),1,'only the ready Conversation is listed among 501 blocked ones');
select is((select conversation from public.queued_conversations(null)),'d1000000-0000-0000-0000-000000000001'::uuid,'and it is the ready one');
select is((select count(*)::int from public.queued_conversations('b1000000-0000-0000-0000-000000000001')),0,'a Conversation whose Company profile is not ready is left out');
select is((select count(*)::int from public.queued_conversations(just=>'b1000000-0000-0000-0000-000000000001'::uuid)),0,'also when a reader asks for that one alone');
select is((select count(*)::int from public.queued_conversations(null,'b1000000-0000-0000-0000-000000000001')),1,'the cursor past a blocked Conversation reaches the ready one');
select is((select count(*)::int from public.queued_conversations(null,'d1000000-0000-0000-0000-000000000001')),0,'and nothing follows the last listed one');
select ok(has_function_privilege('service_role','public.queued_conversations(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.queued_conversations(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.queued_conversations(uuid,uuid)','execute'),'only the service role pages the queue');
select lives_ok($$select * from public.queued_conversations(null)$$,'the previous app version''s one-argument call still answers');
reset role;

select * from finish();
rollback;
