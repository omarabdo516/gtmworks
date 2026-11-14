begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
-- Two Members of RS Learning: Omar (Owner, holds the approval step) and the Manager, each with a Conversation.
-- The test brings its own Agent (a Connection that is never called) and both Conversations, so it needs no fixture.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('60000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/waiting','waiting','not-a-key','unreachable') on conflict do nothing;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('61000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000f1','Lead','Marketing lead',false) on conflict do nothing;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('62000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','Lead') on conflict do nothing;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('62000000-0000-0000-0000-0000000000f2','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000001','Lead') on conflict do nothing;
-- A webhook is configured, so anything that did notify the outside would leave a delivery behind.
insert into public.agent_webhooks(company_id,url,secret_encrypted) values ('10000000-0000-0000-0000-000000000001','https://example.test/hook','x') on conflict do nothing;
create temporary table before_items as select (select count(*) from public.webhook_deliveries) as deliveries;
select ok(public.add_waiting_item('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','question','Which offer goes first?','',null,'62000000-0000-0000-0000-000000000001','Lead')>0,'an Agent question for Omar');
select ok(public.add_waiting_item('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','question','Approve the budget split?','',null,'62000000-0000-0000-0000-0000000000f2','Lead')>0,'an Agent question for the Manager');
-- A kind the list has never seen arrives through the same source.
select ok(public.add_waiting_item('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','test_kind','A new kind of item','body',1)>0,'an item of a test kind');
select is((select count(*) from public.webhook_deliveries),(select deliveries from before_items),'nothing is queued to leave gtmworks');
select throws_ok($$select public.add_waiting_item('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','question','Not hers','',null,'62000000-0000-0000-0000-0000000000f2')$$,'P0002','conversation not found','a question goes to its Conversation''s person only');
-- Fixed times, so "newest first" is visible: the question is newest, then the test item, then card 5's approval.
update public.waiting_items set created_at=now()+interval '2 minutes' where kind='question';
update public.waiting_items set created_at=now()+interval '1 minute' where kind='test_kind';

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(kind||':'||title,' | ') from public.waiting_list('10000000-0000-0000-0000-000000000001')),'question:Which offer goes first? | test_kind:A new kind of item | approval:إعلان البرنامج القادم','Omar reads his own items, newest first');
select is((select count(*)::int from public.waiting_items),2,'Omar reads none of the Manager''s rows');
select throws_ok($$select public.add_waiting_item('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','question','Spam','',null,'62000000-0000-0000-0000-0000000000f2')$$,'42501',null,'a Member cannot add an item');
select throws_ok($$update public.waiting_items set resolved_at=now()$$,'42501',null,'a Member cannot clear an item by hand');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select string_agg(kind||':'||title,' | ') from public.waiting_list('10000000-0000-0000-0000-000000000001')),'question:Approve the budget split?','the Manager reads only what is addressed to them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001')),0,'a Viewer has nothing waiting');

-- Acting where an item came from clears it, and only it.
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values ('10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','The early-price offer','62000000-0000-0000-0000-00000000aaa1','waiting-test-run');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(kind,',') from public.waiting_list('10000000-0000-0000-0000-000000000001')),'test_kind,approval','a reply in the Conversation clears the question');
select public.change_work_card('10000000-0000-0000-0000-000000000001',1,'comment',jsonb_build_object('body','Done'));
select is((select string_agg(kind,',') from public.waiting_list('10000000-0000-0000-0000-000000000001')),'approval','a change on the Card clears its item');
select public.decide_approval('10000000-0000-0000-0000-000000000001',5,'approve');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001')),0,'deciding clears the approval');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001')),1,'the Manager''s question is still there');
select * from finish();
rollback;
