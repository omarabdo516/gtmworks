begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- #68: a page of waiting Conversations whose Company profile the worker has not finished never hides a ready one for good:
-- the worker pages on behind a cursor.
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
select is((select count(*)::int from public.queued_conversations(null,null)),500,'a page holds 500 Conversations');
select ok(not exists(select 1 from public.queued_conversations(null,null) where conversation='d1000000-0000-0000-0000-000000000001'),'the 501 blocked ones fill the first page');
select is((select array_agg(conversation order by conversation) from public.queued_conversations(null,(select max(conversation) from public.queued_conversations(null,null)))),
 array['b1000000-0000-0000-0000-000000000501','d1000000-0000-0000-0000-000000000001']::uuid[],'the next page, after the first page''s last, reaches the ready one');
select is((select count(*)::int from public.queued_conversations('d1000000-0000-0000-0000-000000000001',null)),1,'a reader asking for one Conversation gets it');
select is((select count(*)::int from public.queued_conversations(null,'d1000000-0000-0000-0000-000000000001')),0,'nothing follows the last one');
select ok(has_function_privilege('service_role','public.queued_conversations(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.queued_conversations(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.queued_conversations(uuid,uuid)','execute'),'only the service role pages the queue');
select lives_ok($$select * from public.queued_conversations(null)$$,'the previous app version''s one-argument call still answers');
reset role;

select * from finish();
rollback;
